import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createCaptureService } from './capture-service'
import { CaptureInterpreterError, type CaptureInterpreter } from './capture-interpreter'

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
    CREATE TABLE habits (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      title text NOT NULL,
      cadence_type text DEFAULT 'daily' NOT NULL,
      cadence_days text,
      target_count integer DEFAULT 1 NOT NULL,
      preferred_start_time text,
      preferred_end_time text,
      reminder_at integer,
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
    expect(result.draft.candidateType).toBe('task')
    expect(result.draft.interpretationNotes).toContain('Hosted interpreter inferred a cleaner title.')
  })

  it('returns a habit candidate draft with cadence when recurring intent is detected', async () => {
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask() {
        return {
          candidateType: 'habit',
          title: 'Meditar',
          cadenceType: 'selected_days',
          cadenceDays: ['mon', 'thu'],
          targetCount: 1,
          interpretationNotes: ['Detected recurring cadence from weekdays.'],
        }
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput({
      rawInput: 'Meditar cada lunes y jueves',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      throw new Error('Expected habit candidate draft')
    }

    expect(result.draft.candidateType).toBe('habit')
    expect(result.draft.cadenceType).toBe('selected_days')
    expect(result.draft.cadenceDays).toEqual(['mon', 'thu'])
    expect(result.draft.targetCount).toBe(1)
  })

  it('returns an explicit failure result when hosted interpretation fails', async () => {
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask() {
        throw new CaptureInterpreterError('Capture interpretation failed (503).', 'REQUEST')
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput({
      rawInput: 'Comprar focos para la sala mañana.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result).toEqual({
      ok: false,
      code: 'INTERPRETATION_FAILED',
      message: 'Capture interpretation failed (503).',
      rawInput: 'Comprar focos para la sala mañana.',
    })
  })

  it('returns invalid provider output when hosted interpretation response is malformed', async () => {
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask() {
        throw new CaptureInterpreterError(
          'Capture interpretation returned an invalid task draft.',
          'INVALID_RESPONSE',
        )
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput({
      rawInput: 'Need to deal with taxes tomorrow.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'en',
    })

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_PROVIDER_OUTPUT',
      message: 'Capture interpretation returned an invalid task draft.',
      rawInput: 'Need to deal with taxes tomorrow.',
    })
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

  it('creates a habit through the existing habit service on confirmation', async () => {
    const service = createCaptureService(db, null)

    const result = await service.confirmCapturedHabit({
      rawInput: 'Meditar cada lunes y jueves',
      habit: {
        title: 'Meditar',
        cadenceType: 'selected_days',
        cadenceDays: ['mon', 'thu'],
        targetCount: 1,
        preferredStartTime: '07:00',
        preferredEndTime: '07:30',
        reminderAt: '',
      },
    })

    expect(result.ok).toBe(true)

    const habits = await db.query.habits.findMany()
    expect(habits).toHaveLength(1)
    expect(habits[0]?.title).toBe('Meditar')
    expect(habits[0]?.cadenceType).toBe('selected_days')
    expect(habits[0]?.cadenceDays).toBe('["mon","thu"]')
  })
})
