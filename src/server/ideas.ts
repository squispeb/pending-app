import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '../db/client'
import { canUseIdeaRefinementActions, type IdeaStructuredAction } from '../lib/idea-structured-actions'
import { ideaStageSchema, ideaCreateSchema, ideaToggleStarSchema, ideaVaultSearchSchema } from '../lib/ideas'
import type { GetIdeaThreadResponse } from './assistant-service-client'
import { createAssistantThreadService } from './assistant-thread-service'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'
import { createTasksService } from './tasks-service'

const ideasService = createIdeasService(db)
const assistantThreadService = createAssistantThreadService(db)
const tasksService = createTasksService(db)

async function getExecutionSummaryForIdea(ideaId: string, userId: string) {
  return ideasService.getExecutionSummary(ideaId, userId)
}

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
  seedInitialElaboration?: (
    ideaId: string,
    options: {
      requestHeaders: HeadersInit
      input: {
        actionInput: string | null
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
      }
    },
  ) => Promise<unknown>
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

type ConvertIdeaToTaskDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
  }>
  acceptIdeaThreadStructuredAction: (
    ideaId: string,
    input: {
      proposalId: string
    },
  ) => Promise<{
    thread: GetIdeaThreadResponse
    taskCreationPayload?: {
      taskTitle: string
      taskDescription: string
      suggestedSteps: string[]
    }
  }>
  createTask: (
    userId: string,
    input: {
      title: string
      notes: string | undefined
      priority: 'low' | 'medium' | 'high'
      dueDate: string | undefined
      dueTime: string | undefined
      reminderAt: string | undefined
      estimatedMinutes: number | undefined
      preferredStartTime: string | undefined
      preferredEndTime: string | undefined
    },
  ) => Promise<{
    ok: true
    id: string
  }>
  createIdeaExecutionLink: (
    input: {
      ideaId: string
      targetType: 'task' | 'habit'
      targetId: string
      linkReason?: string | null
    },
    userId: string,
  ) => Promise<unknown>
  recordTaskCreatedForIdeaThread?: (
    ideaId: string,
    input: {
      taskId: string
      summary: string
    },
  ) => Promise<unknown>
}

type AcceptIdeaBreakdownDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
  }>
  getIdeaThread: (ideaId: string) => Promise<{
    pendingStructuredAction?: {
      action: 'breakdown'
      proposedSummary: string
    } | null
  }>
  acceptIdeaThreadStructuredAction: (
    ideaId: string,
    input: {
      proposalId: string
    },
  ) => Promise<{
    thread: GetIdeaThreadResponse
  }>
  createAcceptedBreakdownSteps: (
    input: {
      ideaId: string
      steps: Array<{ stepOrder: number; stepText: string }>
    },
    userId: string,
  ) => Promise<unknown>
  recordBreakdownPlanForIdeaThread?: (
    ideaId: string,
    input: {
      summary: string
      stepCount: number
    },
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

  if (dependencies.seedInitialElaboration) {
    await dependencies.seedInitialElaboration(createdIdea.id, {
      requestHeaders: authHeaders,
      input: {
        actionInput: data.sourceInput ?? null,
        currentSnapshotVersion: 1,
        currentTitle: data.title,
        currentBody: data.body,
        currentSummary: null,
      },
    })
  }

  return {
    ...createdIdea,
    threadId: thread.threadId,
    initialSnapshotId: thread.initialSnapshotId,
  }
}

type ConvertAcceptedBreakdownStepToTaskDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
  }>
  listAcceptedBreakdownSteps: (ideaId: string, userId: string) => Promise<Array<{
    id: string
    ideaId: string
    stepOrder: number
    stepText: string
    createdAt: Date
    updatedAt: Date
  }>>
  listIdeaExecutionLinks: (
    input: {
      ideaId: string
      targetType?: 'task' | 'habit'
    },
    userId: string,
  ) => Promise<Array<{
    id: string
    ideaId: string
    targetType: 'task' | 'habit'
    targetId: string
    linkReason: string | null
    createdAt: Date
    updatedAt: Date
  }>>
  createTask: (
    userId: string,
    input: {
      title: string
      notes: string | undefined
      priority: 'low' | 'medium' | 'high'
      dueDate: string | undefined
      dueTime: string | undefined
      reminderAt: string | undefined
      estimatedMinutes: number | undefined
      preferredStartTime: string | undefined
      preferredEndTime: string | undefined
    },
  ) => Promise<{
    ok: true
    id: string
  }>
  createIdeaExecutionLink: (
    input: {
      ideaId: string
      targetType: 'task' | 'habit'
      targetId: string
      linkReason?: string | null
    },
    userId: string,
  ) => Promise<unknown>
  recordTaskCreatedForIdeaThread?: (
    ideaId: string,
    input: {
      taskId: string
      summary: string
      stepOrder?: number
    },
  ) => Promise<unknown>
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

export async function listAcceptedBreakdownStepsForIdea(
  ideaId: string,
  dependencies: {
    resolveUser: () => Promise<{
      user: { id: string }
    }>
    listAcceptedBreakdownSteps: (ideaId: string, userId: string) => Promise<Array<{
      id: string
      ideaId: string
      stepOrder: number
      stepText: string
      completedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }>>
    listIdeaExecutionLinks?: (
      input: {
        ideaId: string
        targetType?: 'task' | 'habit'
      },
      userId: string,
    ) => Promise<Array<{
      targetType: 'task' | 'habit'
      targetId: string
      linkReason: string | null
    }>>
    listTasks?: (userId: string) => Promise<Array<{
      id: string
      status: string
      completedAt: Date | null
      archivedAt: Date | null
    }>>
  },
) {
  const { user } = await dependencies.resolveUser()
  const steps = await dependencies.listAcceptedBreakdownSteps(ideaId, user.id)

  if (!dependencies.listIdeaExecutionLinks || !dependencies.listTasks || steps.length === 0) {
    return steps.map((step) => ({
      ...step,
      completedSource: step.completedAt ? 'manual' as const : null,
    }))
  }

  const [links, tasks] = await Promise.all([
    dependencies.listIdeaExecutionLinks({ ideaId, targetType: 'task' }, user.id),
    dependencies.listTasks(user.id),
  ])
  const tasksById = new Map(tasks.map((task) => [task.id, task]))

  return steps.map((step) => {
    const taskLink = links.find((link) => link.linkReason === `Accepted breakdown step #${step.stepOrder} from idea.`)
    const linkedTask = taskLink ? tasksById.get(taskLink.targetId) : undefined
    const linkedTaskCompletedAt = linkedTask && (linkedTask.status === 'completed' || linkedTask.completedAt !== null)
      ? linkedTask.completedAt ?? step.updatedAt
      : null

    if (linkedTaskCompletedAt) {
      return {
        ...step,
        completedAt: linkedTaskCompletedAt,
        completedSource: 'linked-task' as const,
      }
    }

    if (linkedTask) {
      return {
        ...step,
        completedAt: null,
        completedSource: null,
      }
    }

    if (step.completedAt) {
      return {
        ...step,
        completedSource: 'manual' as const,
      }
    }

    return {
      ...step,
      completedSource: null,
    }
  })
}

export async function listLinkedTaskExecutionArtifactsForIdea(
  ideaId: string,
  dependencies: {
    resolveUser: () => Promise<{ user: { id: string } }>
    listIdeaExecutionLinks: (
      input: {
        ideaId: string
        targetType?: 'task' | 'habit'
      },
      userId: string,
    ) => Promise<Array<{
      targetType: 'task' | 'habit'
      targetId: string
      linkReason: string | null
    }>>
    listTaskExecutionArtifacts: (taskId: string, userId: string) => Promise<Array<{
      id: string
      taskId: string
      userId: string
      artifactType: string
      source: string
      content: string
      createdAt: Date
      updatedAt: Date
    }>>
  },
) {
  const { user } = await dependencies.resolveUser()
  const taskLinks = await dependencies.listIdeaExecutionLinks({ ideaId, targetType: 'task' }, user.id)

  const artifactRows = await Promise.all(
    taskLinks.map(async (link) => ({
      taskId: link.targetId,
      linkReason: link.linkReason,
      artifacts: await dependencies.listTaskExecutionArtifacts(link.targetId, user.id),
    })),
  )

  return artifactRows.filter((row) => row.artifacts.length > 0)
}

