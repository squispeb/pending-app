import { setResponseHeader } from '@tanstack/start-server-core'
import { env } from '../lib/env'

type ProxyAssistantAuthRequestOptions = {
  fetchImpl?: typeof fetch
  baseUrl?: string
}

function getAssistantServiceUrl(baseUrl?: string) {
  const resolvedBaseUrl = baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!resolvedBaseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  return resolvedBaseUrl.replace(/\/$/, '')
}

function resolveClientOrigin(request: Request) {
  const requestUrl = new URL(request.url)

  const originHeader = request.headers.get('origin')
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader)
      if (originUrl.host === requestUrl.host) {
        return originUrl
      }
    } catch {
      // Fall through to referer/request URL.
    }
  }

  const refererHeader = request.headers.get('referer')
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader)
      if (refererUrl.host === requestUrl.host) {
        return refererUrl
      }
    } catch {
      // Fall through to request URL.
    }
  }

  return requestUrl
}

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function createProxyHeaders(request: Request) {
  const headers = new Headers(request.headers)
  const clientUrl = resolveClientOrigin(request)
  const protocol = isLocalHost(clientUrl.hostname) ? 'http' : clientUrl.protocol.replace(':', '')

  // Ask the upstream auth service for an identity response so the app proxy
  // can relay JSON/redirect payloads without content-encoding ambiguity.
  headers.set('accept-encoding', 'identity')
  headers.set('x-pending-auth-host', clientUrl.host)
  headers.set('x-pending-auth-proto', protocol)
  headers.set('x-forwarded-host', clientUrl.host)
  headers.set('x-forwarded-proto', protocol)

  return headers
}

function stripProxyUnsafeResponseHeaders(headers: Headers) {
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  headers.delete('connection')
  headers.delete('keep-alive')
  headers.delete('proxy-authenticate')
  headers.delete('proxy-authorization')
  headers.delete('te')
  headers.delete('trailer')
  headers.delete('upgrade')
}

function splitSetCookieHeader(value: string) {
  return value
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((cookie) => cookie.trim())
    .filter(Boolean)
}

function getResponseSetCookieHeaders(response: Response) {
  const values = response.headers.getSetCookie()

  if (values.length > 0) {
    return values
  }

  const combined = response.headers.get('set-cookie')
  return combined ? splitSetCookieHeader(combined) : []
}

function shouldIncludeRequestBody(method: string) {
  return method !== 'GET' && method !== 'HEAD'
}

function copyResponseHeaders(response: Response, requestOrigin: string, assistantServiceOrigin: string) {
  const headers = new Headers(response.headers)
  stripProxyUnsafeResponseHeaders(headers)
  const setCookieHeaders = getResponseSetCookieHeaders(response)

  if (setCookieHeaders.length > 0) {
    try {
      setResponseHeader('set-cookie', setCookieHeaders)
    } catch {
      // Tests and non-request contexts may not expose the TanStack response header bridge.
    }

    headers.delete('set-cookie')
    for (const value of setCookieHeaders) {
      headers.append('set-cookie', value)
    }
  }

  const location = headers.get('location')
  if (location?.startsWith(assistantServiceOrigin)) {
    headers.set('location', `${requestOrigin}${location.slice(assistantServiceOrigin.length)}`)
  }

  return headers
}

export async function proxyAssistantAuthRequest(
  request: Request,
  authPath: string,
  options?: ProxyAssistantAuthRequestOptions,
) {
  const assistantServiceBaseUrl = getAssistantServiceUrl(options?.baseUrl)
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(`/api/auth/${authPath}`, assistantServiceBaseUrl)
  targetUrl.search = requestUrl.search

  const response = await (options?.fetchImpl ?? fetch)(targetUrl, {
    method: request.method,
    headers: createProxyHeaders(request),
    body: shouldIncludeRequestBody(request.method) ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyResponseHeaders(response, requestUrl.origin, new URL(assistantServiceBaseUrl).origin),
  })
}
