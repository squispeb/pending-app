import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { Database } from '../db/client'
import { calendarConnections, calendarEvents, googleAccounts } from '../db/schema'
import { inferDueDateFromInput, tokenizeForCaptureMatching } from '../lib/capture'

function normalizeCalendarMatchText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sortCalendarTargets<T extends { primaryFlag: boolean; calendarName: string }>(
  calendars: Array<T>,
) {
  return [...calendars].sort((left, right) => {
    if (left.primaryFlag !== right.primaryFlag) {
      return left.primaryFlag ? -1 : 1
    }

    return left.calendarName.localeCompare(right.calendarName)
  })
}

type CalendarTarget = {
  calendarId: string
  calendarName: string
  primaryFlag: boolean
  isSelected: boolean
}

type WritableCalendarTarget = {
  calendarId: string
  calendarName: string
  primaryFlag: boolean
}

type VisibleCalendarEventTarget = {
  calendarEventId: string
  summary: string
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  calendarName: string
  primaryFlag: boolean
  source: 'visible_window'
}

type CalendarEventWindowItem = Omit<VisibleCalendarEventTarget, 'source'>

type VisibleCalendarEventTargetResolution =
  | {
      kind: 'resolved'
      target: VisibleCalendarEventTarget
    }
  | {
      kind: 'ambiguous'
      candidates: Array<VisibleCalendarEventTarget>
    }
  | {
      kind: 'unresolved'
    }

type CalendarTargetResolution =
  | {
      kind: 'default_primary'
      writableCalendars: Array<WritableCalendarTarget>
    }
  | {
      kind: 'resolved_primary'
      writableCalendars: Array<WritableCalendarTarget>
    }
  | {
      kind: 'resolved_alternate'
      target: CalendarTarget
      writableCalendars: Array<WritableCalendarTarget>
    }
  | {
      kind: 'ambiguous'
      attemptedName: string | null
      candidates: Array<CalendarTarget>
      writableCalendars: Array<WritableCalendarTarget>
    }
  | {
      kind: 'unavailable'
      attemptedName: string
      writableCalendars: Array<WritableCalendarTarget>
    }
  | {
      kind: 'read_only'
      attemptedName: string
      calendar: {
        calendarId: string
        calendarName: string
        primaryFlag: boolean
      }
      writableCalendars: Array<WritableCalendarTarget>
    }

function toWritableCalendarTargets(calendars: Array<CalendarTarget>) {
  return sortCalendarTargets(calendars).map((calendar) => ({
    calendarId: calendar.calendarId,
    calendarName: calendar.calendarName,
    primaryFlag: calendar.primaryFlag,
  }))
}

function extractExplicitCalendarPhrase(normalizedTranscript: string) {
  const patterns = [
    /\b(?:on|in|to|for)\s+(?:the\s+)?(.{1,60}?)\s+calendar\b/,
    /\b(?:en|al|a)\s+(?:el\s+)?calendario\s+(.{1,60}?)(?:\b|$)/,
  ]

  for (const pattern of patterns) {
    const match = normalizedTranscript.match(pattern)

    if (!match?.[1]) {
      continue
    }

    const phrase = match[1].trim()

    if (!phrase || phrase === 'my' || phrase === 'mi' || phrase === 'the') {
      continue
    }

    return phrase
  }

  return null
}

function isExplicitPrimaryCalendarReference(normalizedTranscript: string) {
  return /\b(?:my|primary|main|default)\s+calendar\b/.test(normalizedTranscript)
    || /\bmi\s+calendario\b/.test(normalizedTranscript)
    || /\bcalendario\s+(?:principal|predeterminado)\b/.test(normalizedTranscript)
}

