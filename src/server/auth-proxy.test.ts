import { beforeEach, describe, expect, it, vi } from 'vitest'

const setResponseHeaderMock = vi.fn()

vi.mock('@tanstack/start-server-core', () => ({
  setResponseHeader: setResponseHeaderMock,
}))

describe('auth proxy', () => {
  beforeEach(() => {
    process.env.ASSISTANT_SERVICE_URL = 'https://assistant.example'
    setResponseHeaderMock.mockReset()
  })

  it('forwards auth requests with proxy headers and request body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/auth' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'better-auth.pkce_verifier=abc; Path=/; HttpOnly; SameSite=Lax',
        },
      })
    })

    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    const response = await proxyAssistantAuthRequest(
      new Request('http://localhost:3000/api/auth/sign-in/social?prompt=consent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'better-auth.session_token=test-session',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      }),
      'sign-in/social',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://assistant.example/api/auth/sign-in/social?prompt=consent')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Headers
    expect(headers.get('cookie')).toBe('better-auth.session_token=test-session')
    expect(headers.get('origin')).toBe('http://localhost:3000')
    expect(headers.get('accept-encoding')).toBe('identity')
    expect(headers.get('x-pending-auth-host')).toBe('localhost:3000')
    expect(headers.get('x-pending-auth-proto')).toBe('http')
    expect(headers.get('x-forwarded-host')).toBe('localhost:3000')
    expect(headers.get('x-forwarded-proto')).toBe('http')
    expect(Buffer.from(init?.body as ArrayBuffer).toString('utf8')).toBe(
      JSON.stringify({ provider: 'google', callbackURL: '/' }),
    )

    expect(response.headers.get('set-cookie')).toContain('better-auth.pkce_verifier=abc')
    expect(setResponseHeaderMock).toHaveBeenCalledWith('set-cookie', [
      'better-auth.pkce_verifier=abc; Path=/; HttpOnly; SameSite=Lax',
    ])
  })

  it('prefers the browser origin over request.url when forwarding localhost protocol', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/auth' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    await proxyAssistantAuthRequest(
      new Request('https://localhost:3000/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          referer: 'http://localhost:3000/login',
        },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      }),
      'sign-in/social',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    const [, init] = fetchMock.mock.calls[0] ?? []
    const headers = init?.headers as Headers
    expect(headers.get('x-pending-auth-host')).toBe('localhost:3000')
    expect(headers.get('x-pending-auth-proto')).toBe('http')
    expect(headers.get('x-forwarded-host')).toBe('localhost:3000')
    expect(headers.get('x-forwarded-proto')).toBe('http')
  })

  it('ignores third-party referers when forwarding callback requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    await proxyAssistantAuthRequest(
      new Request('http://localhost:3000/api/auth/callback/google?state=test&code=test', {
        method: 'GET',
        headers: {
          referer: 'https://accounts.google.com/',
        },
      }),
      'callback/google',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    const [, init] = fetchMock.mock.calls[0] ?? []
    const headers = init?.headers as Headers
    expect(headers.get('x-pending-auth-host')).toBe('localhost:3000')
    expect(headers.get('x-pending-auth-proto')).toBe('http')
  })

  it('falls back to raw set-cookie headers when getSetCookie is unavailable', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 302,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax',
      },
    })

    Object.defineProperty(response.headers, 'getSetCookie', {
      value: () => [],
    })

    const fetchMock = vi.fn(async () => response)
    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    const proxiedResponse = await proxyAssistantAuthRequest(
      new Request('http://localhost:3000/api/auth/callback/google?state=test&code=test', {
        method: 'GET',
      }),
      'callback/google',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(proxiedResponse.headers.get('set-cookie')).toContain('better-auth.session_token=abc')
    expect(setResponseHeaderMock).toHaveBeenCalledWith('set-cookie', [
      'better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax',
    ])
  })

  it('rewrites assistant-service redirects back onto the app origin', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://assistant.example/login-complete',
          'set-cookie': 'better-auth.session_token=new-session; Path=/; HttpOnly; SameSite=Lax',
        },
      }),
    )

    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    const response = await proxyAssistantAuthRequest(
      new Request('https://pending.example/api/auth/callback/google?code=123', {
        method: 'GET',
      }),
      'callback/google',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://pending.example/login-complete')
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=new-session')
  })

  it('strips content-encoding headers that can break proxied browser decoding', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '999',
        },
      }),
    )

    const { proxyAssistantAuthRequest } = await import('./auth-proxy')
    const response = await proxyAssistantAuthRequest(
      new Request('http://localhost:3000/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ provider: 'google' }),
      }),
      'sign-in/social',
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.json()).toEqual({ ok: true })
  })
})
