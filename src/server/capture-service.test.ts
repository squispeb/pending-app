import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createCaptureService } from './capture-service'
import type { CaptureInterpreter } from './capture-interpreter'

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
}

describe('capture service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
  })

  it('merges hosted interpretation output into a typed task draft', async () => {
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask() {
        return {
          title: 'Entregar primera tarea de Cloud Computing',
          notes: 'Resolver y entregar la primera tarea del curso Cloud Computing.',
          priority: 'high',
          dueDate: '2026-04-12',
          interpretationNotes: ['Hosted interpreter inferred a cleaner title.'],
        }
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput({
      rawInput:
        'Tengo que entregar para el domingo que viene la primera tarea del curso Cloud Computing, en este tengo que resolverlo lo antes posible.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      throw new Error('Expected successful capture interpretation')
    }

    expect(result.draft.title).toBe('Entregar primera tarea de Cloud Computing')
    expect(result.draft.priority).toBe('high')
    expect(result.draft.dueDate).toBe('2026-04-12')
    expect(result.draft.interpretationNotes).toContain('Hosted interpreter inferred a cleaner title.')
  })

  it('falls back to heuristic draft data when hosted interpretation fails', async () => {
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask() {
        throw new Error('Provider unavailable')
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput({
      rawInput: 'Comprar focos para la sala mañana.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      throw new Error('Expected heuristic fallback result')
    }

    expect(result.draft.dueDate).toBe('2026-04-09')
    expect(result.draft.title).toBe('Comprar focos para la sala mañana')
    expect(result.draft.interpretationNotes).toContain(
      'Task interpretation failed; review inferred fields carefully.',
    )
  })

  it('creates a task through the existing task service on confirmation', async () => {
    const service = createCaptureService(db, null)

    const result = await service.confirmCapturedTask({
      rawInput: 'Submit the design review notes by Friday at 3pm.',
      task: {
        title: 'Submit design review notes',
        notes: 'Share notes with the team.',
        priority: 'high',
        dueDate: '2026-04-10',
        dueTime: '15:00',
        reminderAt: '',
        estimatedMinutes: 30,
        preferredStartTime: '',
        preferredEndTime: '',
      },
    })

    expect(result.ok).toBe(true)

    const tasks = await db.query.tasks.findMany()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Submit design review notes')
    expect(tasks[0]?.dueTime).toBe('15:00')
  })
})
