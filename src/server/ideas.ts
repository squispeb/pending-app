import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '../db/client'
import { canUseIdeaRefinementActions, type IdeaStructuredAction } from '../lib/idea-structured-actions'
import { ideaStageSchema, ideaCreateSchema, ideaToggleStarSchema, ideaVaultSearchSchema } from '../lib/ideas'
import { createAssistantThreadService } from './assistant-thread-service'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'

const ideasService = createIdeasService(db)
const assistantThreadService = createAssistantThreadService(db)

type CreateIdeaAndThreadDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
    authHeaders: HeadersInit
  }>
  createIdea: (userId: string, data: Parameters<typeof ideaCreateSchema.parse>[0]) => Promise<{
    ok: true
    id: string
  }>
  bootstrapIdeaThread: (
    ideaId: string,
    options: {
      requestHeaders: HeadersInit
    },
  ) => Promise<{
    threadId: string
    initialSnapshotId: string
  }>
}

type ApproveIdeaProposalDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
  }>
  approveIdeaThreadProposal: (
    ideaId: string,
    input: {
      proposalId: string
      expectedSnapshotVersion: number
    },
  ) => Promise<{
    thread: unknown
    canonicalWritePayload: {
      ideaId: string
      expectedSnapshotVersion: number
      title: string
      body: string
      threadSummary: string | null
    }
  }>
  applyApprovedProposal: (
    input: {
      ideaId: string
      expectedSnapshotVersion: number
      title: string
      body: string
      threadSummary: string | null
    },
    userId: string,
  ) => Promise<unknown>
}

type PersistIdeaRefinementDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
  }>
  getIdea: (ideaId: string, userId: string) => Promise<{
    id: string
    title: string
  } | undefined>
  getLatestIdeaSnapshot: (ideaId: string, userId: string) => Promise<{
    version: number
    title: string
    body: string
    threadSummary: string | null
  } | undefined>
  getIdeaThread: (ideaId: string) => Promise<{
    stage: z.infer<typeof ideaStageSchema>
    workingIdea: {
      provisionalTitle: string | null
      currentSummary: string | null
    }
  }>
  syncIdeaThreadCheckpoint: (
    input: {
      ideaId: string
      expectedSnapshotVersion: number
      title: string
      body: string
      threadSummary: string | null
      stage: z.infer<typeof ideaStageSchema>
    },
    userId: string,
  ) => Promise<unknown>
}

export async function createIdeaAndBootstrapThread(
  data: Parameters<typeof ideaCreateSchema.parse>[0],
  dependencies: CreateIdeaAndThreadDependencies,
) {
  const { user, authHeaders } = await dependencies.resolveUser()
  const createdIdea = await dependencies.createIdea(user.id, data)
  const thread = await dependencies.bootstrapIdeaThread(createdIdea.id, {
    requestHeaders: authHeaders,
  })

  return {
    ...createdIdea,
    threadId: thread.threadId,
    initialSnapshotId: thread.initialSnapshotId,
  }
}

export async function approveIdeaProposalAndPersist(
  input: {
    ideaId: string
    proposalId: string
    expectedSnapshotVersion: number
  },
  dependencies: ApproveIdeaProposalDependencies,
) {
  const { user } = await dependencies.resolveUser()
  const approval = await dependencies.approveIdeaThreadProposal(input.ideaId, {
    proposalId: input.proposalId,
    expectedSnapshotVersion: input.expectedSnapshotVersion,
  })

  await dependencies.applyApprovedProposal(approval.canonicalWritePayload, user.id)

  return approval.thread
}

