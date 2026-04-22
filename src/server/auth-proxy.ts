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

function createProxyHeaders(request: Request) {
  const headers = new Headers(request.headers)
  const requestUrl = new URL(request.url)

  headers.set('x-forwarded-host', requestUrl.host)
  headers.set('x-forwarded-proto', requestUrl.protocol.replace(':', ''))

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

function shouldIncludeRequestBody(method: string) {
  return method !== 'GET' && method !== 'HEAD'
}

function copyResponseHeaders(response: Response, requestOrigin: string, assistantServiceOrigin: string) {
  const headers = new Headers(response.headers)
  stripProxyUnsafeResponseHeaders(headers)
  const setCookieHeaders = response.headers.getSetCookie()

  if (setCookieHeaders.length > 0) {
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
