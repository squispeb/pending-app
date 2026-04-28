import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createVoiceCalendarResolver } from './voice-calendar-resolver'

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
    CREATE TABLE google_accounts (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      google_subject text NOT NULL,
      email text NOT NULL,
      access_token text,
      refresh_token text,
      token_expiry_at integer,
      scope text,
      connected_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      disconnected_at integer,
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
      can_write integer DEFAULT false NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
      FOREIGN KEY (google_account_id) REFERENCES google_accounts(id) ON DELETE cascade
    );
  `)
}

describe('voice calendar resolver', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  const userId = 'user-1'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)

    await db.insert(schema.users).values({
      id: userId,
      email: 'user-1@example.com',
      timezone: 'UTC',
    })

    await db.insert(schema.googleAccounts).values({
      id: 'google-1',
      userId,
      googleSubject: 'subject-1',
      email: 'user-1@example.com',
      connectedAt: new Date('2026-04-25T00:00:00.000Z'),
      updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    })

    await db.insert(schema.calendarConnections).values([
      {
        id: 'conn-primary',
        userId,
        googleAccountId: 'google-1',
        calendarId: 'primary',
        calendarName: 'Primary',
        primaryFlag: true,
        isSelected: true,
        canWrite: true,
      },
      {
        id: 'conn-side-projects',
        userId,
        googleAccountId: 'google-1',
        calendarId: 'side-projects',
        calendarName: 'Side Projects',
        primaryFlag: false,
        isSelected: false,
        canWrite: true,
      },
      {
        id: 'conn-finance',
        userId,
        googleAccountId: 'google-1',
        calendarId: 'finance',
        calendarName: 'Finance',
        primaryFlag: false,
        isSelected: false,
        canWrite: false,
      },
      {
        id: 'conn-team-1',
        userId,
        googleAccountId: 'google-1',
        calendarId: 'team-a',
        calendarName: 'Team',
        primaryFlag: false,
        isSelected: true,
        canWrite: true,
      },
      {
        id: 'conn-team-2',
        userId,
        googleAccountId: 'google-1',
        calendarId: 'team-b',
        calendarName: 'Team',
        primaryFlag: false,
        isSelected: false,
        canWrite: true,
      },
    ])
  })

  it('defaults to primary when no explicit alternate calendar is named', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarTarget({
      userId,
      transcript: 'Schedule a planning review tomorrow on my calendar',
    })

    expect(result).toEqual({
      kind: 'resolved_primary',
      writableCalendars: [
        { calendarId: 'primary', calendarName: 'Primary', primaryFlag: true },
        { calendarId: 'side-projects', calendarName: 'Side Projects', primaryFlag: false },
        { calendarId: 'team-a', calendarName: 'Team', primaryFlag: false },
        { calendarId: 'team-b', calendarName: 'Team', primaryFlag: false },
      ],
    })
  })

  it('resolves an explicitly named writable alternate calendar', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarTarget({
      userId,
      transcript: 'Schedule a planning review tomorrow on the Side Projects calendar',
    })

    expect(result).toEqual({
      kind: 'resolved_alternate',
      target: {
        calendarId: 'side-projects',
        calendarName: 'Side Projects',
        primaryFlag: false,
        isSelected: false,
      },
      writableCalendars: [
        { calendarId: 'primary', calendarName: 'Primary', primaryFlag: true },
        { calendarId: 'side-projects', calendarName: 'Side Projects', primaryFlag: false },
        { calendarId: 'team-a', calendarName: 'Team', primaryFlag: false },
        { calendarId: 'team-b', calendarName: 'Team', primaryFlag: false },
      ],
    })
  })

  it('rejects explicit read-only calendars', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarTarget({
      userId,
      transcript: 'Schedule a planning review tomorrow on the Finance calendar',
    })

    expect(result).toEqual({
      kind: 'read_only',
      attemptedName: 'Finance',
      calendar: {
        calendarId: 'finance',
        calendarName: 'Finance',
        primaryFlag: false,
      },
      writableCalendars: [
        { calendarId: 'primary', calendarName: 'Primary', primaryFlag: true },
        { calendarId: 'side-projects', calendarName: 'Side Projects', primaryFlag: false },
        { calendarId: 'team-a', calendarName: 'Team', primaryFlag: false },
        { calendarId: 'team-b', calendarName: 'Team', primaryFlag: false },
      ],
    })
  })

  it('clarifies when an explicitly named calendar is unavailable', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarTarget({
      userId,
      transcript: 'Schedule a planning review tomorrow on the Marketing calendar',
    })

    expect(result).toEqual({
      kind: 'unavailable',
      attemptedName: 'marketing',
      writableCalendars: [
        { calendarId: 'primary', calendarName: 'Primary', primaryFlag: true },
        { calendarId: 'side-projects', calendarName: 'Side Projects', primaryFlag: false },
        { calendarId: 'team-a', calendarName: 'Team', primaryFlag: false },
        { calendarId: 'team-b', calendarName: 'Team', primaryFlag: false },
      ],
    })
  })

  it('clarifies when multiple calendars share the same explicit name', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarTarget({
      userId,
      transcript: 'Schedule a planning review tomorrow on the Team calendar',
    })

    expect(result).toEqual({
      kind: 'ambiguous',
      attemptedName: 'team',
      candidates: [
        {
          calendarId: 'team-a',
          calendarName: 'Team',
          primaryFlag: false,
          isSelected: true,
        },
        {
          calendarId: 'team-b',
          calendarName: 'Team',
          primaryFlag: false,
          isSelected: false,
        },
      ],
      writableCalendars: [
        { calendarId: 'primary', calendarName: 'Primary', primaryFlag: true },
        { calendarId: 'side-projects', calendarName: 'Side Projects', primaryFlag: false },
        { calendarId: 'team-a', calendarName: 'Team', primaryFlag: false },
        { calendarId: 'team-b', calendarName: 'Team', primaryFlag: false },
      ],
    })
  })

  it('resolves a visible calendar event target when the transcript names one event clearly', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarEventTarget({
      transcript: 'Edit the team sync meeting on Side Projects',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-team-sync',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
        },
        {
          calendarEventId: 'evt-retro',
          summary: 'Retro',
          startsAt: '2026-04-08T16:00:00.000Z',
          endsAt: '2026-04-08T16:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
        },
      ],
    })

    expect(result).toEqual({
      kind: 'resolved',
      target: {
        calendarEventId: 'evt-team-sync',
        summary: 'Team sync',
        startsAt: '2026-04-08T15:00:00.000Z',
        endsAt: '2026-04-08T15:30:00.000Z',
        allDay: false,
        calendarName: 'Side Projects',
        primaryFlag: false,
        source: 'visible_window',
      },
    })
  })

  it('returns ambiguity when multiple visible calendar events match equally well', async () => {
    const resolver = createVoiceCalendarResolver(db)

    const result = await resolver.resolveCalendarEventTarget({
      transcript: 'Cancel the team sync',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-team-sync-a',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
        },
        {
          calendarEventId: 'evt-team-sync-b',
          summary: 'Team sync',
          startsAt: '2026-04-08T17:00:00.000Z',
          endsAt: '2026-04-08T17:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
        },
      ],
    })

    expect(result).toEqual({
      kind: 'ambiguous',
      candidates: [
        {
          calendarEventId: 'evt-team-sync-a',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
          source: 'visible_window',
        },
        {
          calendarEventId: 'evt-team-sync-b',
          summary: 'Team sync',
          startsAt: '2026-04-08T17:00:00.000Z',
          endsAt: '2026-04-08T17:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
          source: 'visible_window',
        },
      ],
    })
  })
})
