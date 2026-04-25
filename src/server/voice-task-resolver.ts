import type { Database } from '../db/client'
import { createIdeasService } from './ideas-service'
import { createTasksService } from './tasks-service'

export type ResolvedVoiceTaskTarget = {
  id: string
  title: string
  status: 'active' | 'completed' | 'archived'
  dueDate: string | null
  dueTime: string | null
  priority: 'low' | 'medium' | 'high'
  completedAt: string | null
  source: 'context_task' | 'context_idea'
}

export type VoiceTaskTargetResolution =
  | {
      kind: 'resolved'
      task: ResolvedVoiceTaskTarget
    }
  | {
      kind: 'ambiguous'
      candidates: Array<ResolvedVoiceTaskTarget>
    }
  | {
      kind: 'unresolved'
    }

export function createVoiceTaskResolver(database: Database) {
  const ideasService = createIdeasService(database)
  const tasksService = createTasksService(database)

  return {
    async resolveTaskTarget(input: {
      userId: string
      contextTaskId?: string | null
      contextIdeaId?: string | null
    }): Promise<VoiceTaskTargetResolution> {
      if (input.contextTaskId) {
        const task = await tasksService.getTaskStatusDetails(input.contextTaskId, input.userId)
        if (task) {
          return {
            kind: 'resolved',
            task: {
              id: task.id,
              title: task.title,
              status: task.status,
              dueDate: task.dueDate,
              dueTime: task.dueTime,
              priority: task.priority,
              completedAt: task.completedAt?.toISOString() ?? null,
              source: 'context_task',
            },
          }
        }
      }

      if (!input.contextIdeaId) {
        return { kind: 'unresolved' }
      }

      const links = await ideasService.listIdeaExecutionLinks(
        {
          ideaId: input.contextIdeaId,
          targetType: 'task',
        },
        input.userId,
      )

      if (links.length === 0) {
        return { kind: 'unresolved' }
      }

      const uniqueTaskIds = [...new Set(links.map((link) => link.targetId))]
      const linkedTasks = await Promise.all(
        uniqueTaskIds.map((taskId) => tasksService.getTaskStatusDetails(taskId, input.userId)),
      )
      const resolvedTasks = linkedTasks
        .filter((task): task is NonNullable<typeof task> => task !== undefined)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          priority: task.priority,
          completedAt: task.completedAt?.toISOString() ?? null,
          source: 'context_idea' as const,
        }))

      if (resolvedTasks.length === 1) {
        return {
          kind: 'resolved',
          task: resolvedTasks[0],
        }
      }

      if (resolvedTasks.length > 1) {
        return {
          kind: 'ambiguous',
          candidates: resolvedTasks,
        }
      }

      return { kind: 'unresolved' }
    },
  }
}
