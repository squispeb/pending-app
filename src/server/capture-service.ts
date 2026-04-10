import { and, eq, gte, inArray } from 'drizzle-orm'
import type { Database } from '../db/client'
import { calendarConnections, calendarEvents } from '../db/schema'
import {
  buildHeuristicTaskDraft,
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  interpretCaptureInputSchema,
  mergeTypedTaskDrafts,
  type ConfirmCapturedHabitInput,
  type ConfirmCapturedTaskInput,
  type InterpretCaptureFailure,
  type InterpretCaptureInput,
  type InterpretCaptureSuccess,
} from '../lib/capture'
import type { CaptureInterpreter } from './capture-interpreter'
import { CaptureInterpreterError, createRemoteCaptureInterpreter } from './capture-interpreter'
import { createHabitsService } from './habits-service'
import { replacePlanningItemCalendarLink } from './planning-item-calendar-links'
import { createTasksService } from './tasks-service'

type CaptureCalendarContextCandidate = {
  calendarEventId: string
  summary: string
  calendarName: string
  startsAt: string
  recurring: boolean
  reason: string
}

function tokenizeForCaptureMatching(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3)
}

function rankCalendarMatch(
  normalizedInput: string,
  summary: string,
  startsAt: Date,
  recurring: boolean,
  now: Date,
) {
  const inputLower = normalizedInput.toLowerCase()
  const summaryLower = summary.toLowerCase()
  const inputTokens = new Set(tokenizeForCaptureMatching(normalizedInput))
  const summaryTokens = tokenizeForCaptureMatching(summary)
  const overlapCount = summaryTokens.filter((token) => inputTokens.has(token)).length
  const overlapRatio = summaryTokens.length ? overlapCount / summaryTokens.length : 0
  const exactSubstring =
    inputLower.includes(summaryLower) ||
    (summaryLower.length >= 6 && summaryLower.includes(inputLower))
  const daysAway = Math.max(
    0,
    Math.round((startsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  )
  const futureBonus = Math.max(0, 10 - Math.min(daysAway, 10))
  const score =
    (exactSubstring ? 100 : 0) +
    overlapCount * 12 +
    Math.round(overlapRatio * 20) +
    (recurring ? 25 : 0) +
    futureBonus

  if (!exactSubstring && overlapCount === 0) {
    return null
  }

  if (!exactSubstring && overlapRatio < 0.34) {
    return null
  }

  return score
}

function buildCalendarMatchReason(summary: string, recurring: boolean) {
  return recurring
    ? `Matched recurring event: ${summary}`
    : `Matched calendar event: ${summary}`
}

export function createCaptureService(
  database: Database,
  interpreter: CaptureInterpreter | null = createRemoteCaptureInterpreter(),
) {
  const tasksService = createTasksService(database)
  const habitsService = createHabitsService(database)

  async function findRelevantCalendarContext(
    userId: string,
    normalizedInput: string,
    currentDate: string,
  ): Promise<Array<CaptureCalendarContextCandidate>> {
    const selectedConnections = await database.query.calendarConnections.findMany({
      where: and(eq(calendarConnections.userId, userId), eq(calendarConnections.isSelected, true)),
    })
    const selectedCalendarIds = selectedConnections.map((connection) => connection.calendarId)

    if (!selectedCalendarIds.length) {
      return []
    }

    const now = new Date(`${currentDate}T12:00:00.000Z`)
    const upcomingWindowStart = new Date(now)
    upcomingWindowStart.setDate(upcomingWindowStart.getDate() - 14)

    const events = await database.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, userId),
        inArray(calendarEvents.calendarId, selectedCalendarIds),
        gte(calendarEvents.endsAt, upcomingWindowStart),
      ),
    })

    const connectionByCalendarId = new Map(
      selectedConnections.map((connection) => [connection.calendarId, connection]),
    )
    const ranked = events
      .filter((event) => !!event.summary)
      .map((event) => {
        const summary = event.summary ?? ''
        const recurring = !!event.googleRecurringEventId
        const score = rankCalendarMatch(normalizedInput, summary, event.startsAt, recurring, now)

        if (score === null) {
          return null
        }

        return {
          score,
          candidate: {
            calendarEventId: event.id,
            summary,
            calendarName: connectionByCalendarId.get(event.calendarId)?.calendarName ?? event.calendarId,
            startsAt: event.startsAt.toISOString(),
            recurring,
            reason: buildCalendarMatchReason(summary, recurring),
          } satisfies CaptureCalendarContextCandidate,
        }
      })
      .filter((value): value is { score: number; candidate: CaptureCalendarContextCandidate } => value !== null)
      .sort((left, right) => right.score - left.score)

    const deduped = new Map<string, CaptureCalendarContextCandidate>()

    for (const { candidate } of ranked) {
      const key = `${candidate.summary.toLowerCase()}::${candidate.recurring ? 'recurring' : candidate.calendarEventId}`

      if (!deduped.has(key)) {
        deduped.set(key, candidate)
      }

      if (deduped.size >= 3) {
        break
      }
    }

    return [...deduped.values()]
  }

  return {
    async interpretTypedTaskInput(
      userId: string,
      input: InterpretCaptureInput,
    ): Promise<InterpretCaptureSuccess | InterpretCaptureFailure> {
      const parsed = interpretCaptureInputSchema.parse(input)
      const heuristicDraft = buildHeuristicTaskDraft(parsed)
      const calendarContext = await findRelevantCalendarContext(
        userId,
        heuristicDraft.normalizedInput,
        parsed.currentDate,
      )

      if (calendarContext[0]) {
        heuristicDraft.matchedCalendarContext = {
          calendarEventId: calendarContext[0].calendarEventId,
          summary: calendarContext[0].summary,
          reason: calendarContext[0].reason,
        }
        heuristicDraft.interpretationNotes = [
          ...heuristicDraft.interpretationNotes,
          calendarContext[0].reason,
        ]
      }

      if (!heuristicDraft.normalizedInput) {
        return {
          ok: false,
          code: 'EMPTY_INPUT',
          message: 'Enter some text before interpreting a task.',
          rawInput: parsed.rawInput,
        }
      }

      if (!interpreter) {
        return {
          ok: true,
          draft: heuristicDraft,
        }
      }

      try {
        const providerDraft = await interpreter.interpretTypedTask({
          normalizedInput: heuristicDraft.normalizedInput,
          currentDate: parsed.currentDate,
          timezone: parsed.timezone,
          languageHint: parsed.languageHint,
          calendarContext,
        })

        return {
          ok: true,
          draft: mergeTypedTaskDrafts(heuristicDraft, providerDraft),
        }
      } catch (error) {
        if (error instanceof CaptureInterpreterError) {
          return {
            ok: false,
            code:
              error.code === 'INVALID_RESPONSE'
                ? 'INVALID_PROVIDER_OUTPUT'
                : 'INTERPRETATION_FAILED',
            message: error.message,
            rawInput: parsed.rawInput,
          }
        } else {
          return {
            ok: false,
            code: 'INTERPRETATION_FAILED',
            message: 'Task interpretation failed unexpectedly.',
            rawInput: parsed.rawInput,
          }
        }
      }
    },
    async confirmCapturedTask(userId: string, input: ConfirmCapturedTaskInput) {
      const parsed = confirmCapturedTaskInputSchema.parse(input)
      const result = await tasksService.createTask(userId, parsed.task)

      await replacePlanningItemCalendarLink(database, {
        userId,
        sourceType: 'task',
        sourceId: result.id,
        matchedCalendarContext: parsed.matchedCalendarContext ?? null,
      })

      return result
    },
    async confirmCapturedHabit(userId: string, input: ConfirmCapturedHabitInput) {
      const parsed = confirmCapturedHabitInputSchema.parse(input)
      const result = await habitsService.createHabit(userId, parsed.habit)

      await replacePlanningItemCalendarLink(database, {
        userId,
        sourceType: 'habit',
        sourceId: result.id,
        matchedCalendarContext: parsed.matchedCalendarContext ?? null,
      })

      return result
    },
  }
}
