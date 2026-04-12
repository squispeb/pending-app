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
  const source = new Headers(getRequestHeaders())
  const headers = new Headers()

  const cookie = source.get('cookie')
  if (cookie) {
    headers.set('cookie', cookie)
  }

  const authorization = source.get('authorization')
  if (authorization) {
    headers.set('authorization', authorization)
  }

  const origin = source.get('origin')
  if (origin) {
    headers.set('origin', origin)
  }

  const referer = source.get('referer')
  if (referer) {
    headers.set('referer', referer)
  }

  if (!headers.get('origin') && env.APP_URL) {
    try {
      const appUrl = new URL(env.APP_URL)
      headers.set('origin', appUrl.origin)
      headers.set('referer', env.APP_URL)
    } catch {
      // Ignore invalid APP_URL here and let the assistant auth service fail clearly if needed.
    }
  }

  return headers
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

const otpRequestSchema = z.object({
  email: z.email(),
})

const otpVerifySchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
  name: z.string().trim().optional(),
})

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

  if (
    payload &&
    typeof payload === 'object' &&
    'user' in payload &&
    payload.user &&
    typeof payload.user === 'object' &&
    'email' in payload.user &&
    typeof payload.user.email === 'string' &&
    payload.user.email.endsWith('@anon-user.com')
  ) {
    return authStatusSchema.parse({
      state: 'anonymous',
      user: null,
    })
  }

  const { user } = await resolveAuthenticatedPlannerUser(db, {
    requestHeaders,
  })

  return authStatusSchema.parse({
    state: 'authenticated',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  })
})

export const requestEmailOtp = createServerFn({ method: 'POST' })
  .inputValidator((input) => otpRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const requestHeaders = getAuthHeaders()
    const headers = new Headers(requestHeaders)
    headers.set('content-type', 'application/json')

    const response = await fetch(`${getAssistantServiceUrl()}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: data.email,
        type: 'sign-in',
      }),
    })

    await parseAssistantResponse(response)

    return { ok: true as const }
  })

export const verifyEmailOtp = createServerFn({ method: 'POST' })
  .inputValidator((input) => otpVerifySchema.parse(input))
  .handler(async ({ data }) => {
    const requestHeaders = getAuthHeaders()
    const headers = new Headers(requestHeaders)
    headers.set('content-type', 'application/json')

    const response = await fetch(`${getAssistantServiceUrl()}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: data.email,
        otp: data.otp,
        name: data.name,
      }),
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
