import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/start-server-core'
import { z } from 'zod'
import { db } from '../db/client'
import { env } from '../lib/env'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'

const authStatusSchema = z.object({
  state: z.enum(['authenticated', 'anonymous', 'signed_out']),
  user: z
    .object({
      id: z.string().min(1),
      email: z.string().min(1),
      displayName: z.string().nullable(),
    })
    .nullable(),
})

function getAssistantServiceUrl() {
  if (!env.ASSISTANT_SERVICE_URL) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  return env.ASSISTANT_SERVICE_URL
}

function getAuthHeaders() {
  return new Headers(getRequestHeaders())
}

async function parseAssistantResponse(response: Response) {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Assistant auth request failed'
    throw new Error(message)
  }

  return payload
}

function mirrorSetCookieHeaders(response: Response) {
  const setCookieHeaders = response.headers.getSetCookie()
  if (setCookieHeaders.length > 0) {
    setResponseHeader('set-cookie', setCookieHeaders)
  }
}

export const getAuthStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const requestHeaders = getAuthHeaders()
  const sessionResponse = await fetch(`${getAssistantServiceUrl()}/api/auth/get-session`, {
    method: 'GET',
    headers: requestHeaders,
  })
  const payload = await parseAssistantResponse(sessionResponse)

  if (!payload) {
    return authStatusSchema.parse({
      state: 'signed_out',
      user: null,
    })
  }

  const { user } = await resolveAuthenticatedPlannerUser(db, {
    requestHeaders,
  })
  const isAnonymous = user.email.endsWith('@anon-user.com')

  return authStatusSchema.parse({
    state: isAnonymous ? 'anonymous' : 'authenticated',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  })
})

export const startAnonymousSession = createServerFn({ method: 'POST' }).handler(async () => {
  const requestHeaders = getAuthHeaders()
  const headers = new Headers(requestHeaders)
  headers.set('content-type', 'application/json')

  const response = await fetch(`${getAssistantServiceUrl()}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  const payload = await parseAssistantResponse(response)
  mirrorSetCookieHeaders(response)

  return payload
})

export const signOutSession = createServerFn({ method: 'POST' }).handler(async () => {
  const requestHeaders = getAuthHeaders()
  const headers = new Headers(requestHeaders)
  headers.set('content-type', 'application/json')

  const response = await fetch(`${getAssistantServiceUrl()}/api/auth/sign-out`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  await parseAssistantResponse(response)
  mirrorSetCookieHeaders(response)

  return { ok: true as const }
})
