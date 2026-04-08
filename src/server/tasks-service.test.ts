import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createTasksService } from './tasks-service'
import { DEFAULT_USER } from './default-user'

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

describe('tasks service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createTasksService>

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    service = createTasksService(db)
  })

  it('creates the default user lazily', async () => {
    const user = await service.ensureDefaultUser()

    expect(user.id).toBe(DEFAULT_USER.id)
    expect(user.email).toBe(DEFAULT_USER.email)
  })

  it('creates and lists a task with reminder support', async () => {
    const created = await service.createTask({
      title: 'Plan sprint',
      notes: 'Bring roadmap draft',
      priority: 'high',
      dueDate: '2026-04-03',
      dueTime: '09:30',
      reminderAt: '2026-04-03T08:45',
      estimatedMinutes: 30,
      preferredStartTime: '08:30',
      preferredEndTime: '09:30',
    })

    const tasks = await service.listTasks()

    expect(tasks).toHaveLength(1)
    expect(created.id).toBe(tasks[0]?.id)
    expect(tasks[0]?.title).toBe('Plan sprint')
    expect(tasks[0]?.priority).toBe('high')
    expect(tasks[0]?.reminderAt).toBeInstanceOf(Date)
  })

  it('lists task calendar links when present', async () => {
    const created = await service.createTask({
      title: 'Plan sprint',
      notes: '',
      priority: 'high',
      dueDate: '2026-04-03',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    await db.run(sql`
      INSERT INTO calendar_connections (
        id, user_id, google_account_id, calendar_id, calendar_name, is_selected, primary_flag, created_at, updated_at
      ) VALUES (
        'conn-1', 'local-user', 'google-1', 'calendar-1', 'Primary', 1, 1, (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)
    await db.run(sql`
      INSERT INTO calendar_events (
        id, user_id, calendar_id, google_event_id, google_recurring_event_id, status, summary,
        starts_at, ends_at, all_day, html_link, synced_at, created_at, updated_at
      ) VALUES (
        'evt-1', 'local-user', 'calendar-1', 'google-evt-1', 'series-1', 'confirmed', 'Cloud Computing',
        strftime('%s', '2026-04-10 15:00:00') * 1000,
        strftime('%s', '2026-04-10 16:00:00') * 1000,
        0,
        'https://calendar.google.com/event?eid=1',
        (unixepoch() * 1000), (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)
    await db.run(sql`
      INSERT INTO planning_item_calendar_links (
        id, user_id, source_type, source_id, calendar_id, google_event_id, google_recurring_event_id,
        matched_summary, match_reason, created_at, updated_at
      ) VALUES (
        'link-1', 'local-user', 'task', ${created.id}, 'calendar-1', 'google-evt-1', 'series-1',
        'Cloud Computing', 'Matched recurring event: Cloud Computing',
        (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)

    const tasksWithLinks = await service.listTasksWithCalendarLinks(new Date('2026-04-09T12:00:00Z'))

    expect(tasksWithLinks[0]?.calendarLinks).toHaveLength(1)
    expect(tasksWithLinks[0]?.calendarLinks[0]?.matchedSummary).toBe('Cloud Computing')
    expect(tasksWithLinks[0]?.calendarLinks[0]?.resolvedEvent?.htmlLink).toBe(
      'https://calendar.google.com/event?eid=1',
    )
  })

  it('updates a task and keeps it active', async () => {
    await service.createTask({
      title: 'Draft agenda',
      notes: '',
      priority: 'medium',
      dueDate: '2026-04-05',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    const [task] = await service.listTasks()

    await service.updateTask({
      id: task!.id,
      title: 'Draft team agenda',
      notes: 'Include roadmap review',
      priority: 'low',
      dueDate: '2026-04-06',
      dueTime: '13:00',
      reminderAt: '2026-04-06T12:30',
      estimatedMinutes: 20,
      preferredStartTime: '12:00',
      preferredEndTime: '13:30',
    })

    const [updated] = await service.listTasks()

    expect(updated?.title).toBe('Draft team agenda')
    expect(updated?.notes).toBe('Include roadmap review')
    expect(updated?.priority).toBe('low')
    expect(updated?.dueTime).toBe('13:00')
  })

  it('completes, reopens, and archives a task', async () => {
    await service.createTask({
      title: 'Review invoices',
      notes: '',
      priority: 'medium',
      dueDate: '2026-04-04',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    const [task] = await service.listTasks()

    await service.completeTask(task!.id)

    let [updated] = await service.listTasks()
    expect(updated?.status).toBe('completed')
    expect(updated?.completedAt).toBeInstanceOf(Date)

    await service.reopenTask(task!.id)

    ;[updated] = await service.listTasks()
    expect(updated?.status).toBe('active')
    expect(updated?.completedAt).toBeNull()

    await service.archiveTask(task!.id)

    const remaining = await service.listTasks()
    expect(remaining).toHaveLength(0)
  })

  it('defers a task reminder forward', async () => {
    await service.createTask({
      title: 'Review invoices',
      notes: '',
      priority: 'medium',
      dueDate: '2026-04-04',
      dueTime: '',
      reminderAt: '2026-04-04T09:00',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    const [task] = await service.listTasks()

    const result = await service.deferTaskReminder(
      task!.id,
      30,
      new Date('2026-04-04T09:15:00'),
    )

    expect(result.ok).toBe(true)
    expect(result.reminderAt.getTime()).toBe(new Date('2026-04-04T09:15:00').getTime() + 30 * 60_000)
  })
})
