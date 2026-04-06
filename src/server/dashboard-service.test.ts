import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createTasksService } from './tasks-service'
import { createHabitsService } from './habits-service'
import { createDashboardService } from './dashboard-service'

function makeDatabase() {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })
  return { db }
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

  await db.run(sql`
    CREATE TABLE reminder_events (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      source_type text NOT NULL,
      source_id text NOT NULL,
      scheduled_for integer NOT NULL,
      snoozed_until integer,
      delivered_in_app_at integer,
      delivered_browser_at integer,
      completed_via_reminder_at integer,
      dismissed_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)
}

describe('dashboard service', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>
  let tasksService: ReturnType<typeof createTasksService>
  let habitsService: ReturnType<typeof createHabitsService>
  let dashboardService: ReturnType<typeof createDashboardService>

  beforeEach(async () => {
    const database = makeDatabase()
    db = database.db
    await createSchema(db)
    tasksService = createTasksService(db)
    habitsService = createHabitsService(db)
    dashboardService = createDashboardService(db)
  })

  it('aggregates tasks, habits, and due reminders for today', async () => {
    await tasksService.createTask({
      title: 'Review roadmap',
      notes: '',
      priority: 'high',
      dueDate: '2026-04-01',
      dueTime: '10:00',
      reminderAt: '2026-04-01T09:15',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    await habitsService.createHabit({
      title: 'Read',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '2026-04-01T07:30',
    })

    const result = await dashboardService.getDashboardData(new Date('2026-04-01T10:30:00'))

    expect(result.taskSummary.dueToday).toBe(1)
    expect(result.habitSummary.dueToday).toBe(1)
    expect(result.dueTodayTasks).toHaveLength(1)
    expect(result.todayHabits).toHaveLength(1)
    expect(result.dueReminders.length).toBeGreaterThanOrEqual(1)
  })
})
