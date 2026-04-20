import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createAssistantThreadService } from './assistant-thread-service'

function makeDatabase() {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })

  return { client, db }
}

async function createSchema(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db.run(sql`
    CREATE TABLE users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL UNIQUE,
      display_name text,
      timezone text DEFAULT 'UTC' NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
    );
  `)

  await db.run(sql`
    CREATE TABLE ideas (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      title text NOT NULL,
      body text DEFAULT '' NOT NULL,
      source_type text DEFAULT 'manual' NOT NULL,
      source_input text,
      thread_summary text,
      stage text DEFAULT 'discovery' NOT NULL,
      classification_confidence text,
      capture_language text,
      status text DEFAULT 'active' NOT NULL,
      starred_at integer,
      archived_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE idea_snapshots (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      body text DEFAULT '' NOT NULL,
      source_type text DEFAULT 'manual' NOT NULL,
      source_input text,
      thread_summary text,
      stage text DEFAULT 'discovery' NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_snapshot_version_unique
      ON idea_snapshots (idea_id, version);
  `)

  await db.run(sql`
    CREATE TABLE idea_thread_refs (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      thread_id text NOT NULL,
      initial_snapshot_id text NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade,
      FOREIGN KEY (initial_snapshot_id) REFERENCES idea_snapshots(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_thread_ref_idea_unique
      ON idea_thread_refs (idea_id);
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_thread_ref_thread_unique
      ON idea_thread_refs (thread_id);
  `)

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS idea_execution_links (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      link_reason text,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS accepted_breakdown_steps (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      step_order integer NOT NULL,
      step_text text NOT NULL,
      completed_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      title text NOT NULL,
      notes text,
      status text DEFAULT 'active' NOT NULL,
      priority text DEFAULT 'medium' NOT NULL,
      due_date text,
      due_time text,
      reminder_at integer,
      estimated_minutes integer,
      preferred_start_time text,
      preferred_end_time text,
      completed_at integer,
      archived_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS task_execution_artifacts (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      user_id text NOT NULL,
      artifact_type text NOT NULL,
      source text DEFAULT 'user' NOT NULL,
      content text NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

}

describe('assistant thread service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>

  function makeThread(overrides: Record<string, unknown> = {}) {
    return {
      threadId: 'thread-user-1:idea-123',
      ideaId: 'idea-123',
      userId: 'user-1',
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

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
  })

  it('resolves an assistant thread only for the authenticated owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(makeThread()),
      )

    const service = createAssistantThreadService(db)
    const result = await service.resolveIdeaThread('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
    })

    expect(result).toEqual({
      threadId: 'thread-user-1:idea-123',
      ideaId: 'idea-123',
      userId: 'user-1',
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
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, assistantRequest] = fetchMock.mock.calls[1] ?? []
    const headers = assistantRequest?.headers as Headers
    expect(headers.get('cookie')).toBe('better-auth.session_token=session-1')
  })

  it('blocks thread resolution when the authenticated user does not own the idea', async () => {
    await db.insert(schema.users).values([
      {
        id: 'user-1',
        email: 'user-1@example.com',
        displayName: 'User One',
        timezone: 'UTC',
      },
      {
        id: 'user-2',
        email: 'user-2@example.com',
        displayName: 'User Two',
        timezone: 'UTC',
      },
    ])
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaExecutionLinks).values({
      id: 'link-1',
      ideaId: 'idea-123',
      targetType: 'task',
      targetId: 'task-1',
      linkReason: 'Accepted breakdown step #1 from idea.',
    })
    await db.insert(schema.acceptedBreakdownSteps).values({
      id: 'step-1',
      ideaId: 'idea-123',
      stepOrder: 1,
      stepText: 'Validate the riskiest assumption',
      completedAt: null,
    })

    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: { id: 'session-2', userId: 'user-2' },
        user: { id: 'user-2', email: 'user-2@example.com', name: 'User Two' },
      }),
    )

    const service = createAssistantThreadService(db)

    await expect(
      service.resolveIdeaThread('idea-123', {
        requestHeaders: { cookie: 'better-auth.session_token=session-2' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      }),
    ).rejects.toThrow('Idea not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes a compact execution summary into assistant work requests', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaExecutionLinks).values({
      id: 'link-1',
      ideaId: 'idea-123',
      targetType: 'task',
      targetId: 'task-1',
      linkReason: 'Accepted breakdown step #1 from idea.',
    })
    await db.insert(schema.acceptedBreakdownSteps).values({
      id: 'step-1',
      ideaId: 'idea-123',
      stepOrder: 1,
      stepText: 'Validate the riskiest assumption',
      completedAt: null,
    })
    await db.insert(schema.ideaSnapshots).values({
      id: 'snapshot-1',
      ideaId: 'idea-123',
      version: 1,
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
      stage: 'developed',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ok: true,
          outcome: 'proposal_created',
          thread: makeThread({ stage: 'developed' }),
          proposal: { explanation: 'Generated a richer version of the idea.' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const service = createAssistantThreadService(db)

    await service.requestIdeaThreadElaboration('idea-123', {
      actionInput: null,
      currentSnapshotVersion: 1,
      currentTitle: 'Owned idea',
      currentBody: 'Private idea body',
      currentSummary: null,
    }, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
    })

    const [, init] = fetchMock.mock.calls.at(-1) ?? []
    expect(JSON.parse(String(init?.body))).toHaveProperty('executionSummary')
  })

  it('bootstraps and stores thread linkage for a newly created idea', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'typed_capture',
      sourceInput: 'This should create a thread link.',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(makeThread()),
      )

    const service = createAssistantThreadService(db)
    const result = await service.bootstrapIdeaThread('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
    })

    const threadRef = await db.query.ideaThreadRefs.findFirst({
      where: eq(schema.ideaThreadRefs.ideaId, 'idea-123'),
    })
    const snapshot = await db.query.ideaSnapshots.findFirst({
      where: eq(schema.ideaSnapshots.id, result.initialSnapshotId),
    })

    expect(result).toMatchObject({
      threadId: 'thread-user-1:idea-123',
      created: true,
    })
    expect(threadRef).toMatchObject({
      ideaId: 'idea-123',
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: result.initialSnapshotId,
    })
    expect(snapshot).toMatchObject({
      ideaId: 'idea-123',
      version: 1,
      title: 'Owned idea',
      sourceInput: 'This should create a thread link.',
      stage: 'discovery',
    })
  })

  it('reuses an existing stored thread reference for the owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaExecutionLinks).values({
      id: 'link-1',
      ideaId: 'idea-123',
      targetType: 'task',
      targetId: 'task-1',
      linkReason: 'Accepted breakdown step #1 from idea.',
    })
    await db.insert(schema.acceptedBreakdownSteps).values({
      id: 'step-1',
      ideaId: 'idea-123',
      stepOrder: 1,
      stepText: 'Validate the riskiest assumption',
      completedAt: null,
    })
    await db.insert(schema.ideaSnapshots).values({
      id: 'snapshot-1',
      ideaId: 'idea-123',
      version: 1,
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaThreadRefs).values({
      id: 'thread-ref-1',
      ideaId: 'idea-123',
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: 'snapshot-1',
    })

    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: { id: 'session-1', userId: 'user-1' },
        user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      }),
    )

    const service = createAssistantThreadService(db)
    const result = await service.bootstrapIdeaThread('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
    })

    expect(result).toEqual({
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: 'snapshot-1',
      created: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retrieves visible thread history only for the authenticated owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaExecutionLinks).values({
      id: 'link-1',
      ideaId: 'idea-123',
      targetType: 'task',
      targetId: 'task-1',
      linkReason: 'Accepted breakdown step #1 from idea.',
    })
    await db.insert(schema.acceptedBreakdownSteps).values({
      id: 'step-1',
      ideaId: 'idea-123',
      stepOrder: 1,
      stepText: 'Validate the riskiest assumption',
      completedAt: null,
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(makeThread()),
      )

    const service = createAssistantThreadService(db)
    const result = await service.getIdeaThread('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
    })

    expect(result.visibleEvents).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123')
    expect(init?.method).toBe('GET')
  })

  it('requests an elaborate proposal for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
              provisionalTitle: 'Owned idea',
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
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.requestIdeaThreadElaboration(
      'idea-123',
      {
        actionInput: null,
        currentSnapshotVersion: 1,
        currentTitle: 'Owned idea',
        currentBody: 'Private idea body',
        currentSummary: null,
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('proposal_created')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/elaborate')
    expect(init?.method).toBe('POST')
  })

  it('requests a title improvement for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.requestIdeaThreadTitleImprovement(
      'idea-123',
      {
        currentSnapshotVersion: 2,
        currentTitle: 'Owned idea',
        currentBody: 'Private idea body',
        currentSummary: 'Current summary',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.action).toBe('title')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/improve-title')
    expect(init?.method).toBe('POST')
  })

  it('requests a summary improvement for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.requestIdeaThreadSummaryImprovement(
      'idea-123',
      {
        currentSnapshotVersion: 2,
        currentTitle: 'Owned idea',
        currentBody: 'Private idea body',
        currentSummary: 'Current summary',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.action).toBe('summary')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/improve-summary')
    expect(init?.method).toBe('POST')
  })

  it('requests a restructure action for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          outcome: 'proposal_created',
          action: 'restructure',
          thread: makeThread({ stage: 'developed' }),
          proposal: {
            explanation: 'Restructured the framing to make the idea easier to evaluate.',
          },
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.requestIdeaThreadRestructure(
      'idea-123',
      {
        currentSnapshotVersion: 2,
        currentTitle: 'Owned idea',
        currentBody: 'Private idea body',
        currentSummary: 'Current summary',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.action).toBe('restructure')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/restructure')
    expect(init?.method).toBe('POST')
  })

  it('requests a breakdown action for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          outcome: 'proposal_created',
          action: 'breakdown',
          thread: makeThread({ stage: 'developed' }),
          proposal: {
            explanation: 'Broke the idea into concrete next steps without converting it yet.',
          },
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.requestIdeaThreadBreakdown(
      'idea-123',
      {
        currentSnapshotVersion: 2,
        currentTitle: 'Owned idea',
        currentBody: 'Private idea body',
        currentSummary: 'Current summary',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.action).toBe('breakdown')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/breakdown')
    expect(init?.method).toBe('POST')
  })

  it('accepts a structured action for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          outcome: 'accepted',
          thread: makeThread({ stage: 'developed' }),
          threadEventId: 'event-accept-1',
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.acceptIdeaThreadStructuredAction(
      'idea-123',
      { proposalId: 'proposal-1' },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('accepted')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/accept-structured')
    expect(init?.method).toBe('POST')
  })

  it('records accepted breakdown plan storage for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          outcome: 'recorded',
          thread: makeThread({ stage: 'developed' }),
          threadEventId: 'event-plan-1',
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.recordBreakdownPlanForIdeaThread(
      'idea-123',
      {
        summary: 'Stored accepted breakdown plan with 4 steps.',
        stepCount: 4,
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('recorded')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/record-breakdown-plan')
    expect(init?.method).toBe('POST')
  })

  it('rejects a structured action for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          outcome: 'rejected',
          thread: makeThread({ stage: 'developed' }),
          threadEventId: 'event-reject-1',
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.rejectIdeaThreadStructuredAction(
      'idea-123',
      { proposalId: 'proposal-1' },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('rejected')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/reject-structured')
    expect(init?.method).toBe('POST')
  })

  it('submits a discovery turn for the authenticated idea owner', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
              createdAt: '2026-04-12T00:00:30.000Z',
              completedAt: null,
            },
            queuedTurns: [],
            lastTurn: {
              turnId: 'turn-1',
              source: 'text',
              userMessage: 'Reduce onboarding drop-off for first-time users.',
              transcriptLanguage: null,
              state: 'processing',
              createdAt: '2026-04-12T00:00:30.000Z',
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
                createdAt: '2026-04-12T00:00:30.000Z',
                summary: 'Reduce onboarding drop-off for first-time users.',
                visibleToUser: true,
              },
            ],
            workingIdea: {
              provisionalTitle: 'Owned idea',
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
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.submitIdeaDiscoveryTurn(
      'idea-123',
      {
        message: 'Reduce onboarding drop-off for first-time users.',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.thread.workingIdea.purpose).toBe('Reduce onboarding drop-off for first-time users.')
    expect(result.outcome).toBe('accepted')
    expect(result.state).toBe('processing')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/turns')
    expect(init?.method).toBe('POST')
  })

  it('persists a canonical checkpoint when reading a completed thread state that advanced stage', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })
    await db.insert(schema.ideaExecutionLinks).values({
      id: 'link-1',
      ideaId: 'idea-123',
      targetType: 'task',
      targetId: 'task-1',
      linkReason: 'Accepted breakdown step #1 from idea.',
    })
    await db.insert(schema.acceptedBreakdownSteps).values({
      id: 'step-1',
      ideaId: 'idea-123',
      stepOrder: 1,
      stepText: 'Validate the riskiest assumption',
      completedAt: null,
    })
    await db.insert(schema.ideaSnapshots).values({
      id: 'snapshot-1',
      ideaId: 'idea-123',
      version: 1,
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
      threadSummary: null,
      stage: 'discovery',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(makeThread({
          stage: 'framing',
          status: 'idle',
          activeTurn: null,
          queuedTurns: [],
          lastTurn: {
            turnId: 'turn-1',
            source: 'text',
            userMessage: 'Reduce onboarding drop-off for first-time users.',
            transcriptLanguage: null,
            state: 'completed',
            createdAt: '2026-04-12T00:00:30.000Z',
            completedAt: '2026-04-12T00:00:31.000Z',
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
              type: 'assistant_synthesis',
              createdAt: '2026-04-12T00:00:31.000Z',
              summary: 'Captured purpose: Reduce onboarding drop-off for first-time users.',
              visibleToUser: true,
            },
            {
              eventId: 'event-3',
              type: 'stage_changed',
              createdAt: '2026-04-12T00:00:31.500Z',
              summary: 'The idea has enough context to move from discovery into framing.',
              visibleToUser: true,
            },
          ],
          workingIdea: {
            provisionalTitle: 'Owned idea',
            currentSummary: 'Purpose: Reduce onboarding drop-off for first-time users.',
            purpose: 'Reduce onboarding drop-off for first-time users.',
            scope: 'Start with a guided onboarding checklist for first-time users.',
            targetUsers: ['First-time users'],
            expectedImpact: 'Improve activation and reduce early drop-off.',
            researchAreas: [],
            constraints: [],
            openQuestions: [],
          },
        })),
      )

    const service = createAssistantThreadService(db)
    const result = await service.getIdeaThread('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      assistantServiceBaseUrl: 'https://assistant.example',
    })

    expect(result.stage).toBe('framing')

    const detail = await db.query.ideas.findFirst({
      where: eq(schema.ideas.id, 'idea-123'),
    })
    const snapshots = await db.query.ideaSnapshots.findMany({
      where: eq(schema.ideaSnapshots.ideaId, 'idea-123'),
      orderBy: [schema.ideaSnapshots.version],
    })

    expect(detail).toMatchObject({
      stage: 'framing',
      threadSummary: 'Purpose: Reduce onboarding drop-off for first-time users.',
    })
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1]).toMatchObject({
      version: 2,
      stage: 'framing',
      threadSummary: 'Purpose: Reduce onboarding drop-off for first-time users.',
    })
  })

  it('approves a proposal through the authenticated assistant thread boundary', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
              provisionalTitle: 'Owned idea',
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
            title: 'Owned idea',
            body: '',
            threadSummary: 'Expanded summary',
          },
          threadEventId: 'event-2',
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.approveIdeaThreadProposal(
      'idea-123',
      {
        proposalId: 'proposal-1',
        expectedSnapshotVersion: 1,
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('approved')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/approve')
    expect(init?.method).toBe('POST')
  })

  it('rejects a proposal through the authenticated assistant thread boundary', async () => {
    await db.insert(schema.users).values({
      id: 'user-1',
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    await db.insert(schema.ideas).values({
      id: 'idea-123',
      userId: 'user-1',
      title: 'Owned idea',
      body: 'Private idea body',
      sourceType: 'manual',
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
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
              provisionalTitle: 'Owned idea',
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
        }),
      )

    const service = createAssistantThreadService(db)
    const result = await service.rejectIdeaThreadProposal(
      'idea-123',
      {
        proposalId: 'proposal-1',
      },
      {
        requestHeaders: { cookie: 'better-auth.session_token=session-1' },
        fetchImpl: fetchMock as unknown as typeof fetch,
        assistantServiceBaseUrl: 'https://assistant.example',
      },
    )

    expect(result.outcome).toBe('rejected')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://assistant.example/threads/idea-123/actions/reject')
    expect(init?.method).toBe('POST')
  })
})
