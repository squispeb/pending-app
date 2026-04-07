import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '../db/client'
import { googleCallbackInputSchema, googleCalendarSelectionSchema } from '../lib/google'
import { createCalendarService } from './calendar-service'

const calendarService = createCalendarService(db)

export const getCalendarSettings = createServerFn({ method: 'GET' }).handler(async () => {
  return calendarService.getSettingsData()
})

export const getCalendarView = createServerFn({ method: 'GET' }).handler(async () => {
  return calendarService.getCalendarViewData()
})

export const getCalendarEventsForDay = createServerFn({ method: 'GET' })
  .inputValidator((input) => z.object({ dateStr: z.string() }).parse(input))
  .handler(async ({ data }) => {
    return calendarService.getCalendarEventsForDay(data.dateStr)
  })

export const startGoogleConnect = createServerFn({ method: 'POST' }).handler(async () => {
  return calendarService.startGoogleConnect()
})

export const completeGoogleConnect = createServerFn({ method: 'POST' })
  .inputValidator((input) => googleCallbackInputSchema.parse(input))
  .handler(async ({ data }) => {
    return calendarService.completeGoogleConnect(data.code, data.state)
  })

export const refreshGoogleCalendars = createServerFn({ method: 'POST' }).handler(async () => {
  return calendarService.refreshCalendarConnections()
})

export const syncGoogleCalendar = createServerFn({ method: 'POST' }).handler(async () => {
  return calendarService.syncSelectedCalendarEvents()
})

export const saveGoogleCalendarSelections = createServerFn({ method: 'POST' })
  .inputValidator((input) => googleCalendarSelectionSchema.parse(input))
  .handler(async ({ data }) => {
    return calendarService.updateCalendarSelections(data)
  })

export const disconnectGoogleCalendar = createServerFn({ method: 'POST' }).handler(async () => {
  return calendarService.disconnectGoogleCalendar()
})
