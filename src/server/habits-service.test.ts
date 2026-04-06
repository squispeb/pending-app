import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { DEFAULT_USER } from './default-user'
import { createHabitsService } from './habits-service'

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

  await db.run(sql`
    CREATE TABLE habit_completions (
      id text PRIMARY KEY NOT NULL,
      habit_id text NOT NULL,
      user_id text NOT NULL,
      completion_date text NOT NULL,
      completed_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE cascade,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX habit_completion_unique ON habit_completions (habit_id, completion_date);
  `)
}

describe('habits service', () => {
  let service: ReturnType<typeof createHabitsService>
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(async () => {
    const database = makeDatabase()
    db = database.db
    await createSchema(db)
    service = createHabitsService(db)
  })

  it('creates the default user lazily', async () => {
    const user = await service.ensureDefaultUser()

    expect(user.id).toBe(DEFAULT_USER.id)
  })

  it('creates and lists a habit', async () => {
    await service.createHabit({
      title: 'Read 10 pages',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '20:00',
      preferredEndTime: '21:00',
      reminderAt: '2026-04-01T19:45',
    })

    const habits = await service.listHabits()

    expect(habits).toHaveLength(1)
    expect(habits[0]?.title).toBe('Read 10 pages')
    expect(habits[0]?.cadenceType).toBe('daily')
  })

  it('updates and archives a habit', async () => {
    await service.createHabit({
      title: 'Workout',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'wed'],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    const [habit] = await service.listHabits()

    await service.updateHabit({
      id: habit!.id,
      title: 'Workout + stretch',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'wed', 'fri'],
      targetCount: 1,
      preferredStartTime: '07:00',
      preferredEndTime: '08:00',
      reminderAt: '2026-04-01T06:30',
    })

    let [updated] = await service.listHabits()
    expect(updated?.title).toBe('Workout + stretch')

    await service.archiveHabit(habit!.id)

    ;[updated] = await service.listHabits()
    expect(updated?.archivedAt).toBeInstanceOf(Date)
  })

  it('stores one completion per habit per day and can uncomplete it', async () => {
    await service.createHabit({
      title: 'Journal',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    const [habit] = await service.listHabits()

    await service.completeHabitForDate({ habitId: habit!.id, date: '2026-04-01' })
    await service.completeHabitForDate({ habitId: habit!.id, date: '2026-04-01' })

    let completions = await service.listHabitCompletions('2026-04-01', '2026-04-01')
    expect(completions).toHaveLength(1)
    expect(completions[0]?.completionDate).toBe('2026-04-01')

    await service.uncompleteHabitForDate({ habitId: habit!.id, date: '2026-04-01' })

    completions = await service.listHabitCompletions('2026-04-01', '2026-04-01')
    expect(completions).toHaveLength(0)
  })
})
