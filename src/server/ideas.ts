import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { ideaCreateSchema, ideaToggleStarSchema } from '../lib/ideas'
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

export const listIdeas = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return ideasService.listIdeas(user.id)
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
