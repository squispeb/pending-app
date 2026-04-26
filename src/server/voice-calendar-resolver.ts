import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { calendarConnections, googleAccounts } from '../db/schema'

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

  return {
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