export async function persistIdeaRefinementAndSync(
  input: {
    ideaId: string
    kind: 'title' | 'summary'
  },
  dependencies: PersistIdeaRefinementDependencies,
) {
  const { user } = await dependencies.resolveUser()
  const idea = await dependencies.getIdea(input.ideaId, user.id)

  if (!idea) {
    throw new Error('Idea not found')
  }

  const latestSnapshot = await dependencies.getLatestIdeaSnapshot(input.ideaId, user.id)

  if (!latestSnapshot) {
    throw new Error('Accepted snapshot not found')
  }

  const thread = await dependencies.getIdeaThread(input.ideaId)

  if (!canUseIdeaRefinementActions(thread.stage)) {
    throw new Error('Title and summary improvements are only available for developed ideas.')
  }

  if (input.kind === 'title' && !thread.workingIdea.provisionalTitle) {
    throw new Error('No title suggestion available')
  }

  if (input.kind === 'summary' && !thread.workingIdea.currentSummary) {
    throw new Error('No summary suggestion available')
  }

  const nextTitle = input.kind === 'title'
    ? thread.workingIdea.provisionalTitle ?? latestSnapshot.title
    : latestSnapshot.title
  const nextSummary = input.kind === 'summary'
    ? thread.workingIdea.currentSummary
    : latestSnapshot.threadSummary

  await dependencies.syncIdeaThreadCheckpoint(
    {
      ideaId: input.ideaId,
      expectedSnapshotVersion: latestSnapshot.version,
      title: nextTitle,
      body: latestSnapshot.body,
      threadSummary: nextSummary,
      stage: thread.stage,
    },
    user.id,
  )

  return {
    ok: true as const,
    kind: input.kind,
    title: nextTitle,
    threadSummary: nextSummary,
    stage: thread.stage,
  }
}

export function markServerFnRawResponse(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('x-tss-raw', 'true')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const listIdeas = createServerFn({ method: 'GET' })
  .inputValidator((input) => ideaVaultSearchSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.listIdeas(user.id, data)
  })

export const getIdea = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.getIdea(data.id, user.id)
  })

export const createIdea = createServerFn({ method: 'POST' })
  .inputValidator((input) => ideaCreateSchema.parse(input))
  .handler(async ({ data }) => {
    return createIdeaAndBootstrapThread(data, {
      resolveUser: () => resolveAuthenticatedPlannerUser(db),
      createIdea: (userId, input) => ideasService.createIdea(userId, input),
      bootstrapIdeaThread: (ideaId, options) => assistantThreadService.bootstrapIdeaThread(ideaId, {
        requestHeaders: options.requestHeaders,
      }),
    })
  })

export const toggleIdeaStar = createServerFn({ method: 'POST' })
  .inputValidator((input) => ideaToggleStarSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.toggleIdeaStar(data.id, user.id)
  })

export const resolveIdeaThread = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return assistantThreadService.resolveIdeaThread(data.id)
  })

export const getIdeaThread = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return assistantThreadService.getIdeaThread(data.id)
  })

export const submitIdeaThreadTurn = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; message: string }) => input)
  .handler(async ({ data }) => {
    return assistantThreadService.submitIdeaDiscoveryTurn(data.id, {
      message: data.message,
    })
  })

export const streamIdeaThread = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string; lastEventId?: string | null }) => input)
  .handler(async ({ data }) => {
    const response = await assistantThreadService.streamIdeaThread(data.id, {
      lastEventId: data.lastEventId ?? null,
    })
    return markServerFnRawResponse(response)
  })

export const elaborateIdea = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; actionInput: string | null }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const idea = await ideasService.getIdea(data.id, user.id)

    if (!idea) {
      throw new Error('Idea not found')
    }

    const latestSnapshot = await ideasService.getLatestIdeaSnapshot(data.id, user.id)

    if (!latestSnapshot) {
      throw new Error('Accepted snapshot not found')
    }

    return assistantThreadService.requestIdeaThreadElaboration(data.id, {
      actionInput: data.actionInput,
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
    })
  })

