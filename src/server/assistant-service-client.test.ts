import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('assistant service client', () => {
  beforeEach(() => {
    process.env.ASSISTANT_SERVICE_URL = 'https://assistant.example'
    vi.resetModules()
  })

  it('forwards authenticated headers and sends the resolve thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          status: 'ready',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const { resolveAssistantIdeaThread } = await import('./assistant-service-client')
    const result = await resolveAssistantIdeaThread(
      {
        ideaId: 'idea-123',
        authHeaders: {
          authorization: 'Bearer test-session-token',
          cookie: 'better-auth.session_token=test-session',
        },
      },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    )

    expect(result).toEqual({
      threadId: 'thread-local-user:idea-123',
      ideaId: 'idea-123',
      userId: 'local-user',
      status: 'ready',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/resolve')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer test-session-token')
    expect(headers.get('cookie')).toBe('better-auth.session_token=test-session')
    expect(init?.body).toBe(JSON.stringify({ ideaId: 'idea-123' }))
  })

  it('surfaces assistant-service errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Unauthorized thread access' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { resolveAssistantIdeaThread } = await import('./assistant-service-client')

    await expect(
      resolveAssistantIdeaThread(
        { ideaId: 'idea-123', authHeaders: { authorization: 'Bearer invalid' } },
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow('Unauthorized thread access')
  })
})
