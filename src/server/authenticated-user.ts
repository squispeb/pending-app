import { eq } from 'drizzle-orm'
import { getRequestHeaders, setResponseHeader } from '@tanstack/start-server-core'
import { z } from 'zod'
import type { Database } from '../db/client'
import { users } from '../db/schema'
import { env } from '../lib/env'

const authSessionResponseSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
  }),
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
  }),
})

const anonymousSignInResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
  }),
})

type ResolvedPlannerAuthUser = {
  id: string
  email: string
  name?: string | null
}

type ResolveAuthenticatedPlannerUserOptions = {
  requestHeaders?: HeadersInit
  fetchImpl?: typeof fetch
  baseUrl?: string
  setResponseHeaderImpl?: typeof setResponseHeader
}

function getAssistantServiceUrl(baseUrl?: string) {
  const resolvedBaseUrl = baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!resolvedBaseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  return resolvedBaseUrl
}

function getForwardedAuthHeaders(input?: HeadersInit) {
  const headers = new Headers()
  const source = new Headers(input)

  const authorization = source.get('authorization')
  if (authorization) {
    headers.set('authorization', authorization)
  }

  const cookie = source.get('cookie')
  if (cookie) {
    headers.set('cookie', cookie)
  }

  const origin = source.get('origin')
  if (origin) {
    headers.set('origin', origin)
  }

  const referer = source.get('referer')
  if (referer) {
    headers.set('referer', referer)
  }

  return headers
}

function ensureOriginHeaders(headers: Headers, requestHeaders?: HeadersInit) {
  if (headers.get('origin')) {
    return headers
  }

  const source = new Headers(requestHeaders)
  const referer = source.get('referer')

  if (referer) {
    try {
      headers.set('origin', new URL(referer).origin)
      headers.set('referer', referer)
      return headers
    } catch {
      // Ignore malformed referer and fall back to explicit app URL configuration.
    }
  }

  const appUrl = env.APP_URL
  if (appUrl) {
    try {
      const origin = new URL(appUrl).origin
      headers.set('origin', origin)
      headers.set('referer', appUrl)
    } catch {
      // Ignore invalid app URL and let Better Auth return a clearer error.
    }
  }

  return headers
}

function getCookieHeaderFromSetCookie(setCookieHeaders: Array<string>) {
  return setCookieHeaders
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value): value is string => !!value)
    .join('; ')
}

async function fetchAssistantAuthJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  options?: Pick<ResolveAuthenticatedPlannerUserOptions, 'fetchImpl' | 'baseUrl'>,
) {
  const response = await (options?.fetchImpl ?? fetch)(`${getAssistantServiceUrl(options?.baseUrl)}${path}`, init)
  const payload = await response.json()

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Assistant auth request failed'

    throw new Error(message)
  }

  return {
    payload: schema.parse(payload),
    response,
  }
}

async function upsertPlannerUser(database: Database, authUser: ResolvedPlannerAuthUser) {
  const now = new Date()
  const existing = await database.query.users.findFirst({
    where: eq(users.id, authUser.id),
  })
  const displayName = authUser.name ?? existing?.displayName ?? null
  const timezone = existing?.timezone ?? 'UTC'

  await database
    .insert(users)
    .values({
      id: authUser.id,
      email: authUser.email,
      displayName,
      timezone,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: authUser.email,
        displayName,
        updatedAt: now,
      },
    })

  const user = await database.query.users.findFirst({
    where: eq(users.id, authUser.id),
  })

  if (!user) {
    throw new Error('Failed to persist the authenticated planner user')
  }

  return user
}

export async function resolveAuthenticatedPlannerUser(
  database: Database,
  options?: ResolveAuthenticatedPlannerUserOptions,
) {
  const requestHeaders = options?.requestHeaders ?? getRequestHeaders()
  let authHeaders = ensureOriginHeaders(getForwardedAuthHeaders(requestHeaders), requestHeaders)

  const sessionResult = await fetchAssistantAuthJson(
    '/api/auth/get-session',
    {
      method: 'GET',
      headers: authHeaders,
    },
    authSessionResponseSchema.nullable(),
    options,
  )

  let session = sessionResult.payload

  if (!session) {
    authHeaders = new Headers(authHeaders)
    authHeaders.set('content-type', 'application/json')

    const anonymousSignInResult = await fetchAssistantAuthJson(
      '/api/auth/sign-in/anonymous',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      },
      anonymousSignInResponseSchema,
      options,
    )

    const setCookieHeaders = anonymousSignInResult.response.headers.getSetCookie()
    if (setCookieHeaders.length > 0) {
      ;(options?.setResponseHeaderImpl ?? setResponseHeader)('set-cookie', setCookieHeaders)
      authHeaders = new Headers(authHeaders)
      authHeaders.set('cookie', getCookieHeaderFromSetCookie(setCookieHeaders))
    }

    const hydratedSessionResult = await fetchAssistantAuthJson(
      '/api/auth/get-session',
      {
        method: 'GET',
        headers: authHeaders,
      },
      authSessionResponseSchema.nullable(),
      options,
    )

    session = hydratedSessionResult.payload

    if (!session) {
      session = {
        session: {
          id: anonymousSignInResult.payload.token,
          userId: anonymousSignInResult.payload.user.id,
        },
        user: anonymousSignInResult.payload.user,
      }
    }
  }

  const user = await upsertPlannerUser(database, {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  })

  return {
    user,
    authHeaders,
  }
}
