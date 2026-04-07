import { z } from 'zod'

export const GOOGLE_CALENDAR_PROVIDER = 'google-calendar'
export const GOOGLE_CALENDAR_SYNC_PAST_DAYS = 30
export const GOOGLE_CALENDAR_SYNC_FUTURE_DAYS = 90

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const

export const googleCallbackInputSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const googleCalendarSelectionSchema = z.object({
  calendarIds: z.array(z.string().min(1)).max(250),
})

export type GoogleCallbackInput = z.infer<typeof googleCallbackInputSchema>
export type GoogleCalendarSelectionInput = z.infer<typeof googleCalendarSelectionSchema>

export function getGoogleScopeString() {
  return GOOGLE_CALENDAR_SCOPES.join(' ')
}

export function getGoogleSyncWindow(now = new Date()) {
  const start = new Date(now)
  start.setDate(start.getDate() - GOOGLE_CALENDAR_SYNC_PAST_DAYS)
  start.setHours(0, 0, 0, 0)

  const end = new Date(now)
  end.setDate(end.getDate() + GOOGLE_CALENDAR_SYNC_FUTURE_DAYS)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}
