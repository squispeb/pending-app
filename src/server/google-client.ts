import { z } from 'zod'
import { env } from '../lib/env'
import { getGoogleScopeString } from '../lib/google'
import { createGoogleState, verifyGoogleState } from './google-auth'

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

const googleUserInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
})

const googleCalendarListResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional().nullable(),
        summaryOverride: z.string().optional().nullable(),
        primary: z.boolean().optional(),
        hidden: z.boolean().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .default([]),
})

export type GoogleTokenExchange = {
  accessToken: string
  refreshToken?: string
  scope?: string
  tokenExpiryAt: Date
}

export type GoogleUserInfo = {
  subject: string
  email: string
}

export type GoogleCalendarSummary = {
  calendarId: string
  calendarName: string
  primaryFlag: boolean
  visible: boolean
}

export interface GoogleIntegrationApi {
  buildAuthUrl(userId: string): string
  verifyState(state: string): { userId: string; nonce: string; exp: number }
  exchangeCode(code: string): Promise<GoogleTokenExchange>
  refreshAccessToken(refreshToken: string): Promise<GoogleTokenExchange>
  fetchUserInfo(accessToken: string): Promise<GoogleUserInfo>
  fetchCalendarList(accessToken: string): Promise<Array<GoogleCalendarSummary>>
}

async function fetchGoogleJson<T>(input: RequestInfo | URL, init: RequestInit, schema: z.ZodSchema<T>) {
  const response = await fetch(input, init)

  if (!response.ok) {
    let errorBody = ''
    let errorMessage = response.statusText || 'Request failed'

    try {
      errorBody = await response.text()
    } catch {
      errorBody = ''
    }

    if (errorBody) {
      try {
        const parsed = JSON.parse(errorBody) as {
          error?: {
            message?: string
            status?: string
          }
        }

        if (parsed.error?.message) {
          errorMessage = parsed.error.message
        } else if (typeof parsed.error === 'string') {
          errorMessage = parsed.error
        }
      } catch {
        errorMessage = errorBody
      }
    }

    throw new Error(`Google request failed (${response.status}): ${errorMessage}`)
  }

  const json = await response.json()
  return schema.parse(json)
}

function requireGoogleCredentials() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google Calendar is not configured. Add client ID, client secret, and redirect URI.')
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  }
}

async function exchangeGoogleGrant(params: URLSearchParams) {
  const result = await fetchGoogleJson(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
    googleTokenResponseSchema,
  )

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    scope: result.scope,
    tokenExpiryAt: new Date(Date.now() + result.expires_in * 1000),
  }
}

export const googleIntegrationApi: GoogleIntegrationApi = {
  buildAuthUrl(userId) {
    const { clientId, redirectUri } = requireGoogleCredentials()
    const state = createGoogleState(userId)
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')

    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('scope', getGoogleScopeString())
    url.searchParams.set('state', state)

    return url.toString()
  },
  verifyState: verifyGoogleState,
  async exchangeCode(code) {
    const { clientId, clientSecret, redirectUri } = requireGoogleCredentials()
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })

    return exchangeGoogleGrant(params)
  },
  async refreshAccessToken(refreshToken) {
    const { clientId, clientSecret } = requireGoogleCredentials()
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    return exchangeGoogleGrant(params)
  },
  async fetchUserInfo(accessToken) {
    const result = await fetchGoogleJson(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      googleUserInfoSchema,
    )

    return {
      subject: result.sub,
      email: result.email,
    }
  },
  async fetchCalendarList(accessToken) {
    const calendars: Array<GoogleCalendarSummary> = []
    let nextPageToken: string | undefined

    do {
      const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
      url.searchParams.set('maxResults', '250')

      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken)
      }

      const response = await fetchGoogleJson(
        url,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        googleCalendarListResponseSchema,
      )

      for (const item of response.items) {
        calendars.push({
          calendarId: item.id,
          calendarName: item.summaryOverride || item.summary || item.id,
          primaryFlag: !!item.primary,
          visible: !item.hidden && !item.deleted,
        })
      }

      nextPageToken = response.nextPageToken
    } while (nextPageToken)

    return calendars
  },
}
