import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { taskCreateSchema, taskUpdateSchema } from '../lib/tasks'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createAssistantThreadService } from './assistant-thread-service'
import { createIdeasService } from './ideas-service'
import { createTasksService } from './tasks-service'

const tasksService = createTasksService(db)
const ideasService = createIdeasService(db)
const assistantThreadService = createAssistantThreadService(db)

export async function completeTaskWithArtifacts(
  input: {
    id: string
    resultArtifactContent?: string
    evidenceArtifactContent?: string
  },
  dependencies: {
    resolveUser: () => Promise<{ user: { id: string } }>
    createTaskExecutionArtifact: (
      input: {
        taskId: string
        artifactType: 'result' | 'evidence' | 'review'
        source?: 'user' | 'assistant' | 'system'
        content: string
      },
      userId: string,
    ) => Promise<{ ok: true } | { ok: true; id: string }>
    completeTask: (taskId: string, userId: string) => Promise<{ ok: true }>
    listIdeaExecutionLinks: (
      input: {
        ideaId: string
        targetType?: 'task' | 'habit'
      },
      userId: string,
    ) => Promise<Array<{
      ideaId: string
      targetId: string
      targetType: 'task' | 'habit'
      linkReason: string | null
    }>>
    listIdeas?: (userId: string) => Promise<Array<{ id: string }>>
    recordProgressUpdateForIdeaThread?: (
      ideaId: string,
      input: {
        summary: string
        stepOrder?: number
        status?: 'completed' | 'reopened'
      },
    ) => Promise<unknown>
  },
) {
  const { user } = await dependencies.resolveUser()
  const trimmedResult = input.resultArtifactContent?.trim() ?? ''
  const trimmedEvidence = input.evidenceArtifactContent?.trim() ?? ''

  if (trimmedResult) {
    await dependencies.createTaskExecutionArtifact({
      taskId: input.id,
      artifactType: 'result',
      content: trimmedResult,
    }, user.id)
  }

  if (trimmedEvidence) {
    await dependencies.createTaskExecutionArtifact({
      taskId: input.id,
      artifactType: 'evidence',
      content: trimmedEvidence,
    }, user.id)
  }

  const completionResult = await dependencies.completeTask(input.id, user.id)

  if (!trimmedResult) {
    return completionResult
  }

  const ideas = await dependencies.listIdeas?.(user.id) ?? []

  for (const idea of ideas) {
    const links = await dependencies.listIdeaExecutionLinks({ ideaId: idea.id, targetType: 'task' }, user.id)
    const matchedLink = links.find((link) => link.targetId === input.id && link.linkReason?.startsWith('Accepted breakdown step #'))

    if (!matchedLink?.linkReason) {
      continue
    }

    const stepOrderMatch = matchedLink.linkReason.match(/Accepted breakdown step #(\d+) from idea\./)
    const stepOrder = stepOrderMatch ? Number(stepOrderMatch[1]) : undefined

    await dependencies.recordProgressUpdateForIdeaThread?.(idea.id, {
      summary: `Completed task for step ${stepOrder ?? 'unknown'} with recorded output.`,
      stepOrder,
      status: 'completed',
    })
    break
  }

  return completionResult
}

export const listTasks = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return tasksService.listTasksWithCalendarLinks(user.id)
})

export const createTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskCreateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.createTask(user.id, data)
  })

export const updateTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskUpdateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.updateTask(user.id, data)
  })

export const completeTask = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    id: string
    resultArtifactContent?: string
    evidenceArtifactContent?: string
  }) => input)
  .handler(async ({ data }) => {
    return completeTaskWithArtifacts(data, {
      resolveUser: () => resolveAuthenticatedPlannerUser(db),
      createTaskExecutionArtifact: (input, userId) => tasksService.createTaskExecutionArtifact(input, userId),
      completeTask: (taskId, userId) => tasksService.completeTask(taskId, userId),
      listIdeaExecutionLinks: (input, userId) => ideasService.listIdeaExecutionLinks(input, userId),
      listIdeas: (userId) => ideasService.listIdeas(userId),
      recordProgressUpdateForIdeaThread: (ideaId, input) =>
        assistantThreadService.recordProgressUpdateForIdeaThread(ideaId, input),
    })
  })

export const listTaskExecutionArtifacts = createServerFn({ method: 'GET' })
  .inputValidator((input: { taskId: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.listTaskExecutionArtifacts(data.taskId, user.id)
  })

export const createTaskExecutionArtifact = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    taskId: string
    artifactType: 'result' | 'evidence' | 'review'
    source?: 'user' | 'assistant' | 'system'
    content: string
  }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.createTaskExecutionArtifact(data, user.id)
  })

export const reopenTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.reopenTask(data.id, user.id)
  })

export const archiveTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.archiveTask(data.id, user.id)
  })

export const deferTaskReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.deferTaskReminder(data.id, user.id, data.minutes)
  })
