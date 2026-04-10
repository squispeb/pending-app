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
}

async function seedSelectedCalendar(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db.run(sql`
    INSERT OR IGNORE INTO users (
      id,
      email,
      timezone,
      created_at,
      updated_at
    ) VALUES (
      'user-1',
      'me@example.com',
      'UTC',
      (unixepoch() * 1000),
      (unixepoch() * 1000)
    );
  `)

  await db.run(sql`
    INSERT INTO calendar_connections (
      id,
      user_id,
      google_account_id,
      calendar_id,
      calendar_name,
      is_selected,
      primary_flag,
      created_at,
      updated_at
    ) VALUES (
      'conn-1',
      'user-1',
      'google-1',
      'calendar-1',
      'Primary',
      1,
      1,
      (unixepoch() * 1000),
      (unixepoch() * 1000)
    );
  `)
}

describe('capture service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  const userId = 'user-1'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
  })

  it('merges hosted interpretation output into a typed task draft', async () => {
    await seedSelectedCalendar(db)
    await db.run(sql`
      INSERT INTO calendar_events (
        id,
        user_id,
        calendar_id,
        google_event_id,
        google_recurring_event_id,
        status,
        summary,
        starts_at,
        ends_at,
        all_day,
        synced_at,
        created_at,
        updated_at
      ) VALUES (
        'evt-cloud-1',
        ${userId},
        'calendar-1',
        'google-event-1',
        'series-cloud',
        'confirmed',
        'Cloud Computing',
        strftime('%s', '2026-04-10 15:00:00') * 1000,
        strftime('%s', '2026-04-10 16:00:00') * 1000,
        0,
        (unixepoch() * 1000),
        (unixepoch() * 1000),
        (unixepoch() * 1000)
      );
    `)

    const interpreter: CaptureInterpreter = {
      async interpretTypedTask(input) {
        expect(input.calendarContext).toHaveLength(1)
        expect(input.calendarContext[0]).toMatchObject({
          calendarEventId: 'evt-cloud-1',
          summary: 'Cloud Computing',
          recurring: true,
        })

        return {
          title: 'Entregar primera tarea de Cloud Computing',
          notes: 'Resolver y entregar la primera tarea del curso Cloud Computing.',
          priority: 'high',
          dueDate: '2026-04-12',
          matchedCalendarContext: {
            calendarEventId: 'evt-cloud-1',
            summary: 'Cloud Computing',
            reason: 'Matched recurring event: Cloud Computing',
          },
          interpretationNotes: ['Hosted interpreter inferred a cleaner title.'],
        }
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput(userId, {
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
    expect(result.draft.matchedCalendarContext).toEqual({
      calendarEventId: 'evt-cloud-1',
      summary: 'Cloud Computing',
      reason: 'Matched recurring event: Cloud Computing',
    })
    expect(result.draft.interpretationNotes).toContain('Hosted interpreter inferred a cleaner title.')
  })

  it('keeps calendar context empty when there is no relevant local event match', async () => {
    await seedSelectedCalendar(db)
    const interpreter: CaptureInterpreter = {
      async interpretTypedTask(input) {
        expect(input.calendarContext).toEqual([])

        return {
          candidateType: 'task',
          title: 'Deal with taxes',
          interpretationNotes: ['No calendar context matched.'],
        }
      },
    }
    const service = createCaptureService(db, interpreter)

    const result = await service.interpretTypedTaskInput(userId, {
      rawInput: 'Need to deal with taxes tomorrow.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'en',
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      throw new Error('Expected no-match capture interpretation')
    }

    expect(result.draft.matchedCalendarContext).toBeNull()
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

    const result = await service.interpretTypedTaskInput(userId, {
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

    const result = await service.interpretTypedTaskInput(userId, {
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

    const result = await service.interpretTypedTaskInput(userId, {
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
    await seedSelectedCalendar(db)
    await db.run(sql`
      INSERT INTO calendar_events (
        id, user_id, calendar_id, google_event_id, google_recurring_event_id, status, summary,
        starts_at, ends_at, all_day, html_link, synced_at, created_at, updated_at
      ) VALUES (
        'evt-cloud-1', ${userId}, 'calendar-1', 'google-evt-1', 'series-1', 'confirmed', 'Cloud Computing',
        strftime('%s', '2026-04-10 15:00:00') * 1000,
        strftime('%s', '2026-04-10 16:00:00') * 1000,
        0,
        'https://calendar.google.com/event?eid=1',
        (unixepoch() * 1000), (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)

    const result = await service.confirmCapturedTask(userId, {
      rawInput: 'Submit the design review notes by Friday at 3pm.',
      matchedCalendarContext: {
        calendarEventId: 'evt-cloud-1',
        summary: 'Cloud Computing',
        reason: 'Matched recurring event: Cloud Computing',
      },
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

    const links = await db.query.planningItemCalendarLinks.findMany()
    expect(links).toHaveLength(1)
    expect(links[0]?.sourceType).toBe('task')
    expect(links[0]?.matchedSummary).toBe('Cloud Computing')
  })

  it('creates a habit through the existing habit service on confirmation', async () => {
    const service = createCaptureService(db, null)
    await seedSelectedCalendar(db)
    await db.run(sql`
      INSERT INTO calendar_events (
        id, user_id, calendar_id, google_event_id, google_recurring_event_id, status, summary,
        starts_at, ends_at, all_day, html_link, synced_at, created_at, updated_at
      ) VALUES (
        'evt-cloud-1', ${userId}, 'calendar-1', 'google-evt-1', 'series-1', 'confirmed', 'Cloud Computing',
        strftime('%s', '2026-04-10 15:00:00') * 1000,
        strftime('%s', '2026-04-10 16:00:00') * 1000,
        0,
        'https://calendar.google.com/event?eid=1',
        (unixepoch() * 1000), (unixepoch() * 1000), (unixepoch() * 1000)
      );
    `)

    const result = await service.confirmCapturedHabit(userId, {
      rawInput: 'Meditar cada lunes y jueves',
      matchedCalendarContext: {
        calendarEventId: 'evt-cloud-1',
        summary: 'Cloud Computing',
        reason: 'Matched recurring event: Cloud Computing',
      },
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

    const links = await db.query.planningItemCalendarLinks.findMany()
    expect(links).toHaveLength(1)
    expect(links[0]?.sourceType).toBe('habit')
  })
})