export async function completeAcceptedBreakdownStepForIdea(
  input: {
    ideaId: string
    stepId: string
  },
  dependencies: {
    resolveUser: () => Promise<{ user: { id: string } }>
    completeAcceptedBreakdownStep: (input: { ideaId: string; stepId: string }, userId: string) => Promise<{ ok: true }>
    listAcceptedBreakdownSteps: (ideaId: string, userId: string) => Promise<Array<{
      id: string
      stepOrder: number
      stepText: string
      completedAt: Date | null
    }>>
    recordProgressUpdateForIdeaThread?: (
      ideaId: string,
      input: { summary: string; stepOrder?: number; status?: 'completed' | 'reopened' },
    ) => Promise<unknown>
  },
) {
  const { user } = await dependencies.resolveUser()
  const steps = await dependencies.listAcceptedBreakdownSteps(input.ideaId, user.id)
  const step = steps.find((candidate) => candidate.id === input.stepId)

  if (!step) {
    throw new Error('Accepted breakdown step not found')
  }

  const result = await dependencies.completeAcceptedBreakdownStep(input, user.id)
  await dependencies.recordProgressUpdateForIdeaThread?.(input.ideaId, {
    summary: `Marked accepted breakdown step #${step.stepOrder} done: ${step.stepText}`,
    stepOrder: step.stepOrder,
    status: 'completed',
  })

  return result
}

export async function uncompleteAcceptedBreakdownStepForIdea(
  input: {
    ideaId: string
    stepId: string
  },
  dependencies: {
    resolveUser: () => Promise<{ user: { id: string } }>
    uncompleteAcceptedBreakdownStep: (input: { ideaId: string; stepId: string }, userId: string) => Promise<{ ok: true }>
    listAcceptedBreakdownSteps: (ideaId: string, userId: string) => Promise<Array<{
      id: string
      stepOrder: number
      stepText: string
      completedAt: Date | null
    }>>
    recordProgressUpdateForIdeaThread?: (
      ideaId: string,
      input: { summary: string; stepOrder?: number; status?: 'completed' | 'reopened' },
    ) => Promise<unknown>
  },
) {
  const { user } = await dependencies.resolveUser()
  const steps = await dependencies.listAcceptedBreakdownSteps(input.ideaId, user.id)
  const step = steps.find((candidate) => candidate.id === input.stepId)

  if (!step) {
    throw new Error('Accepted breakdown step not found')
  }

  const result = await dependencies.uncompleteAcceptedBreakdownStep(input, user.id)
  await dependencies.recordProgressUpdateForIdeaThread?.(input.ideaId, {
    summary: `Reopened accepted breakdown step #${step.stepOrder}: ${step.stepText}`,
    stepOrder: step.stepOrder,
    status: 'reopened',
  })

  return result
}

export const completeAcceptedBreakdownStep = createServerFn({ method: 'POST' })
  .inputValidator((input: { ideaId: string; stepId: string }) => input)
  .handler(async ({ data }) => {
    return completeAcceptedBreakdownStepForIdea(data, {
      resolveUser: async () => {
        const { user } = await resolveAuthenticatedPlannerUser(db)
        return { user }
      },
      completeAcceptedBreakdownStep: (input, userId) => ideasService.completeAcceptedBreakdownStep(input, userId),
      listAcceptedBreakdownSteps: (ideaId, userId) => ideasService.listAcceptedBreakdownSteps(ideaId, userId),
      recordProgressUpdateForIdeaThread: (ideaId, input) =>
        assistantThreadService.recordProgressUpdateForIdeaThread(ideaId, input),
    })
  })

