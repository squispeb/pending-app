import { z } from 'zod'

export const GOOGLE_CALENDAR_PROVIDER = 'google-calendar'

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
