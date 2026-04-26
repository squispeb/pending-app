import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '../db/client'
import {
  googleCallbackInputSchema,
  googleCalendarEventInputSchema,
  googleCalendarSelectionSchema,
} from '../lib/google'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createCalendarService } from './calendar-service'

const calendarService = createCalendarService(db)

export const getCalendarSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.getSettingsData(user.id)
})

export const getCalendarView = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.getCalendarViewData(user.id)
})

export const getCalendarEventsForDay = createServerFn({ method: 'GET' })
  .inputValidator((input) => z.object({ dateStr: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.getCalendarEventsForDay(user.id, data.dateStr)
  })

export const startGoogleConnect = createServerFn({ method: 'POST' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.startGoogleConnect(user.id)
})

export const completeGoogleConnect = createServerFn({ method: 'POST' })
  .inputValidator((input) => googleCallbackInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.completeGoogleConnect(user.id, data.code, data.state)
  })

export const refreshGoogleCalendars = createServerFn({ method: 'POST' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.refreshCalendarConnections(user.id)
})

export const syncGoogleCalendar = createServerFn({ method: 'POST' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.syncSelectedCalendarEvents(user.id)
})

export const createGoogleCalendarEvent = createServerFn({ method: 'POST' })
  .inputValidator((input) => z.object({ calendarId: z.string().min(1), event: googleCalendarEventInputSchema }).parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.createCalendarEvent(user.id, data.calendarId, data.event)
  })

export const updateGoogleCalendarEvent = createServerFn({ method: 'POST' })
  .inputValidator((input) =>
    z
      .object({
        calendarId: z.string().min(1),
        googleEventId: z.string().min(1),
        event: googleCalendarEventInputSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.updateCalendarEvent(user.id, data.calendarId, data.googleEventId, data.event)
  })

export const deleteGoogleCalendarEvent = createServerFn({ method: 'POST' })
  .inputValidator((input) =>
    z.object({ calendarId: z.string().min(1), googleEventId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.deleteCalendarEvent(user.id, data.calendarId, data.googleEventId)
  })

export const saveGoogleCalendarSelections = createServerFn({ method: 'POST' })
  .inputValidator((input) => googleCalendarSelectionSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return calendarService.updateCalendarSelections(user.id, data)
  })

export const disconnectGoogleCalendar = createServerFn({ method: 'POST' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return calendarService.disconnectGoogleCalendar(user.id)
})
