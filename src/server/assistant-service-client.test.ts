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
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'thread_created',
              createdAt: '2026-04-12T00:00:00.000Z',
              summary: 'Idea discovery thread created and ready for context building.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: null,
            currentSummary: null,
            purpose: null,
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
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
      stage: 'discovery',
      status: 'idle',
      visibleEvents: [
        {
          eventId: 'event-1',
          type: 'thread_created',
          createdAt: '2026-04-12T00:00:00.000Z',
          summary: 'Idea discovery thread created and ready for context building.',
          visibleToUser: true,
        },
      ],
      workingIdea: {
        provisionalTitle: null,
        currentSummary: null,
        purpose: null,
        scope: null,
        targetUsers: [],
        expectedImpact: null,
        researchAreas: [],
        constraints: [],
        openQuestions: [],
      },
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
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'thread_created',
              createdAt: '2026-04-12T00:00:00.000Z',
              summary: 'Idea discovery thread created and ready for context building.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: null,
            currentSummary: null,
            purpose: null,
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
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

  it('requests an elaborate proposal through the action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        thread: {
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Please elaborate this idea into a clearer opportunity and suggest a useful next step.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: 'Idea title',
            currentSummary: 'Expanded summary',
            purpose: null,
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
        },
        proposal: {
          explanation: 'Generated a richer version of the idea.',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { requestIdeaThreadElaboration } = await import('./assistant-service-client')
    const result = await requestIdeaThreadElaboration({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      actionInput: null,
      currentSnapshotVersion: 1,
      currentTitle: 'Idea title',
      currentBody: 'Idea body',
      currentSummary: null,
    }, { fetchImpl: fetchMock as unknown as typeof fetch })

    expect(result.outcome).toBe('proposal_created')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/elaborate')
    expect(init?.method).toBe('POST')
  })

  it('submits a discovery turn through the thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        thread: {
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'thread_created',
              createdAt: '2026-04-12T00:00:00.000Z',
              summary: 'Idea discovery thread created and ready for context building.',
              visibleToUser: true,
            },
            {
              eventId: 'event-2',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:01:00.000Z',
              summary: 'Reduce onboarding drop-off for first-time users.',
              visibleToUser: true,
            },
            {
              eventId: 'event-3',
              type: 'assistant_synthesis',
              createdAt: '2026-04-12T00:01:01.000Z',
              summary: 'Captured purpose: Reduce onboarding drop-off for first-time users.',
              visibleToUser: true,
            },
            {
              eventId: 'event-4',
              type: 'assistant_question',
              createdAt: '2026-04-12T00:01:02.000Z',
              summary: 'Who is the main user or audience for this idea?',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: 'Idea title',
            currentSummary: 'Purpose: Reduce onboarding drop-off for first-time users.',
            purpose: 'Reduce onboarding drop-off for first-time users.',
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { submitIdeaDiscoveryTurn } = await import('./assistant-service-client')
    const result = await submitIdeaDiscoveryTurn({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      message: 'Reduce onboarding drop-off for first-time users.',
    }, { fetchImpl: fetchMock as unknown as typeof fetch })

    expect(result.thread.workingIdea.purpose).toBe('Reduce onboarding drop-off for first-time users.')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/turns')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ message: 'Reduce onboarding drop-off for first-time users.' }))
  })

  it('approves a proposal through the approval contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'approved',
        thread: {
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Please elaborate this idea into a clearer opportunity and suggest a useful next step.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: 'Idea title',
            currentSummary: 'Expanded summary',
            purpose: null,
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
        },
        canonicalWritePayload: {
          ideaId: 'idea-123',
          expectedSnapshotVersion: 1,
          title: 'Idea title',
          body: '',
          threadSummary: 'Expanded summary',
        },
        threadEventId: 'event-2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { approveIdeaThreadProposal } = await import('./assistant-service-client')
    const result = await approveIdeaThreadProposal({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      proposalId: 'proposal-1',
      expectedSnapshotVersion: 1,
    }, { fetchImpl: fetchMock as unknown as typeof fetch })

    expect(result.outcome).toBe('approved')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/approve')
    expect(init?.method).toBe('POST')
  })

  it('rejects a proposal through the rejection contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'rejected',
        thread: {
          threadId: 'thread-local-user:idea-123',
          ideaId: 'idea-123',
          userId: 'local-user',
          stage: 'discovery',
          status: 'idle',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Please elaborate this idea into a clearer opportunity and suggest a useful next step.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: 'Idea title',
            currentSummary: 'Expanded summary',
            purpose: null,
            scope: null,
            targetUsers: [],
            expectedImpact: null,
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
        },
        threadEventId: 'event-2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { rejectIdeaThreadProposal } = await import('./assistant-service-client')
    const result = await rejectIdeaThreadProposal({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      proposalId: 'proposal-1',
    }, { fetchImpl: fetchMock as unknown as typeof fetch })

    expect(result.outcome).toBe('rejected')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/reject')
    expect(init?.method).toBe('POST')
  })
})
