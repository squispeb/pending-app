import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'

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
}

describe('authenticated planner user resolution', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('upserts the authenticated Better Auth user into the planner database', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        session: { id: 'session-1', userId: 'user-1' },
        user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      }),
    )

    const result = await resolveAuthenticatedPlannerUser(db, {
      requestHeaders: { cookie: 'better-auth.session_token=existing-session' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: 'https://assistant.example',
      setResponseHeaderImpl: vi.fn() as unknown as typeof import('@tanstack/start-server-core').setResponseHeader,
    })

    expect(result.user.id).toBe('user-1')
    expect(result.user.email).toBe('user-1@example.com')
    expect(result.user.displayName).toBe('User One')
    expect(result.authHeaders.get('cookie')).toBe('better-auth.session_token=existing-session')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://assistant.example/api/auth/get-session', {
      method: 'GET',
      headers: expect.any(Headers),
    })
  })

  it('requires an authenticated Better Auth session', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(null))

    await expect(
      resolveAuthenticatedPlannerUser(db, {
        requestHeaders: new Headers(),
        fetchImpl: fetchMock as unknown as typeof fetch,
        baseUrl: 'https://assistant.example',
        setResponseHeaderImpl: vi.fn() as unknown as typeof import('@tanstack/start-server-core').setResponseHeader,
      }),
    ).rejects.toThrow('Authentication required')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
