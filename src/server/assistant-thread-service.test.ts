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
}

describe('assistant thread service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>

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
        Response.json({
          threadId: 'thread-user-1:idea-123',
          ideaId: 'idea-123',
          userId: 'user-1',
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
        Response.json({
          threadId: 'thread-user-1:idea-123',
          ideaId: 'idea-123',
          userId: 'user-1',
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
          threadId: 'thread-user-1:idea-123',
          ideaId: 'idea-123',
          userId: 'user-1',
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
          thread: {
            threadId: 'thread-user-1:idea-123',
            ideaId: 'idea-123',
            userId: 'user-1',
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
          },
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
          thread: {
            threadId: 'thread-user-1:idea-123',
            ideaId: 'idea-123',
            userId: 'user-1',
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
          },
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
          thread: {
            threadId: 'thread-user-1:idea-123',
            ideaId: 'idea-123',
            userId: 'user-1',
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
          },
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
