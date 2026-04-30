import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('assistant service client', () => {
  beforeEach(() => {
    process.env.ASSISTANT_SERVICE_URL = 'https://assistant.example'
  })

  function makeThread(overrides: Record<string, unknown> = {}) {
    return {
      threadId: 'thread-local-user:idea-123',
      ideaId: 'idea-123',
      userId: 'local-user',
      stage: 'discovery',
      status: 'idle',
      activeTurn: null,
      queuedTurns: [],
      lastTurn: null,
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
      ...overrides,
    }
  }

  it('forwards authenticated headers and sends the resolve thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(makeThread()),
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
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result).toEqual({
      threadId: 'thread-local-user:idea-123',
      ideaId: 'idea-123',
      userId: 'local-user',
      stage: 'discovery',
      status: 'idle',
      activeTurn: null,
      queuedTurns: [],
      lastTurn: null,
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

  it('resolves a calendar event creation session contract', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessionId: 'session-123',
      userId: 'local-user',
      channel: 'mixed',
      status: 'idle',
      activeTurn: null,
      queuedTurns: [],
      lastTurn: null,
      visibleEvents: [],
      context: {
        target: { kind: 'calendar_event', label: 'Team sync' },
        writableCalendars: [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
          },
        ],
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'create',
        phase: 'collecting',
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        draft: { title: 'Team sync' },
        requestedFields: [],
        missingFields: [],
        activeField: null,
        fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
        changes: {},
        result: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { resolveAssistantCalendarEventCreateSession } = await import('./assistant-service-client')
    const result = await resolveAssistantCalendarEventCreateSession(
      {
        authHeaders: { authorization: 'Bearer test-session-token' },
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        draft: { title: 'Team sync' },
        writableCalendars: [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
          },
        ],
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result.workflow?.kind).toBe('calendar_event')
    expect(result.workflow && 'operation' in result.workflow ? result.workflow.operation : null).toBe('create')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/sessions/resolve')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      channel: 'mixed',
      context: {
        target: { kind: 'calendar_event', label: 'Team sync' },
        writableCalendars: [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
          },
        ],
      },
      workflow: { kind: 'calendar_event', operation: 'create', currentDate: '2026-04-25', timezone: 'America/Lima' },
    })
  })

  it('resolves a calendar event edit session contract with a target event', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessionId: 'session-123',
      userId: 'local-user',
      channel: 'mixed',
      status: 'idle',
      activeTurn: null,
      queuedTurns: [],
      lastTurn: null,
      visibleEvents: [],
      context: {
        target: { kind: 'calendar_event', id: 'evt-1', label: 'Team sync' },
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'edit',
        phase: 'collecting',
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        target: { eventId: 'evt-1', summary: 'Team sync', calendarName: 'Primary' },
        draft: { title: 'Team sync', targetCalendarName: 'Primary' },
        requestedFields: [],
        missingFields: [],
        activeField: null,
        fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
        changes: {},
        result: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { resolveAssistantCalendarEventEditSession } = await import('./assistant-service-client')
    const result = await resolveAssistantCalendarEventEditSession(
      {
        authHeaders: { authorization: 'Bearer test-session-token' },
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        target: { eventId: 'evt-1', summary: 'Team sync', calendarName: 'Primary' },
        draft: { title: 'Team sync', targetCalendarName: 'Primary' },
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result.workflow?.kind).toBe('calendar_event')
    expect(result.workflow && 'operation' in result.workflow ? result.workflow.operation : null).toBe('edit')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/sessions/resolve')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      workflow: {
        kind: 'calendar_event',
        operation: 'edit',
        target: { eventId: 'evt-1', summary: 'Team sync', calendarName: 'Primary' },
      },
    })
  })

  it('resolves a calendar event cancel session contract with a target event', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessionId: 'session-123',
      userId: 'local-user',
      channel: 'mixed',
      status: 'idle',
      activeTurn: null,
      queuedTurns: [],
      lastTurn: null,
      visibleEvents: [],
      context: {
        target: { kind: 'calendar_event', id: 'evt-1', label: 'Team sync' },
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'cancel',
        phase: 'ready_to_confirm',
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        target: { eventId: 'evt-1', summary: 'Team sync', calendarName: 'Primary' },
        result: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { resolveAssistantCalendarEventCancelSession } = await import('./assistant-service-client')
    const result = await resolveAssistantCalendarEventCancelSession(
      {
        authHeaders: { authorization: 'Bearer test-session-token' },
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        target: { eventId: 'evt-1', summary: 'Team sync', calendarName: 'Primary' },
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result.workflow?.kind).toBe('calendar_event')
    expect(result.workflow && 'operation' in result.workflow ? result.workflow.operation : null).toBe('cancel')
  })

  it('resolves a visible calendar event target without sending auth headers in the body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      kind: 'resolved',
      target: {
        eventId: 'evt-1',
        summary: 'Team sync',
        startsAt: '2026-04-25T15:00:00.000Z',
        endsAt: '2026-04-25T15:30:00.000Z',
        allDay: false,
        calendarName: 'Primary',
        primaryFlag: true,
        source: 'visible_window',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { resolveAssistantCalendarEventTarget } = await import('./assistant-service-client')
    const result = await resolveAssistantCalendarEventTarget(
      {
        authHeaders: { authorization: 'Bearer test-session-token' },
        transcript: 'Edit the team sync on Primary',
        transcriptLanguage: 'en',
        currentDate: '2026-04-25',
        timezone: 'America/Lima',
        visibleCalendarEventWindow: [
          {
            eventId: 'evt-1',
            summary: 'Team sync',
            startsAt: '2026-04-25T15:00:00.000Z',
            endsAt: '2026-04-25T15:30:00.000Z',
            allDay: false,
            calendarName: 'Primary',
            primaryFlag: true,
          },
        ],
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result.kind).toBe('resolved')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/sessions/resolve-calendar-event-target')
    expect(JSON.parse(String(init?.body))).toEqual({
      transcript: 'Edit the team sync on Primary',
      transcriptLanguage: 'en',
      currentDate: '2026-04-25',
      timezone: 'America/Lima',
      visibleCalendarEventWindow: [
        {
          eventId: 'evt-1',
          summary: 'Team sync',
          startsAt: '2026-04-25T15:00:00.000Z',
          endsAt: '2026-04-25T15:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
        },
      ],
    })
  })

  it('submits calendar session turn patches with validated target context', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      outcome: 'accepted',
      turnId: 'turn-1',
      state: 'processing',
      queueDepth: 0,
      session: {
        sessionId: 'session-123',
        userId: 'local-user',
        channel: 'mixed',
        status: 'processing',
        activeTurn: {
          turnId: 'turn-1',
          source: 'voice',
          userMessage: 'use the Side Projects calendar',
          transcriptLanguage: 'en',
          state: 'processing',
          createdAt: '2026-04-25T10:00:00.000Z',
          completedAt: null,
        },
        queuedTurns: [],
        lastTurn: {
          turnId: 'turn-1',
          source: 'voice',
          userMessage: 'use the Side Projects calendar',
          transcriptLanguage: 'en',
          state: 'processing',
          createdAt: '2026-04-25T10:00:00.000Z',
          completedAt: null,
        },
        visibleEvents: [],
        context: {
          target: {
            kind: 'calendar_event',
            id: 'side-projects',
            label: 'Side Projects',
          },
          writableCalendars: [
            {
              calendarId: 'primary',
              calendarName: 'Primary',
              primaryFlag: true,
            },
            {
              calendarId: 'side-projects',
              calendarName: 'Side Projects',
              primaryFlag: false,
            },
          ],
        },
        workflow: {
          kind: 'calendar_event',
          operation: 'create',
          phase: 'collecting',
          currentDate: '2026-04-25',
          timezone: 'America/Lima',
          draft: {
            targetCalendarId: 'side-projects',
            targetCalendarName: 'Side Projects',
          },
          requestedFields: [],
          missingFields: [],
          activeField: null,
          fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
          changes: {
            targetCalendarId: 'side-projects',
            targetCalendarName: 'Side Projects',
          },
          result: null,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { submitAssistantSessionTurn } = await import('./assistant-service-client')
    const result = await submitAssistantSessionTurn({
      sessionId: 'session-123',
      authHeaders: { authorization: 'Bearer test-session-token' },
      message: 'use the Side Projects calendar',
      source: 'voice',
      transcriptLanguage: 'en',
      context: {
        target: {
          kind: 'calendar_event',
          id: 'side-projects',
          label: 'Side Projects',
        },
        writableCalendars: [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
          },
          {
            calendarId: 'side-projects',
            calendarName: 'Side Projects',
            primaryFlag: false,
          },
        ],
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'create',
        draft: {
          targetCalendarId: 'side-projects',
          targetCalendarName: 'Side Projects',
        },
        changes: {
          targetCalendarId: 'side-projects',
          targetCalendarName: 'Side Projects',
        },
      },
    }, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: 'https://assistant.example',
    })

    expect(result.turnId).toBe('turn-1')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/sessions/session-123/turns')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: 'use the Side Projects calendar',
      context: {
        target: {
          kind: 'calendar_event',
          id: 'side-projects',
          label: 'Side Projects',
        },
        writableCalendars: [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
          },
          {
            calendarId: 'side-projects',
            calendarName: 'Side Projects',
            primaryFlag: false,
          },
        ],
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'create',
        draft: {
          targetCalendarId: 'side-projects',
          targetCalendarName: 'Side Projects',
        },
        changes: {
          targetCalendarId: 'side-projects',
          targetCalendarName: 'Side Projects',
        },
      },
    })
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
        { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
      ),
    ).rejects.toThrow('Unauthorized thread access')
  })

  it('retrieves visible thread history through the read contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(makeThread()),
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
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
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
        { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
      ),
    ).rejects.toThrow('Failed to read thread state')
  })

  it('requests an elaborate proposal through the action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        thread: makeThread({
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
        }),
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
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'discovery',
        latestSnapshot: null,
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('proposal_created')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/elaborate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      executionSummary: expect.stringContaining('Idea idea-123 is currently in discovery.'),
    })
  })

  it('requests a title improvement through the dedicated action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        action: 'title',
        thread: makeThread({
          stage: 'developed',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Please improve the title only and keep the underlying idea grounded in the current thread context.',
              visibleToUser: true,
            },
          ],
        }),
        proposal: {
          explanation: 'Suggested a clearer title grounded in the existing thread context.',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { requestIdeaThreadTitleImprovement } = await import('./assistant-service-client')
    const result = await requestIdeaThreadTitleImprovement({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      currentSnapshotVersion: 2,
      currentTitle: 'Idea title',
      currentBody: 'Idea body',
      currentSummary: 'Current summary',
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'developed',
        latestSnapshot: { version: 2, title: 'Idea title', threadSummary: 'Current summary' },
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.action).toBe('title')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/improve-title')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      executionSummary: expect.stringContaining('Idea idea-123 is currently in developed.'),
    })
  })

  it('parses task creation payloads when accepting a convert-to-task proposal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          outcome: 'accepted',
          thread: makeThread({ stage: 'developed' }),
          threadEventId: 'event-accept-1',
          taskCreationPayload: {
            taskTitle: 'Reduce onboarding drop-off',
            taskDescription: 'Validate the riskiest assumption and run the first experiment.',
            suggestedSteps: ['Validate the riskiest assumption', 'Run the first experiment'],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const { acceptIdeaThreadStructuredAction } = await import('./assistant-service-client')
    const result = await acceptIdeaThreadStructuredAction(
      {
        ideaId: 'idea-123',
        authHeaders: { cookie: 'better-auth.session_token=test-session' },
        proposalId: 'proposal-1',
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' },
    )

    expect(result.taskCreationPayload).toEqual({
      taskTitle: 'Reduce onboarding drop-off',
      taskDescription: 'Validate the riskiest assumption and run the first experiment.',
      suggestedSteps: ['Validate the riskiest assumption', 'Run the first experiment'],
    })
  })

  it('requests a summary improvement through the dedicated action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        action: 'summary',
        thread: makeThread({
          stage: 'developed',
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'user_turn_added',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Please improve the summary only and keep it concise, product-relevant, and grounded in the current thread context.',
              visibleToUser: true,
            },
          ],
        }),
        proposal: {
          explanation: 'Suggested a sharper summary grounded in the existing thread context.',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { requestIdeaThreadSummaryImprovement } = await import('./assistant-service-client')
    const result = await requestIdeaThreadSummaryImprovement({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      currentSnapshotVersion: 2,
      currentTitle: 'Idea title',
      currentBody: 'Idea body',
      currentSummary: 'Current summary',
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'developed',
        latestSnapshot: { version: 2, title: 'Idea title', threadSummary: 'Current summary' },
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.action).toBe('summary')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/improve-summary')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      executionSummary: expect.stringContaining('Idea idea-123 is currently in developed.'),
    })
  })

  it('requests a restructure action through the dedicated action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        action: 'restructure',
        thread: makeThread({ stage: 'developed' }),
        proposal: {
          explanation: 'Restructured the framing to make the idea easier to evaluate.',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { requestIdeaThreadRestructure } = await import('./assistant-service-client')
    const result = await requestIdeaThreadRestructure({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      currentSnapshotVersion: 2,
      currentTitle: 'Idea title',
      currentBody: 'Idea body',
      currentSummary: 'Current summary',
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'developed',
        latestSnapshot: { version: 2, title: 'Idea title', threadSummary: 'Current summary' },
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.action).toBe('restructure')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/restructure')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      currentSnapshotVersion: 2,
      executionSummary: expect.stringContaining('Idea idea-123 is currently in developed.'),
    })
  })

  it('requests a breakdown action through the dedicated action contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'proposal_created',
        action: 'breakdown',
        thread: makeThread({
          stage: 'developed',
          pendingStructuredAction: {
            proposalId: 'proposal-1',
            action: 'breakdown',
            basedOnSnapshotVersion: 2,
            proposedSummary: '1. Validate the riskiest assumption. 2. Draft the first experiment. 3. Define success metrics.',
            proposedSteps: [
              'Validate the riskiest assumption.',
              'Draft the first experiment.',
              'Define success metrics.',
            ],
            explanation: 'Broke the idea into concrete next steps without converting it yet.',
          },
        }),
        proposal: {
          explanation: 'Broke the idea into concrete next steps without converting it yet.',
          proposedSteps: [
            'Validate the riskiest assumption.',
            'Draft the first experiment.',
            'Define success metrics.',
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { requestIdeaThreadBreakdown } = await import('./assistant-service-client')
    const result = await requestIdeaThreadBreakdown({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      currentSnapshotVersion: 2,
      currentTitle: 'Idea title',
      currentBody: 'Idea body',
      currentSummary: 'Current summary',
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'developed',
        latestSnapshot: { version: 2, title: 'Idea title', threadSummary: 'Current summary' },
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.action).toBe('breakdown')
    expect(result.thread.pendingStructuredAction?.proposedSteps).toEqual([
      'Validate the riskiest assumption.',
      'Draft the first experiment.',
      'Define success metrics.',
    ])
    expect(result.proposal.proposedSteps).toEqual([
      'Validate the riskiest assumption.',
      'Draft the first experiment.',
      'Define success metrics.',
    ])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/breakdown')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      currentSnapshotVersion: 2,
      executionSummary: expect.stringContaining('Idea idea-123 is currently in developed.'),
    })
  })

  it('accepts a structured action through the dedicated review contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'accepted',
        thread: makeThread({ stage: 'developed' }),
        threadEventId: 'event-accept-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { acceptIdeaThreadStructuredAction } = await import('./assistant-service-client')
    const result = await acceptIdeaThreadStructuredAction({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      proposalId: 'proposal-1',
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('accepted')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/accept-structured')
    expect(init?.method).toBe('POST')
  })

  it('records a task-created write-back through the dedicated thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'recorded',
        thread: makeThread({
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'task_created',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Created task Reduce onboarding drop-off from the accepted idea conversion.',
              visibleToUser: true,
              taskId: 'task-123',
              stepOrder: 2,
            },
          ],
        }),
        threadEventId: 'event-task-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { recordTaskCreatedForIdeaThread } = await import('./assistant-service-client')
    const result = await recordTaskCreatedForIdeaThread({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      taskId: 'task-123',
      summary: 'Created task Reduce onboarding drop-off from the accepted idea conversion.',
      stepOrder: 2,
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('recorded')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/record-task-created')
    expect(init?.method).toBe('POST')
  })

  it('rejects a structured action through the dedicated review contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'rejected',
        thread: makeThread({ stage: 'developed' }),
        threadEventId: 'event-reject-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { rejectIdeaThreadStructuredAction } = await import('./assistant-service-client')
    const result = await rejectIdeaThreadStructuredAction({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      proposalId: 'proposal-1',
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('rejected')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/reject-structured')
    expect(init?.method).toBe('POST')
  })

  it('records a progress update through the dedicated thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'recorded',
        thread: makeThread({
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'step_status_changed',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Marked accepted breakdown step #2 done: Run quick discovery.',
              visibleToUser: true,
              stepOrder: 2,
              status: 'completed',
            },
          ],
        }),
        threadEventId: 'event-progress-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { recordProgressUpdateForIdeaThread } = await import('./assistant-service-client')
    const result = await recordProgressUpdateForIdeaThread({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      summary: 'Marked accepted breakdown step #2 done: Run quick discovery.',
      stepOrder: 2,
      status: 'completed',
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('recorded')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/record-progress-update')
    expect(init?.method).toBe('POST')
  })

  it('records accepted breakdown plan storage through the dedicated thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'recorded',
        thread: makeThread({
          visibleEvents: [
            {
              eventId: 'event-1',
              type: 'breakdown_plan_recorded',
              createdAt: '2026-04-12T00:00:30.000Z',
              summary: 'Stored accepted breakdown plan with 4 steps.',
              visibleToUser: true,
              stepCount: 4,
              steps: ['Validate discovery', 'Draft the prototype', 'Test the workflow', 'Review results'],
            },
          ],
        }),
        threadEventId: 'event-plan-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { recordBreakdownPlanForIdeaThread } = await import('./assistant-service-client')
    const result = await recordBreakdownPlanForIdeaThread({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      summary: 'Stored accepted breakdown plan with 4 steps.',
      stepCount: 4,
      steps: ['Validate discovery', 'Draft the prototype', 'Test the workflow', 'Review results'],
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('recorded')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/record-breakdown-plan')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      summary: 'Stored accepted breakdown plan with 4 steps.',
      stepCount: 4,
      steps: ['Validate discovery', 'Draft the prototype', 'Test the workflow', 'Review results'],
    })
  })

  it('submits a discovery turn through the thread contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'accepted',
        turnId: 'turn-1',
        state: 'processing',
        queueDepth: 0,
        thread: makeThread({
          status: 'processing',
          activeTurn: {
            turnId: 'turn-1',
            source: 'text',
            userMessage: 'Reduce onboarding drop-off for first-time users.',
            transcriptLanguage: null,
            state: 'processing',
            createdAt: '2026-04-12T00:01:00.000Z',
            completedAt: null,
          },
          lastTurn: {
            turnId: 'turn-1',
            source: 'text',
            userMessage: 'Reduce onboarding drop-off for first-time users.',
            transcriptLanguage: null,
            state: 'processing',
            createdAt: '2026-04-12T00:01:00.000Z',
            completedAt: null,
          },
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
        }),
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { submitIdeaDiscoveryTurn } = await import('./assistant-service-client')
    const result = await submitIdeaDiscoveryTurn({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      message: 'Reduce onboarding drop-off for first-time users.',
      executionSummary: {
        ideaId: 'idea-123',
        stage: 'discovery',
        latestSnapshot: null,
        acceptedBreakdownSteps: [],
        linkedTasks: [],
      },
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.thread.workingIdea.purpose).toBe('Reduce onboarding drop-off for first-time users.')
    expect(result.outcome).toBe('accepted')
    expect(result.state).toBe('processing')
    expect(result.turnId).toBe('turn-1')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/turns')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: 'Reduce onboarding drop-off for first-time users.',
      executionSummary: expect.stringContaining('Idea idea-123 is currently in discovery.'),
    })
  })

  it('passes the last event id when reconnecting a thread stream', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('id: event-1\ndata: {"streamEventId":"event-1","type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    const { streamAssistantIdeaThread } = await import('./assistant-service-client')
    const response = await streamAssistantIdeaThread({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      lastEventId: 'event-99',
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/stream')
    const headers = init?.headers as Headers
    expect(headers.get('last-event-id')).toBe('event-99')
  })

  it('approves a proposal through the approval contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        outcome: 'approved',
        thread: makeThread({
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
        }),
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
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

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
        thread: makeThread({
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
        }),
        threadEventId: 'event-2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const { rejectIdeaThreadProposal } = await import('./assistant-service-client')
    const result = await rejectIdeaThreadProposal({
      ideaId: 'idea-123',
      authHeaders: { cookie: 'better-auth.session_token=test-session' },
      proposalId: 'proposal-1',
    }, { fetchImpl: fetchMock as unknown as typeof fetch, baseUrl: 'https://assistant.example' })

    expect(result.outcome).toBe('rejected')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/reject')
    expect(init?.method).toBe('POST')
  })
})
