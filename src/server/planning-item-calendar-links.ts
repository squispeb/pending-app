import { and, eq, inArray, or } from 'drizzle-orm'
import type { Database } from '../db/client'
import { calendarConnections, calendarEvents, planningItemCalendarLinks } from '../db/schema'
import type { MatchedCalendarContext } from '../lib/capture'

export type PlanningItemSourceType = 'task' | 'habit'

export type PlanningItemCalendarLinkView = {
  id: string
  sourceType: PlanningItemSourceType
  sourceId: string
  matchedSummary: string
  matchReason: string
  calendarId: string
  googleEventId: string
  googleRecurringEventId: string | null
  resolvedEvent: {
    id: string
    summary: string | null
    startsAt: Date
    endsAt: Date
    htmlLink: string | null
    calendarName: string
    primaryFlag: boolean
  } | null
}

function pickBestResolvedEvent<T extends { startsAt: Date }>(events: Array<T>, now = new Date()) {
  if (!events.length) {
    return null
  }

  const future = events
    .filter((event) => event.startsAt.getTime() >= now.getTime())
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())

  if (future.length) {
    return future[0] ?? null
  }

  return [...events].sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())[0] ?? null
}

export async function replacePlanningItemCalendarLink(
  database: Database,
  input: {
    userId: string
    sourceType: PlanningItemSourceType
    sourceId: string
    matchedCalendarContext?: MatchedCalendarContext | null
  },
) {
  await database
    .delete(planningItemCalendarLinks)
    .where(
      and(
        eq(planningItemCalendarLinks.userId, input.userId),
        eq(planningItemCalendarLinks.sourceType, input.sourceType),
        eq(planningItemCalendarLinks.sourceId, input.sourceId),
      ),
    )

  if (!input.matchedCalendarContext) {
    return
  }

  const matchedEvent = await database.query.calendarEvents.findFirst({
    where: and(
      eq(calendarEvents.userId, input.userId),
      eq(calendarEvents.id, input.matchedCalendarContext.calendarEventId),
    ),
  })

  if (!matchedEvent) {
    return
  }

  const now = new Date()
  await database.insert(planningItemCalendarLinks).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    calendarId: matchedEvent.calendarId,
    googleEventId: matchedEvent.googleEventId,
    googleRecurringEventId: matchedEvent.googleRecurringEventId,
    matchedSummary: input.matchedCalendarContext.summary,
    matchReason: input.matchedCalendarContext.reason,
    createdAt: now,
    updatedAt: now,
  })
}

export async function listPlanningItemCalendarLinks(
  database: Database,
  input: {
    userId: string
    sourceType: PlanningItemSourceType
    sourceIds: Array<string>
    now?: Date
  },
) {
  if (!input.sourceIds.length) {
    return new Map<string, Array<PlanningItemCalendarLinkView>>()
  }

  const links = await database.query.planningItemCalendarLinks.findMany({
    where: and(
      eq(planningItemCalendarLinks.userId, input.userId),
      eq(planningItemCalendarLinks.sourceType, input.sourceType),
      inArray(planningItemCalendarLinks.sourceId, input.sourceIds),
    ),
  })

  if (!links.length) {
    return new Map<string, Array<PlanningItemCalendarLinkView>>()
  }

  const googleEventIds = [...new Set(links.map((link) => link.googleEventId))]
  const recurringIds = [...new Set(links.map((link) => link.googleRecurringEventId).filter(Boolean))]

  const resolvedEvents = await database.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.userId, input.userId),
      or(
        googleEventIds.length ? inArray(calendarEvents.googleEventId, googleEventIds) : undefined,
        recurringIds.length ? inArray(calendarEvents.googleRecurringEventId, recurringIds) : undefined,
      )!,
    ),
  })

  const calendarIds = [...new Set(resolvedEvents.map((event) => event.calendarId))]
  const connections = calendarIds.length
    ? await database.query.calendarConnections.findMany({
        where: and(
          eq(calendarConnections.userId, input.userId),
          inArray(calendarConnections.calendarId, calendarIds),
        ),
      })
    : []
  const connectionByCalendarId = new Map(
    connections.map((connection) => [connection.calendarId, connection]),
  )

  const result = new Map<string, Array<PlanningItemCalendarLinkView>>()

  for (const link of links) {
    const candidates = resolvedEvents.filter((event) => {
      if (link.googleRecurringEventId) {
        return event.googleRecurringEventId === link.googleRecurringEventId
      }

      return event.googleEventId === link.googleEventId
    })
    const resolved = pickBestResolvedEvent(candidates, input.now)
    const current = result.get(link.sourceId) ?? []

    current.push({
      id: link.id,
      sourceType: link.sourceType as PlanningItemSourceType,
      sourceId: link.sourceId,
      matchedSummary: link.matchedSummary,
      matchReason: link.matchReason,
      calendarId: link.calendarId,
      googleEventId: link.googleEventId,
      googleRecurringEventId: link.googleRecurringEventId,
      resolvedEvent: resolved
        ? {
            id: resolved.id,
            summary: resolved.summary,
            startsAt: resolved.startsAt,
            endsAt: resolved.endsAt,
            htmlLink: resolved.htmlLink,
            calendarName: connectionByCalendarId.get(resolved.calendarId)?.calendarName ?? resolved.calendarId,
            primaryFlag: connectionByCalendarId.get(resolved.calendarId)?.primaryFlag ?? false,
          }
        : null,
    })

    result.set(link.sourceId, current)
  }

  return result
}
