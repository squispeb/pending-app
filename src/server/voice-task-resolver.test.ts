import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createVoiceTaskResolver } from './voice-task-resolver'

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
    CREATE TABLE tasks (
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
    CREATE TABLE idea_execution_links (
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
}

describe('voice task resolver', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  const userId = 'user-1'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)

    await db.run(sql`
      INSERT INTO users (id, email, timezone, created_at, updated_at)
      VALUES ('user-1', 'me@example.com', 'UTC', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
  })

  it('resolves an explicit current task context first', async () => {
    await db.run(sql`
      INSERT INTO tasks (id, user_id, title, created_at, updated_at)
      VALUES ('task-1', ${userId}, 'Call the bank', (unixepoch() * 1000), (unixepoch() * 1000));
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextTaskId: 'task-1',
    })

    expect(result).toEqual({
      kind: 'resolved',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_task',
      },
    })
  })

  it('treats archived current task context as unresolved', async () => {
    await db.run(sql`
      INSERT INTO tasks (
        id,
        user_id,
        title,
        status,
        archived_at,
        created_at,
        updated_at
      ) VALUES (
        'task-1',
        ${userId},
        'Archived task',
        'archived',
        (unixepoch() * 1000),
        (unixepoch() * 1000),
        (unixepoch() * 1000)
      );
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextTaskId: 'task-1',
    })

    expect(result).toEqual({ kind: 'unresolved' })
  })

  it('prefers contextTaskId over a linked context idea task', async () => {
    await db.run(sql`
      INSERT INTO ideas (id, user_id, title, created_at, updated_at)
      VALUES ('idea-1', ${userId}, 'Bank follow-up', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO tasks (id, user_id, title, created_at, updated_at)
      VALUES
        ('task-1', ${userId}, 'Call the bank', (unixepoch() * 1000), (unixepoch() * 1000)),
        ('task-2', ${userId}, 'Review launch checklist', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO idea_execution_links (id, idea_id, target_type, target_id, link_reason, created_at, updated_at)
      VALUES ('link-1', 'idea-1', 'task', 'task-2', 'Converted from idea.', (unixepoch() * 1000), (unixepoch() * 1000));
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextTaskId: 'task-1',
      contextIdeaId: 'idea-1',
    })

    expect(result).toEqual({
      kind: 'resolved',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_task',
      },
    })
  })

  it('resolves a unique idea-linked task from context', async () => {
    await db.run(sql`
      INSERT INTO ideas (id, user_id, title, created_at, updated_at)
      VALUES ('idea-1', ${userId}, 'Bank follow-up', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO tasks (id, user_id, title, created_at, updated_at)
      VALUES ('task-1', ${userId}, 'Call the bank', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO idea_execution_links (id, idea_id, target_type, target_id, link_reason, created_at, updated_at)
      VALUES ('link-1', 'idea-1', 'task', 'task-1', 'Converted from idea.', (unixepoch() * 1000), (unixepoch() * 1000));
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextIdeaId: 'idea-1',
    })

    expect(result).toEqual({
      kind: 'resolved',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_idea',
      },
    })
  })

  it('returns unresolved when an idea context has no linked tasks', async () => {
    await db.run(sql`
      INSERT INTO ideas (id, user_id, title, created_at, updated_at)
      VALUES ('idea-1', ${userId}, 'Bank follow-up', (unixepoch() * 1000), (unixepoch() * 1000));
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextIdeaId: 'idea-1',
    })

    expect(result).toEqual({
      kind: 'unresolved',
    })
  })

  it('returns ambiguity when idea context links to multiple tasks', async () => {
    await db.run(sql`
      INSERT INTO ideas (id, user_id, title, created_at, updated_at)
      VALUES ('idea-1', ${userId}, 'Launch prep', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO tasks (id, user_id, title, created_at, updated_at)
      VALUES
        ('task-1', ${userId}, 'Draft launch email', (unixepoch() * 1000), (unixepoch() * 1000)),
        ('task-2', ${userId}, 'Review launch checklist', (unixepoch() * 1000), (unixepoch() * 1000));
    `)
    await db.run(sql`
      INSERT INTO idea_execution_links (id, idea_id, target_type, target_id, link_reason, created_at, updated_at)
      VALUES
        ('link-1', 'idea-1', 'task', 'task-1', 'Converted from idea.', (unixepoch() * 1000), (unixepoch() * 1000)),
        ('link-2', 'idea-1', 'task', 'task-2', 'Accepted breakdown step #1 from idea.', (unixepoch() * 1000), (unixepoch() * 1000));
    `)

    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      contextIdeaId: 'idea-1',
    })

    expect(result).toEqual({
      kind: 'ambiguous',
      candidates: [
        {
          id: 'task-1',
          title: 'Draft launch email',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'context_idea',
        },
        {
          id: 'task-2',
          title: 'Review launch checklist',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'context_idea',
        },
      ],
    })
  })

  it('resolves a unique visible task window match', async () => {
    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      transcript: 'Call the bank about the card',
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Call the bank',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
        {
          id: 'task-2',
          title: 'Review launch checklist',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({
      kind: 'resolved',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'visible_window',
      },
    })
  })

  it('resolves a visible task window match from due date, due time, and pending status cues', async () => {
    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      transcript: 'Quiero que cierres la tarea pendiente que estaba para el día sábado a las seis de la tarde.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Call the bank',
          status: 'active',
          dueDate: '2026-04-11',
          dueTime: '18:00',
          priority: 'medium',
          completedAt: null,
        },
        {
          id: 'task-2',
          title: 'Review launch checklist',
          status: 'completed',
          dueDate: '2026-04-11',
          dueTime: '18:00',
          priority: 'medium',
          completedAt: '2026-04-10T10:00:00.000Z',
        },
      ],
    })

    expect(result).toEqual({
      kind: 'resolved',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: '2026-04-11',
        dueTime: '18:00',
        priority: 'medium',
        completedAt: null,
        source: 'visible_window',
      },
    })
  })

  it('returns ambiguity when multiple visible tasks match', async () => {
    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      transcript: 'Review launch tasks',
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Review launch email',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
        {
          id: 'task-2',
          title: 'Review launch checklist',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({
      kind: 'ambiguous',
      candidates: [
        {
          id: 'task-1',
          title: 'Review launch email',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'visible_window',
        },
        {
          id: 'task-2',
          title: 'Review launch checklist',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'visible_window',
        },
      ],
    })
  })

  it('returns unresolved when no visible task matches', async () => {
    const resolver = createVoiceTaskResolver(db)
    const result = await resolver.resolveTaskTarget({
      userId,
      transcript: 'Book a dentist appointment',
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Call the bank',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({ kind: 'unresolved' })
  })
})