export const uncompleteAcceptedBreakdownStep = createServerFn({ method: 'POST' })
  .inputValidator((input: { ideaId: string; stepId: string }) => input)
  .handler(async ({ data }) => {
    return uncompleteAcceptedBreakdownStepForIdea(data, {
      resolveUser: async () => {
        const { user } = await resolveAuthenticatedPlannerUser(db)
        return { user }
      },
      uncompleteAcceptedBreakdownStep: (input, userId) => ideasService.uncompleteAcceptedBreakdownStep(input, userId),
      listAcceptedBreakdownSteps: (ideaId, userId) => ideasService.listAcceptedBreakdownSteps(ideaId, userId),
      recordProgressUpdateForIdeaThread: (ideaId, input) =>
        assistantThreadService.recordProgressUpdateForIdeaThread(ideaId, input),
    })
  })

export async function convertIdeaToTaskAndLink(
  input: {
    ideaId: string
    proposalId: string
  },
  dependencies: ConvertIdeaToTaskDependencies,
) {
  const { user } = await dependencies.resolveUser()
  const acceptance = await dependencies.acceptIdeaThreadStructuredAction(input.ideaId, {
    proposalId: input.proposalId,
  })

  if (!acceptance.taskCreationPayload) {
    throw new Error('Accepted structured action did not return a task payload')
  }

  const taskResult = await dependencies.createTask(user.id, {
    title: acceptance.taskCreationPayload.taskTitle,
    notes: acceptance.taskCreationPayload.taskDescription,
    priority: 'medium',
    dueDate: undefined,
    dueTime: undefined,
    reminderAt: undefined,
    estimatedMinutes: undefined,
    preferredStartTime: undefined,
    preferredEndTime: undefined,
  })

  await dependencies.createIdeaExecutionLink(
    {
      ideaId: input.ideaId,
      targetType: 'task',
      targetId: taskResult.id,
      linkReason: 'Accepted task conversion from developed idea.',
    },
    user.id,
  )

  await dependencies.recordTaskCreatedForIdeaThread?.(input.ideaId, {
    taskId: taskResult.id,
    summary: `Created task ${acceptance.taskCreationPayload.taskTitle} from the accepted idea conversion.`,
  })

  return {
    ok: true as const,
    taskId: taskResult.id,
    thread: acceptance.thread,
  }
}

export async function convertAcceptedBreakdownStepToTaskAndLink(
  input: {
    ideaId: string
    stepId: string
  },
  dependencies: ConvertAcceptedBreakdownStepToTaskDependencies,
) {
  const { user } = await dependencies.resolveUser()
  const acceptedSteps = await dependencies.listAcceptedBreakdownSteps(input.ideaId, user.id)
  const selectedStep = acceptedSteps.find((step) => step.id === input.stepId)

  if (!selectedStep) {
    throw new Error('Accepted breakdown step not found')
  }

  const linkReason = `Accepted breakdown step #${selectedStep.stepOrder} from idea.`
  const existingTaskLink = await dependencies.listIdeaExecutionLinks(
    {
      ideaId: input.ideaId,
      targetType: 'task',
    },
    user.id,
  )
    .then((links) => links.find((link) => link.linkReason === linkReason))

  if (existingTaskLink) {
    return {
      ok: true as const,
      taskId: existingTaskLink.targetId,
      step: selectedStep,
    }
  }

  const taskTitle = selectedStep.stepText.length > 120
    ? `${selectedStep.stepText.slice(0, 117).trimEnd()}...`
    : selectedStep.stepText

  const taskResult = await dependencies.createTask(user.id, {
    title: taskTitle,
    notes: selectedStep.stepText,
    priority: 'medium',
    dueDate: undefined,
    dueTime: undefined,
    reminderAt: undefined,
    estimatedMinutes: undefined,
    preferredStartTime: undefined,
    preferredEndTime: undefined,
  })

  await dependencies.createIdeaExecutionLink(
    {
      ideaId: input.ideaId,
      targetType: 'task',
      targetId: taskResult.id,
      linkReason,
    },
    user.id,
  )

  await dependencies.recordTaskCreatedForIdeaThread?.(input.ideaId, {
    taskId: taskResult.id,
    summary: `Created task ${selectedStep.stepText} from accepted breakdown step #${selectedStep.stepOrder}.`,
    stepOrder: selectedStep.stepOrder,
  })

  return {
    ok: true as const,
    taskId: taskResult.id,
    step: selectedStep,
  }
}

