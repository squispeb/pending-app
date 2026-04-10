import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createIdeasService } from './ideas-service'

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

describe('ideas service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createIdeasService>
  const primaryUserId = 'user-1'
  const secondaryUserId = 'user-2'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    await db.insert(schema.users).values([
      {
        id: primaryUserId,
        email: 'user-1@example.com',
        displayName: 'User One',
        timezone: 'UTC',
      },
      {
        id: secondaryUserId,
        email: 'user-2@example.com',
        displayName: 'User Two',
        timezone: 'UTC',
      },
    ])
    service = createIdeasService(db)
  })

  it('creates and retrieves a canonical idea with source input', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Personal knowledge garden',
      body: 'Turn captured ideas into reusable notes with visible refinement history.',
      sourceType: 'typed_capture',
      sourceInput: 'I want this app to become a place for my best ideas.',
    })

    const ideas = await service.listIdeas(primaryUserId)
    const detail = await service.getIdea(created.id, primaryUserId)

    expect(ideas).toHaveLength(1)
    expect(ideas[0]?.id).toBe(created.id)
    expect(ideas[0]?.sourceType).toBe('typed_capture')
    expect(detail?.sourceInput).toBe('I want this app to become a place for my best ideas.')
  })

  it('orders starred ideas first and then by recency', async () => {
    const first = await service.createIdea(primaryUserId, {
      title: 'Older idea',
      body: 'This should be pushed down by more recent work.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = await service.createIdea(primaryUserId, {
      title: 'Newer idea',
      body: 'This should appear first until starring changes the order.',
      sourceType: 'manual',
      sourceInput: '',
    })

    let ideas = await service.listIdeas(primaryUserId)
    expect(ideas.map((idea) => idea.id)).toEqual([second.id, first.id])

    await service.toggleIdeaStar(first.id, primaryUserId)

    ideas = await service.listIdeas(primaryUserId)
    expect(ideas.map((idea) => idea.id)).toEqual([first.id, second.id])
    expect(ideas[0]?.starredAt).toBeInstanceOf(Date)
  })

  it('toggles star state off when an already starred idea is toggled again', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Star toggling',
      body: 'Make sure starring is reversible.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.toggleIdeaStar(created.id, primaryUserId)
    let detail = await service.getIdea(created.id, primaryUserId)
    expect(detail?.starredAt).toBeInstanceOf(Date)

    await service.toggleIdeaStar(created.id, primaryUserId)
    detail = await service.getIdea(created.id, primaryUserId)
    expect(detail?.starredAt).toBeNull()
  })

  it('scopes reads and mutations to the authenticated user id', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Private idea',
      body: 'Only the owning user should be able to see this.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await expect(service.getIdea(created.id, secondaryUserId)).resolves.toBeUndefined()
    await expect(service.listIdeas(secondaryUserId)).resolves.toEqual([])
    await expect(service.toggleIdeaStar(created.id, secondaryUserId)).rejects.toThrow('Idea not found')
  })
})
