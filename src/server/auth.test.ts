import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@libsql/client'
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

describe('auth session bridge', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
  })

  it('resolves an anonymous Better Auth session into a planner user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: 'session-1',
            user: {
              id: 'anon-user',
              email: 'temp@anon-user.com',
              name: 'Anonymous',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'better-auth.session_token=session-1; Path=/; HttpOnly; SameSite=Lax',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', userId: 'anon-user' },
          user: { id: 'anon-user', email: 'temp@anon-user.com', name: 'Anonymous' },
        }),
      )

    const result = await resolveAuthenticatedPlannerUser(db, {
      requestHeaders: { origin: 'http://localhost:3000' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: 'https://assistant.example',
      setResponseHeaderImpl: vi.fn() as unknown as typeof import('@tanstack/start-server-core').setResponseHeader,
    })

    expect(result.user.email).toBe('temp@anon-user.com')
  })
})
