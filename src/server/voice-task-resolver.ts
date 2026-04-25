import type { Database } from '../db/client'
import { inferDueDateFromInput, tokenizeForCaptureMatching, type VisibleTaskSummary } from '../lib/capture'
import { createIdeasService } from './ideas-service'
import { createTasksService } from './tasks-service'

type LocalDateParts = {
  year: number
  month: number
  day: number
}

const VISIBLE_TASK_MATCH_STOPWORDS = new Set([
  'about',
  'active',
  'activa',
  'activo',
  'around',
  'cierra',
  'cierre',
  'close',
  'cerrada',
  'cerrado',
  'closed',
  'complete',
  'completed',
  'completar',
  'completada',
  'completado',
  'completemos',
  'con',
  'del',
  'done',
  'estado',
  'esta',
  'este',
  'finish',
  'finished',
  'for',
  'from',
  'mark',
  'marca',
  'marcar',
  'into',
  'las',
  'los',
  'open',
  'onto',
  'para',
  'pendiente',
  'pending',
  'por',
  'que',
  'related',
  'relacionada',
  'relacionado',
  'reopen',
  'reopened',
  'reabrir',
  'show',
  'status',
  'todo',
  'task',
  'tasks',
  'tarea',
  'tareas',
  'that',
  'the',
  'this',
  'una',
  'uno',
  'unas',
  'unos',
  'with',
])

function normalizeTranscriptForMatching(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function formatDateString(parts: LocalDateParts) {
  return [parts.year, `${parts.month}`.padStart(2, '0'), `${parts.day}`.padStart(2, '0')].join('-')
}

function parseCurrentDateString(currentDate: string) {
  const [year, month, day] = currentDate.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  } satisfies LocalDateParts
}

function addUtcDays(parts: LocalDateParts, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0))
  next.setUTCDate(next.getUTCDate() + days)

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  } satisfies LocalDateParts
}

function getUtcWeekday(parts: LocalDateParts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0)).getUTCDay()
}

function getNextOrSameUtcWeekday(parts: LocalDateParts, targetDay: number) {
  const currentDay = getUtcWeekday(parts)
  const delta = (targetDay - currentDay + 7) % 7
  return addUtcDays(parts, delta)
}

function inferDueTimeFromTranscript(transcript: string) {
  const normalized = normalizeTranscriptForMatching(transcript)

  const spanishHourWords: Record<string, number> = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  }

  const explicitTime = normalized.match(/\b(?:a las|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)

  if (!explicitTime) {
    const spokenSpanishTime = normalized.match(/\b(?:a las)\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/)

    if (spokenSpanishTime) {
      const hour = spanishHourWords[spokenSpanishTime[1]]

      if (hour) {
        return `${`${hour}`.padStart(2, '0')}:00`
      }
    }
  }

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

function inferWeekdayDueDateFromTranscript(transcript: string, currentDate: string | undefined) {
  if (!currentDate) {
    return null
  }

  const normalized = normalizeTranscriptForMatching(transcript)
  const baseDate = parseCurrentDateString(currentDate)

  if (!baseDate) {
    return null
  }

  const weekdayMatchers: Array<{ day: number; pattern: RegExp }> = [
    { day: 0, pattern: /\b(sunday|domingo)\b/ },
    { day: 1, pattern: /\b(monday|lunes)\b/ },
    { day: 2, pattern: /\b(tuesday|martes)\b/ },
    { day: 3, pattern: /\b(wednesday|miercoles)\b/ },
    { day: 4, pattern: /\b(thursday|jueves)\b/ },
    { day: 5, pattern: /\b(friday|viernes)\b/ },
    { day: 6, pattern: /\b(saturday|sabado)\b/ },
  ]

  const matchedWeekday = weekdayMatchers.find(({ pattern }) => pattern.test(normalized))

  if (!matchedWeekday) {
    return null
  }

  return formatDateString(getNextOrSameUtcWeekday(baseDate, matchedWeekday.day))
}

function filterVisibleTaskMatchTokens(tokens: string[]) {
  return tokens.filter((token) => !VISIBLE_TASK_MATCH_STOPWORDS.has(token))
}

function hasStrongVisibleTaskTitleSignal(overlapCount: number, taskTokenCount: number) {
  if (overlapCount === 0 || taskTokenCount === 0) {
    return false
  }

  if (taskTokenCount === 1) {
    return overlapCount === 1
  }

  return overlapCount >= 2
}

function scoreVisibleTaskMatch(
  task: VisibleTaskSummary,
  transcriptTokens: string[],
  transcript: string,
  currentDate: string | undefined,
  timezone: string | undefined,
) {
  const taskTokens = filterVisibleTaskMatchTokens(tokenizeForCaptureMatching(task.title))
  const titleOverlap = taskTokens.filter((token) => transcriptTokens.includes(token)).length
  const inferredDueDate =
    (currentDate && timezone ? inferDueDateFromInput(transcript, currentDate, timezone) : null) ??
    inferWeekdayDueDateFromTranscript(transcript, currentDate)
  const inferredDueTime = inferDueTimeFromTranscript(transcript)
  const inferredStatus = inferStatusCueFromTranscript(transcript)
  const dueDateMatches = !!(inferredDueDate && task.dueDate === inferredDueDate)
  const dueTimeMatches = !!(inferredDueTime && task.dueTime === inferredDueTime)
  const statusMatches = !!(inferredStatus && task.status === inferredStatus)
  const strongTitleSignal = hasStrongVisibleTaskTitleSignal(titleOverlap, taskTokens.length)
  const structuralCueCount = [dueDateMatches, dueTimeMatches, statusMatches].filter(Boolean).length
  const hasMeaningfulCue = strongTitleSignal || structuralCueCount >= 2 || (titleOverlap >= 1 && structuralCueCount >= 1)

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
  notes?: string | null
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
              notes: task.notes,
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
              notes: task.notes,
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

      const transcriptTokens = filterVisibleTaskMatchTokens(tokenizeForCaptureMatching(input.transcript ?? ''))

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
