import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createTasksService } from './tasks-service'
import { createHabitsService } from './habits-service'
import { createDashboardService } from './dashboard-service'
import { createRemindersService } from './reminders-service'

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
    CREATE TABLE google_accounts (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      google_subject text NOT NULL,
      email text NOT NULL,
      scope text,
      access_token text,
      refresh_token text,
      token_expiry_at integer,
      connected_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      disconnected_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE sync_states (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      provider text NOT NULL,
      scope_key text NOT NULL,
      last_synced_at integer,
      next_sync_token text,
      sync_window_start integer,
      sync_window_end integer,
      last_status text,
      last_error text,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
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

  await db.run(sql`
    CREATE TABLE planning_item_calendar_links (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      source_type text NOT NULL,
      source_id text NOT NULL,
      calendar_id text NOT NULL,
      google_event_id text NOT NULL,
      google_recurring_event_id text,
      matched_summary text NOT NULL,
      match_reason text NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX planning_item_calendar_link_source_unique
    ON planning_item_calendar_links (source_type, source_id);
  `)

  await db.run(sql`
    CREATE TABLE calendar_connections (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      google_account_id text NOT NULL,
      calendar_id text NOT NULL,
      calendar_name text NOT NULL,
      is_selected integer DEFAULT false NOT NULL,
      primary_flag integer DEFAULT false NOT NULL,
      can_write integer DEFAULT false NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE calendar_events (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      calendar_id text NOT NULL,
      google_event_id text NOT NULL,
      google_recurring_event_id text,
      status text DEFAULT 'confirmed' NOT NULL,
      summary text,
      description text,
      location text,
      starts_at integer NOT NULL,
      ends_at integer NOT NULL,
      all_day integer DEFAULT false NOT NULL,
      event_timezone text,
      html_link text,
      organizer_email text,
      attendee_count integer,
      synced_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at_remote integer,
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
  let remindersService: ReturnType<typeof createRemindersService>
  const userId = 'user-1'

  beforeEach(async () => {
    const database = makeDatabase()
    db = database.db
    await createSchema(db)
    await db.insert(schema.users).values({
      id: userId,
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    tasksService = createTasksService(db)
    habitsService = createHabitsService(db)
    dashboardService = createDashboardService(db)
    remindersService = createRemindersService(db)
  })

  it('aggregates tasks, habits, and due reminders for today', async () => {
    await tasksService.createTask(userId, {
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

    await habitsService.createHabit(userId, {
      title: 'Read',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '2026-04-01T07:30',
    })

    const result = await dashboardService.getDashboardData(userId, new Date('2026-04-01T10:30:00'))

    expect(result.taskSummary.dueToday).toBe(1)
    expect(result.habitSummary.dueToday).toBe(1)
    expect(result.dueTodayTasks).toHaveLength(1)
    expect(result.todayHabits).toHaveLength(1)
    expect(result.dueReminders.length).toBeGreaterThanOrEqual(1)
  })

  it('removes a reminder from due-now after defer until the new time arrives', async () => {
    await tasksService.createTask(userId, {
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

    let result = await dashboardService.getDashboardData(userId, new Date('2026-04-01T09:20:00'))
    const reminder = result.dueReminders.find((item) => item.sourceType === 'task')

    expect(reminder).toBeDefined()

    await remindersService.deferReminder(reminder!.id, userId, 30)
    const [updatedTask] = await tasksService.listTasks(userId)

    expect(updatedTask?.reminderAt).toBeInstanceOf(Date)

    result = await dashboardService.getDashboardData(userId, new Date('2026-04-01T09:20:00'))
    expect(result.dueReminders.find((item) => item.sourceType === 'task')).toBeUndefined()

    result = await dashboardService.getDashboardData(
      userId,
      new Date((updatedTask?.reminderAt ?? new Date()).getTime() + 5 * 60_000),
    )
    expect(result.dueReminders.find((item) => item.sourceType === 'task')).toBeDefined()
  })
})
