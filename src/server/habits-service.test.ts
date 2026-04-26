import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
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

describe('habits service', () => {
  let service: ReturnType<typeof createHabitsService>
  let db: ReturnType<typeof drizzle<typeof schema>>
  const primaryUserId = 'user-1'
  const secondaryUserId = 'user-2'

  beforeEach(async () => {
    const database = makeDatabase()
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
    service = createHabitsService(db)
  })

  it('creates and lists a habit', async () => {
    const created = await service.createHabit(primaryUserId, {
      title: 'Read 10 pages',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '20:00',
      preferredEndTime: '21:00',
      reminderAt: '2026-04-01T19:45',
    })

    const habits = await service.listHabits(primaryUserId)

    expect(habits).toHaveLength(1)
    expect(created.id).toBe(habits[0]?.id)
    expect(habits[0]?.title).toBe('Read 10 pages')
    expect(habits[0]?.cadenceType).toBe('daily')
  })

  it('lists habit calendar links when present', async () => {
    const created = await service.createHabit(primaryUserId, {
      title: 'Read 10 pages',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    await db.run(sql`
      INSERT INTO calendar_connections (
        id, user_id, google_account_id, calendar_id, calendar_name, is_selected, primary_flag, can_write, created_at, updated_at
      ) VALUES (
        'conn-1', ${primaryUserId}, 'google-1', 'calendar-1', 'Primary', 1, 1, 1, (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)
    await db.run(sql`
      INSERT INTO calendar_events (
        id, user_id, calendar_id, google_event_id, google_recurring_event_id, status, summary,
        starts_at, ends_at, all_day, html_link, synced_at, created_at, updated_at
      ) VALUES (
        'evt-1', ${primaryUserId}, 'calendar-1', 'google-evt-1', 'series-1', 'confirmed', 'Cloud Computing',
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
        'link-1', ${primaryUserId}, 'habit', ${created.id}, 'calendar-1', 'google-evt-1', 'series-1',
        'Cloud Computing', 'Matched recurring event: Cloud Computing',
        (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)

    const habitsWithLinks = await service.listHabitsWithCalendarLinks(primaryUserId, new Date('2026-04-09T12:00:00Z'))

    expect(habitsWithLinks[0]?.calendarLinks).toHaveLength(1)
    expect(habitsWithLinks[0]?.calendarLinks[0]?.matchedSummary).toBe('Cloud Computing')
    expect(habitsWithLinks[0]?.calendarLinks[0]?.resolvedEvent?.htmlLink).toBe(
      'https://calendar.google.com/event?eid=1',
    )
  })

  it('updates and archives a habit', async () => {
    await service.createHabit(primaryUserId, {
      title: 'Workout',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'wed'],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    const [habit] = await service.listHabits(primaryUserId)

    await service.updateHabit(primaryUserId, {
      id: habit!.id,
      title: 'Workout + stretch',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'wed', 'fri'],
      targetCount: 1,
      preferredStartTime: '07:00',
      preferredEndTime: '08:00',
      reminderAt: '2026-04-01T06:30',
    })

    let [updated] = await service.listHabits(primaryUserId)
    expect(updated?.title).toBe('Workout + stretch')

    await service.archiveHabit(habit!.id, primaryUserId)

    ;[updated] = await service.listHabits(primaryUserId)
    expect(updated?.archivedAt).toBeInstanceOf(Date)
  })

  it('stores one completion per habit per day and can uncomplete it', async () => {
    await service.createHabit(primaryUserId, {
      title: 'Journal',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    const [habit] = await service.listHabits(primaryUserId)

    await service.completeHabitForDate(primaryUserId, { habitId: habit!.id, date: '2026-04-01' })
    await service.completeHabitForDate(primaryUserId, { habitId: habit!.id, date: '2026-04-01' })

    let completions = await service.listHabitCompletions(primaryUserId, '2026-04-01', '2026-04-01')
    expect(completions).toHaveLength(1)
    expect(completions[0]?.completionDate).toBe('2026-04-01')

    await service.uncompleteHabitForDate(primaryUserId, { habitId: habit!.id, date: '2026-04-01' })

    completions = await service.listHabitCompletions(primaryUserId, '2026-04-01', '2026-04-01')
    expect(completions).toHaveLength(0)
  })

  it('blocks cross-user habit access', async () => {
    const created = await service.createHabit(primaryUserId, {
      title: 'Private habit',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    await expect(service.listHabits(secondaryUserId)).resolves.toEqual([])

    await service.archiveHabit(created.id, secondaryUserId)

    const [habit] = await service.listHabits(primaryUserId)
    expect(habit?.archivedAt).toBeNull()

    await expect(
      service.completeHabitForDate(secondaryUserId, {
        habitId: created.id,
        date: '2026-04-01',
      }),
    ).rejects.toThrow('Habit not found')

    const completions = await service.listHabitCompletions(secondaryUserId, '2026-04-01', '2026-04-01')
    expect(completions).toEqual([])
  })
})
