import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
          status: 'ready',
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
      status: 'ready',
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
})