export const requestIdeaRefinement = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; kind: 'title' | 'summary' }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const idea = await ideasService.getIdea(data.id, user.id)

    if (!idea) {
      throw new Error('Idea not found')
    }

    const latestSnapshot = await ideasService.getLatestIdeaSnapshot(data.id, user.id)

    if (!latestSnapshot) {
      throw new Error('Accepted snapshot not found')
    }

    const currentThread = await assistantThreadService.getIdeaThread(data.id)

    if (!canUseIdeaRefinementActions(currentThread.stage)) {
      throw new Error('Title and summary improvements are only available for developed ideas.')
    }

    if (data.kind === 'title') {
      return assistantThreadService.requestIdeaThreadTitleImprovement(data.id, {
        currentSnapshotVersion: latestSnapshot.version,
        currentTitle: latestSnapshot.title,
        currentBody: latestSnapshot.body,
        currentSummary: latestSnapshot.threadSummary,
      })
    }

    return assistantThreadService.requestIdeaThreadSummaryImprovement(data.id, {
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
    })
  })

export const requestIdeaStructuredAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; kind: Extract<IdeaStructuredAction, 'restructure' | 'breakdown'> }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const idea = await ideasService.getIdea(data.id, user.id)

    if (!idea) {
      throw new Error('Idea not found')
    }

    const latestSnapshot = await ideasService.getLatestIdeaSnapshot(data.id, user.id)

    if (!latestSnapshot) {
      throw new Error('Accepted snapshot not found')
    }

    const currentThread = await assistantThreadService.getIdeaThread(data.id)

    if (!canUseIdeaRefinementActions(currentThread.stage)) {
      throw new Error('Restructure and breakdown actions are only available for developed ideas.')
    }

    if (data.kind === 'restructure') {
      return assistantThreadService.requestIdeaThreadRestructure(data.id, {
        currentSnapshotVersion: latestSnapshot.version,
        currentTitle: latestSnapshot.title,
        currentBody: latestSnapshot.body,
        currentSummary: latestSnapshot.threadSummary,
      })
    }

    return assistantThreadService.requestIdeaThreadBreakdown(data.id, {
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
    })
  })

export const acceptIdeaStructuredAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string }) => input)
  .handler(async ({ data }) => {
    const acceptance = await assistantThreadService.acceptIdeaThreadStructuredAction(data.id, {
      proposalId: data.proposalId,
    })

    return acceptance.thread
  })

export const rejectIdeaStructuredAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string }) => input)
  .handler(async ({ data }) => {
    const rejection = await assistantThreadService.rejectIdeaThreadStructuredAction(data.id, {
      proposalId: data.proposalId,
    })

    return rejection.thread
  })

export const approveIdeaProposal = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string; expectedSnapshotVersion: number }) => input)
  .handler(async ({ data }) => {
    return approveIdeaProposalAndPersist(
      {
        ideaId: data.id,
        proposalId: data.proposalId,
        expectedSnapshotVersion: data.expectedSnapshotVersion,
      },
      {
        resolveUser: async () => {
          const { user } = await resolveAuthenticatedPlannerUser(db)
          return { user }
        },
        approveIdeaThreadProposal: (ideaId, input) => assistantThreadService.approveIdeaThreadProposal(ideaId, input),
        applyApprovedProposal: (input, userId) => ideasService.applyApprovedProposal(input, userId),
      },
    )
  })

export const rejectIdeaProposal = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string }) => input)
  .handler(async ({ data }) => {
    const rejection = await assistantThreadService.rejectIdeaThreadProposal(data.id, {
      proposalId: data.proposalId,
    })

    return rejection.thread
  })

export const persistIdeaRefinement = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; kind: 'title' | 'summary' }) => input)
  .handler(async ({ data }) => {
    return persistIdeaRefinementAndSync(
      {
        ideaId: data.id,
        kind: data.kind,
      },
      {
        resolveUser: async () => {
          const { user } = await resolveAuthenticatedPlannerUser(db)
          return { user }
        },
        getIdea: (ideaId, userId) => ideasService.getIdea(ideaId, userId),
        getLatestIdeaSnapshot: (ideaId, userId) => ideasService.getLatestIdeaSnapshot(ideaId, userId),
        getIdeaThread: (ideaId) => assistantThreadService.getIdeaThread(ideaId),
        syncIdeaThreadCheckpoint: (input, userId) => ideasService.syncIdeaThreadCheckpoint(input, userId),
      },
    )
  })
