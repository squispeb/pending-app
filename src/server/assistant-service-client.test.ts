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
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'thread_created',
              createdAt: '2026-04-12T00:00:00.000Z',
              summary: 'Idea thread created and linked to the saved idea.',
              visibleToUser: true,
            },
          ],
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
      visibleEvents: [
        {
          eventId: 'event-1',
          type: 'thread_created',
          createdAt: '2026-04-12T00:00:00.000Z',
          summary: 'Idea thread created and linked to the saved idea.',
          visibleToUser: true,
        },
      ],
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

  it('retrieves visible thread history through the read contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          status: 'ready',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'thread_created',
              createdAt: '2026-04-12T00:00:00.000Z',
              summary: 'Idea thread created and linked to the saved idea.',
              visibleToUser: true,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const { getAssistantIdeaThread } = await import('./assistant-service-client')
    const result = await getAssistantIdeaThread(
      {
        ideaId: 'idea-123',
        authHeaders: {
          authorization: 'Bearer test-session-token',
          cookie: 'better-auth.session_token=test-session',
        },
      },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    )

    expect(result.visibleEvents).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123')
    expect(init?.method).toBe('GET')
  })

  it('surfaces assistant-service read errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Failed to read thread state' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { getAssistantIdeaThread } = await import('./assistant-service-client')

    await expect(
      getAssistantIdeaThread(
        { ideaId: 'idea-123', authHeaders: { authorization: 'Bearer invalid' } },
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow('Failed to read thread state')
  })
})