function matchesExplicitCalendarReference(normalizedTranscript: string, calendarName: string) {
  const normalizedName = normalizeCalendarMatchText(calendarName)

  if (!normalizedName) {
    return false
  }

  const escapedName = escapeRegExp(normalizedName)
  const patterns = [
    new RegExp(`\\b(?:on|in|to|for)\\s+(?:the\\s+)?${escapedName}(?:\\s+(?:calendar|calendario))?\\b`),
    new RegExp(`\\b(?:en|al|a)\\s+(?:el\\s+)?(?:calendario\\s+)?${escapedName}\\b`),
    new RegExp(`\\b${escapedName}\\s+(?:calendar|calendario)\\b`),
  ]

  return patterns.some((pattern) => pattern.test(normalizedTranscript))
}

function normalizeEventMatchText(value: string) {
  return normalizeCalendarMatchText(value)
}

function inferCalendarEventSearchDate(transcript: string, currentDate: string, timezone: string) {
  if (/\b(today|hoy)\b/i.test(transcript)) {
    return currentDate
  }

  return inferDueDateFromInput(transcript, currentDate, timezone) ?? currentDate
}

function scoreVisibleCalendarEventTarget(
  transcriptTokens: string[],
  transcript: string,
  event: VisibleCalendarEventTarget,
) {
  const eventTokens = tokenizeForCaptureMatching(event.summary)
  const calendarTokens = tokenizeForCaptureMatching(event.calendarName)
  const summaryOverlap = eventTokens.filter((token) => transcriptTokens.includes(token)).length
  const calendarOverlap = calendarTokens.filter((token) => transcriptTokens.includes(token)).length
  const eventText = normalizeEventMatchText(`${event.summary} ${event.calendarName}`)
  const explicitMention = eventText && normalizeEventMatchText(transcript).includes(eventText)

  if (summaryOverlap === 0 && calendarOverlap === 0 && !explicitMention) {
    return null
  }

  return {
    event,
    score: summaryOverlap * 10 + calendarOverlap * 3 + (explicitMention ? 8 : 0),
  }
}