export function parseBreakdownSummaryToSteps(summary: string) {
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)-])\s+/, '').trim())
    .filter((line) => line.length > 0)
    .map((stepText, index) => ({
      stepOrder: index + 1,
      stepText,
    }))
}

export async function acceptIdeaBreakdownAndPersistSteps(
  input: {
    ideaId: string
    proposalId: string
  },
  dependencies: AcceptIdeaBreakdownDependencies,
) {
  const { user } = await dependencies.resolveUser()
  const currentThread = await dependencies.getIdeaThread(input.ideaId)
  const proposedSummary = currentThread.pendingStructuredAction?.action === 'breakdown'
    ? currentThread.pendingStructuredAction.proposedSummary
    : null

  if (!proposedSummary) {
    throw new Error('No breakdown proposal summary available')
  }

  const acceptance = await dependencies.acceptIdeaThreadStructuredAction(input.ideaId, {
    proposalId: input.proposalId,
  })

  const steps = parseBreakdownSummaryToSteps(proposedSummary)

  if (steps.length === 0) {
    throw new Error('Accepted breakdown summary did not contain any steps')
  }

  await dependencies.createAcceptedBreakdownSteps(
    {
      ideaId: input.ideaId,
      steps,
    },
    user.id,
  )

  await dependencies.recordBreakdownPlanForIdeaThread?.(input.ideaId, {
    summary: `Stored accepted breakdown plan with ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}.`,
    stepCount: steps.length,
  })

  return {
    ok: true as const,
    steps,
    thread: acceptance.thread,
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

export const listIdeaExecutionLinks = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string; targetType?: 'task' | 'habit' }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.listIdeaExecutionLinks(
      {
        ideaId: data.id,
        targetType: data.targetType,
      },
      user.id,
    )
  })

export const listAcceptedBreakdownSteps = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return listAcceptedBreakdownStepsForIdea(data.id, {
      resolveUser: () => resolveAuthenticatedPlannerUser(db),
      listAcceptedBreakdownSteps: (ideaId, userId) => ideasService.listAcceptedBreakdownSteps(ideaId, userId),
      listIdeaExecutionLinks: (input, userId) => ideasService.listIdeaExecutionLinks(input, userId),
      listTasks: (userId) => tasksService.listTasks(userId),
    })
  })

export const listLinkedTaskExecutionArtifacts = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return listLinkedTaskExecutionArtifactsForIdea(data.id, {
      resolveUser: async () => {
        const { user } = await resolveAuthenticatedPlannerUser(db)
        return { user }
      },
      listIdeaExecutionLinks: (input, userId) => ideasService.listIdeaExecutionLinks(input, userId),
      listTaskExecutionArtifacts: (taskId, userId) => tasksService.listTaskExecutionArtifacts(taskId, userId),
    })
  })

export const convertAcceptedBreakdownStepToTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { ideaId: string; stepId: string }) => input)
  .handler(async ({ data }) => {
    return convertAcceptedBreakdownStepToTaskAndLink(data, {
      resolveUser: () => resolveAuthenticatedPlannerUser(db),
      listAcceptedBreakdownSteps: (ideaId, userId) => ideasService.listAcceptedBreakdownSteps(ideaId, userId),
      listIdeaExecutionLinks: (input, userId) => ideasService.listIdeaExecutionLinks(input, userId),
      createTask: (userId, input) => tasksService.createTask(userId, input),
      createIdeaExecutionLink: (input, userId) => ideasService.createIdeaExecutionLink(input, userId),
      recordTaskCreatedForIdeaThread: (ideaId, input) =>
        assistantThreadService.recordTaskCreatedForIdeaThread(ideaId, input),
    })
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
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const executionSummary = await getExecutionSummaryForIdea(data.id, user.id)

    return assistantThreadService.submitIdeaDiscoveryTurn(data.id, {
      message: data.message,
      executionSummary: executionSummary ?? undefined,
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

    const executionSummary = await getExecutionSummaryForIdea(data.id, user.id)

    return assistantThreadService.requestIdeaThreadElaboration(data.id, {
      actionInput: data.actionInput,
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
      executionSummary: executionSummary ?? undefined,
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

    const executionSummary = await getExecutionSummaryForIdea(data.id, user.id)

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
        executionSummary: executionSummary ?? undefined,
      })
    }

    return assistantThreadService.requestIdeaThreadSummaryImprovement(data.id, {
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
      executionSummary: executionSummary ?? undefined,
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

    const executionSummary = await getExecutionSummaryForIdea(data.id, user.id)

    const currentThread = await assistantThreadService.getIdeaThread(data.id)

    if (data.kind === 'restructure') {
      if (currentThread.stage === 'discovery') {
        throw new Error('Restructure is only available once the idea reaches framing.')
      }

      return assistantThreadService.requestIdeaThreadRestructure(data.id, {
        currentSnapshotVersion: latestSnapshot.version,
        currentTitle: latestSnapshot.title,
        currentBody: latestSnapshot.body,
        currentSummary: latestSnapshot.threadSummary,
        executionSummary: executionSummary ?? undefined,
      })
    }

    if (!canUseIdeaRefinementActions(currentThread.stage)) {
      throw new Error('Next-step breakdown is only available for developed ideas.')
    }

    return assistantThreadService.requestIdeaThreadBreakdown(data.id, {
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
      executionSummary: executionSummary ?? undefined,
    })
  })

export const requestIdeaConvertToTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
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

    const executionSummary = await getExecutionSummaryForIdea(data.id, user.id)

    const currentThread = await assistantThreadService.getIdeaThread(data.id)

    if (!canUseIdeaRefinementActions(currentThread.stage)) {
      throw new Error('Convert to task is only available for developed ideas.')
    }

    return assistantThreadService.requestIdeaThreadConvertToTask(data.id, {
      currentSnapshotVersion: latestSnapshot.version,
      currentTitle: latestSnapshot.title,
      currentBody: latestSnapshot.body,
      currentSummary: latestSnapshot.threadSummary,
      executionSummary: executionSummary ?? undefined,
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

export const convertIdeaToTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string }) => input)
  .handler(async ({ data }) => {
    return convertIdeaToTaskAndLink(
      {
        ideaId: data.id,
        proposalId: data.proposalId,
      },
      {
        resolveUser: async () => {
          const { user } = await resolveAuthenticatedPlannerUser(db)
          return { user }
        },
        acceptIdeaThreadStructuredAction: (ideaId, input) =>
          assistantThreadService.acceptIdeaThreadStructuredAction(ideaId, input),
        createTask: (userId, input) => tasksService.createTask(userId, input),
        createIdeaExecutionLink: (input, userId) => ideasService.createIdeaExecutionLink(input, userId),
        recordTaskCreatedForIdeaThread: (ideaId, input) =>
          assistantThreadService.recordTaskCreatedForIdeaThread(ideaId, input),
      },
    )
  })

export const acceptIdeaBreakdown = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; proposalId: string }) => input)
  .handler(async ({ data }) => {
    return acceptIdeaBreakdownAndPersistSteps(
      {
        ideaId: data.id,
        proposalId: data.proposalId,
      },
      {
        resolveUser: async () => {
          const { user } = await resolveAuthenticatedPlannerUser(db)
          return { user }
        },
        getIdeaThread: (ideaId) => assistantThreadService.getIdeaThread(ideaId),
        acceptIdeaThreadStructuredAction: (ideaId, input) =>
          assistantThreadService.acceptIdeaThreadStructuredAction(ideaId, input),
        createAcceptedBreakdownSteps: (input, userId) =>
          ideasService.createAcceptedBreakdownSteps(input, userId),
        recordBreakdownPlanForIdeaThread: (ideaId, input) =>
          assistantThreadService.recordBreakdownPlanForIdeaThread(ideaId, input),
      },
    )
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
