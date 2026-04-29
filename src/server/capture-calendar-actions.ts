import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { calendarEvents } from '../db/schema'

type CalendarService = {
  updateCalendarEvent: (
    userId: string,
    calendarId: string,
    googleEventId: string,
    event: {
      summary: string
      description?: string | null
      location?: string | null
      start: { date: string } | { dateTime: string; timeZone?: string }
      end: { date: string } | { dateTime: string; timeZone?: string }
    },
  ) => Promise<unknown>
  deleteCalendarEvent: (userId: string, calendarId: string, googleEventId: string) => Promise<unknown>
}

type ResolveUser = () => Promise<{ user: { id: string } }>

type CreateGoogleCalendarEvent = (input: {
  data: {
    calendarId: string
    event: {
      summary: string
      description?: string | null
      location?: string | null
      start: { date: string } | { dateTime: string; timeZone: string }
      end: { date: string } | { dateTime: string; timeZone: string }
    }
  }
}) => Promise<unknown>

type CaptureCalendarActionsDependencies = {
  database: Database
  calendarService: CalendarService
  resolveUser: ResolveUser
  createGoogleCalendarEvent: CreateGoogleCalendarEvent
}

function addDaysToIsoDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function getAllDayEndDate(startDate: string, endDate?: string | null) {
  return addDaysToIsoDate(endDate ?? startDate, 1)
}

export function createCaptureCalendarActions({
  database,
  calendarService,
  resolveUser,
  createGoogleCalendarEvent,
}: CaptureCalendarActionsDependencies) {
  return {
    async confirmVoiceCalendarEventCreate(data: {
      timezone: string
      draft: {
        targetCalendarId?: string | null
        allDay?: boolean
        startDate: string
        endDate?: string | null
        startTime?: string | null
        endTime?: string | null
        title: string
        description?: string | null
        location?: string | null
      }
    }) {
      await resolveUser()
      const targetCalendarId = data.draft.targetCalendarId ?? 'primary'
      const isAllDay = data.draft.allDay || !data.draft.startTime
      const allDayEndDate = addDaysToIsoDate(data.draft.endDate ?? data.draft.startDate, 1)

      return createGoogleCalendarEvent({
        data: {
          calendarId: targetCalendarId,
          event: {
            summary: data.draft.title,
            description: data.draft.description ?? null,
            location: data.draft.location ?? null,
            start: isAllDay
              ? { date: data.draft.startDate }
              : { dateTime: `${data.draft.startDate}T${data.draft.startTime}:00`, timeZone: data.timezone },
            end: isAllDay
              ? { date: allDayEndDate }
              : {
                  dateTime: `${data.draft.endDate ?? data.draft.startDate}T${data.draft.endTime ?? data.draft.startTime}:00`,
                  timeZone: data.timezone,
                },
          },
        },
      })
    },

    async confirmVoiceCalendarEventAction(data: {
      calendarEvent: {
        operation: 'edit_calendar_event' | 'cancel_calendar_event'
        target: { calendarEventId: string; summary: string }
        title?: string | null
        description?: string | null
        location?: string | null
        startDate: string
        endDate?: string | null
        startTime?: string | null
        endTime?: string | null
        allDay?: boolean
      }
    }) {
      const { user } = await resolveUser()
      const event = data.calendarEvent

      const existingEvent = await database.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.userId, user.id),
          eq(calendarEvents.id, event.target.calendarEventId),
        ),
      })

      if (!existingEvent) {
        throw new Error('Calendar event not found.')
      }

      if (event.operation === 'edit_calendar_event') {
        const isAllDay = event.allDay || !event.startTime
        return calendarService.updateCalendarEvent(
          user.id,
          existingEvent.calendarId,
          existingEvent.googleEventId,
          {
            summary: event.title ?? event.target.summary,
            description: event.description ?? null,
            location: event.location ?? null,
            start: isAllDay
              ? { date: event.startDate }
              : { dateTime: `${event.startDate}T${event.startTime}:00`, timeZone: existingEvent.eventTimezone ?? undefined },
            end: isAllDay
              ? { date: getAllDayEndDate(event.startDate, event.endDate) }
              : {
                  dateTime: `${event.endDate ?? event.startDate}T${event.endTime ?? event.startTime}:00`,
                  timeZone: existingEvent.eventTimezone ?? undefined,
                },
          },
        )
      }

      return calendarService.deleteCalendarEvent(
        user.id,
        existingEvent.calendarId,
        existingEvent.googleEventId,
      )
    },
  }
}