export function createVoiceCalendarResolver(database: Database) {
  async function getRelevantAccount(userId: string) {
    const accounts = await database.query.googleAccounts.findMany({
      where: eq(googleAccounts.userId, userId),
      orderBy: [desc(googleAccounts.updatedAt)],
    })

    return accounts.find((account) => !account.disconnectedAt) ?? accounts[0] ?? null
  }

  async function listCalendarTargets(userId: string) {
    const account = await getRelevantAccount(userId)

    if (!account || account.disconnectedAt) {
      return [] as Array<CalendarTarget & { canWrite: boolean }>
    }

    return sortCalendarTargets(
      await database.query.calendarConnections.findMany({
        where: and(
          eq(calendarConnections.userId, userId),
          eq(calendarConnections.googleAccountId, account.id),
        ),
      }),
    )
  }

  async function getCalendarEventWindow(input: {
    userId: string
    transcript: string
    currentDate: string
    timezone: string
  }): Promise<Array<CalendarEventWindowItem>> {
    const selectedConnections = await database.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.userId, input.userId),
        eq(calendarConnections.isSelected, true),
      ),
    })

    const selectedCalendarIds = selectedConnections.map((connection) => connection.calendarId)

    if (!selectedCalendarIds.length) {
      return []
    }

    const targetDate = inferCalendarEventSearchDate(input.transcript, input.currentDate, input.timezone)
    const [year, month, day] = targetDate.split('-').map(Number)
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0)
    const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999)
    const events = await database.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, input.userId),
        inArray(calendarEvents.calendarId, selectedCalendarIds),
        gte(calendarEvents.endsAt, dayStart),
        lte(calendarEvents.startsAt, dayEnd),
      ),
      orderBy: [asc(calendarEvents.startsAt), asc(calendarEvents.endsAt)],
    })

    const connectionByCalendarId = new Map(
      selectedConnections.map((connection) => [connection.calendarId, connection]),
    )

    return events
      .filter((event) => !!event.summary?.trim())
      .map((event) => ({
        calendarEventId: event.id,
        summary: event.summary!.trim(),
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        allDay: event.allDay,
        calendarName: connectionByCalendarId.get(event.calendarId)?.calendarName ?? event.calendarId,
        primaryFlag: connectionByCalendarId.get(event.calendarId)?.primaryFlag ?? false,
      }))
  }

  return {
    getCalendarEventWindow,
    async resolveCalendarEventTarget(input: {
      transcript: string
      visibleCalendarEventWindow?: Array<{
        calendarEventId: string
        summary: string
        startsAt: string | null
        endsAt: string | null
        allDay: boolean
        calendarName: string
        primaryFlag: boolean
      }> | null
    }): Promise<VisibleCalendarEventTargetResolution> {
      const transcriptTokens = tokenizeForCaptureMatching(input.transcript)
      const visibleWindow = (input.visibleCalendarEventWindow ?? []).map((event) => ({
        ...event,
        source: 'visible_window' as const,
      }))

      if (visibleWindow.length === 0 || transcriptTokens.length === 0) {
        return { kind: 'unresolved' }
      }

      const scoredMatches = visibleWindow
        .map((event) => scoreVisibleCalendarEventTarget(transcriptTokens, input.transcript, event))
        .filter((match): match is NonNullable<typeof match> => match !== null)
        .sort((left, right) => right.score - left.score)

      if (scoredMatches.length === 0) {
        return { kind: 'unresolved' }
      }

      const bestScore = scoredMatches[0]?.score ?? 0
      const matchedEvents = scoredMatches.filter((match) => match.score === bestScore).map((match) => match.event)

      if (matchedEvents.length === 1) {
        return {
          kind: 'resolved',
          target: matchedEvents[0]!,
        }
      }

      return {
        kind: 'ambiguous',
        candidates: matchedEvents,
      }
    },

    async resolveCalendarTarget(input: { userId: string; transcript: string }): Promise<CalendarTargetResolution> {
      const calendars = await listCalendarTargets(input.userId)
      const writableCalendars = toWritableCalendarTargets(calendars.filter((calendar) => calendar.canWrite))
      const normalizedTranscript = normalizeCalendarMatchText(input.transcript)

      if (!normalizedTranscript) {
        return {
          kind: 'default_primary',
          writableCalendars,
        }
      }

      if (isExplicitPrimaryCalendarReference(normalizedTranscript)) {
        return {
          kind: 'resolved_primary',
          writableCalendars,
        }
      }

      const matchingCalendars = calendars.filter((calendar) =>
        matchesExplicitCalendarReference(normalizedTranscript, calendar.calendarName),
      )

      if (matchingCalendars.length > 1) {
        return {
          kind: 'ambiguous',
          attemptedName: extractExplicitCalendarPhrase(normalizedTranscript),
          candidates: matchingCalendars.map((calendar) => ({
            calendarId: calendar.calendarId,
            calendarName: calendar.calendarName,
            primaryFlag: calendar.primaryFlag,
            isSelected: calendar.isSelected,
          })),
          writableCalendars,
        }
      }

      if (matchingCalendars.length === 1) {
        const calendar = matchingCalendars[0]!

        if (!calendar.canWrite) {
          return {
            kind: 'read_only',
            attemptedName: calendar.calendarName,
            calendar: {
              calendarId: calendar.calendarId,
              calendarName: calendar.calendarName,
              primaryFlag: calendar.primaryFlag,
            },
            writableCalendars,
          }
        }

        if (calendar.primaryFlag) {
          return {
            kind: 'resolved_primary',
            writableCalendars,
          }
        }

        return {
          kind: 'resolved_alternate',
          target: {
            calendarId: calendar.calendarId,
            calendarName: calendar.calendarName,
            primaryFlag: calendar.primaryFlag,
            isSelected: calendar.isSelected,
          },
          writableCalendars,
        }
      }

      const attemptedName = extractExplicitCalendarPhrase(normalizedTranscript)

      if (attemptedName) {
        return {
          kind: 'unavailable',
          attemptedName,
          writableCalendars,
        }
      }

      return {
        kind: 'default_primary',
        writableCalendars,
      }
    },
  }
}
