import type { Database } from '../db/client'
import { inferDueDateFromInput, tokenizeForCaptureMatching, type VisibleTaskSummary } from '../lib/capture'
import { createIdeasService } from './ideas-service'
import { createTasksService } from './tasks-service'

function normalizeTranscriptForMatching(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function inferDueTimeFromTranscript(transcript: string) {
  const normalized = normalizeTranscriptForMatching(transcript)

  const explicitTime = normalized.match(/\b(?:a las|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)

  if (!explicitTime) {
    return null
  }

  let hour = Number(explicitTime[1])
  const minute = explicitTime[2] ? Number(explicitTime[2]) : 0
  const meridiem = explicitTime[3]

  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  if (meridiem === 'pm' && hour < 12) {
    hour += 12
  }

  if (meridiem === 'am' && hour === 12) {
    hour = 0
  }

  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`
}

function inferStatusCueFromTranscript(transcript: string) {
  const normalized = normalizeTranscriptForMatching(transcript)

  if (/\b(pendiente|pending|activa|activo|open|abierta|abierto)\b/.test(normalized)) {
    return 'active' as const
  }

  if (/\b(completada|completado|completed|done|cerrada|cerrado|closed|finish(?:ed)?)\b/.test(normalized)) {
    return 'completed' as const
  }

  return null
}

function scoreVisibleTaskMatch(
  task: VisibleTaskSummary,
  transcriptTokens: string[],
  transcript: string,
  currentDate: string | undefined,
  timezone: string | undefined,
) {
  const taskTokens = tokenizeForCaptureMatching(task.title)
  const titleOverlap = taskTokens.filter((token) => transcriptTokens.includes(token)).length
  const inferredDueDate = currentDate && timezone ? inferDueDateFromInput(transcript, currentDate, timezone) : null
  const inferredDueTime = inferDueTimeFromTranscript(transcript)
  const inferredStatus = inferStatusCueFromTranscript(transcript)
  const dueDateMatches = !!(inferredDueDate && task.dueDate === inferredDueDate)
  const dueTimeMatches = !!(inferredDueTime && task.dueTime === inferredDueTime)
  const statusMatches = !!(inferredStatus && task.status === inferredStatus)
  const hasMeaningfulCue = titleOverlap > 0 || dueDateMatches || dueTimeMatches || statusMatches

  if (!hasMeaningfulCue) {
    return null
  }

  return {
    task,
    score: titleOverlap * 10 + (dueDateMatches ? 8 : 0) + (dueTimeMatches ? 6 : 0) + (statusMatches ? 4 : 0),
  }
}

export type ResolvedVoiceTaskTarget = {
  id: string
  title: string
  status: 'active' | 'completed' | 'archived'
  dueDate: string | null
  dueTime: string | null
  priority: 'low' | 'medium' | 'high'
  completedAt: string | null
  source: 'context_task' | 'context_idea' | 'visible_window'
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
      transcript?: string
      currentDate?: string
      timezone?: string
      contextTaskId?: string | null
      contextIdeaId?: string | null
      visibleTaskWindow?: Array<VisibleTaskSummary> | null
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

      if (input.contextIdeaId) {
        const links = await ideasService.listIdeaExecutionLinks(
          {
            ideaId: input.contextIdeaId,
            targetType: 'task',
          },
          input.userId,
        )

        if (links.length > 0) {
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
        }
      }

      const visibleTaskWindow = (input.visibleTaskWindow ?? []).filter(
        (task) => task.status !== 'archived',
      )

      const transcriptTokens = tokenizeForCaptureMatching(input.transcript ?? '')

      if (visibleTaskWindow.length === 0 || transcriptTokens.length === 0) {
        return { kind: 'unresolved' }
      }

      const scoredMatches = visibleTaskWindow
        .map((task) =>
          scoreVisibleTaskMatch(task, transcriptTokens, input.transcript ?? '', input.currentDate, input.timezone),
        )
        .filter((match): match is NonNullable<typeof match> => match !== null)
        .sort((left, right) => right.score - left.score)

      if (scoredMatches.length === 0) {
        return { kind: 'unresolved' }
      }

      const bestScore = scoredMatches[0]?.score ?? 0
      const matchedTasks = scoredMatches
        .filter((match) => match.score === bestScore)
        .map((match) => match.task)

      if (matchedTasks.length === 1) {
        const task = matchedTasks[0]
        return {
          kind: 'resolved',
          task: {
            ...task,
            source: 'visible_window',
          },
        }
      }

      if (matchedTasks.length > 1) {
        return {
          kind: 'ambiguous',
          candidates: matchedTasks.map((task) => ({
            ...task,
            source: 'visible_window' as const,
          })),
        }
      }

      return { kind: 'unresolved' }
    },
  }
}
