import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { and, eq, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createCalendarService } from './calendar-service'
import { GoogleApiError, type GoogleIntegrationApi } from './google-client'

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
}

type GoogleApiControls = {
  calendarListVersion: number
  eventVersion: number
  expireSyncTokenOnNextRequest: boolean
  createdEventSummary: string
  updatedEventSummary: string
  deletedEventIds: Array<string>
}

function makeConfirmedEvent(summary: string, startsAt: string, endsAt: string, googleEventId: string) {
  return {
    googleEventId,
    googleRecurringEventId: null,
    status: 'confirmed',
    summary,
    description: null,
    location: 'Room A',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    allDay: false,
    eventTimezone: 'UTC',
    htmlLink: `https://calendar.google.com/event?eid=${googleEventId}`,
    organizerEmail: 'owner@example.com',
    attendeeCount: 1,
    updatedAtRemote: new Date('2026-04-06T10:00:00.000Z'),
  }
}

async function findSyncState(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
  scopeKey: string,
) {
  return db.query.syncStates.findFirst({
    where: and(eq(schema.syncStates.userId, userId), eq(schema.syncStates.scopeKey, scopeKey)),
  })
}

function makeGoogleApi(controls: GoogleApiControls, userId: string): GoogleIntegrationApi {
  return {
    buildAuthUrl(userId) {
      return `https://accounts.example.test/connect?user=${userId}`
    },
    verifyState() {
      return {
        userId,
        nonce: 'nonce',
        exp: Date.now() + 60_000,
      }
    },
    async exchangeCode() {
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        scope:
          'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        tokenExpiryAt: new Date(Date.now() + 60 * 60_000),
      }
    },
    async refreshAccessToken() {
      return {
        accessToken: 'refreshed-access-token',
        refreshToken: 'refresh-token',
        scope:
          'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        tokenExpiryAt: new Date(Date.now() + 60 * 60_000),
      }
    },
    async fetchUserInfo() {
      return {
        subject: 'google-subject-1',
        email: 'person@example.com',
      }
    },
    async fetchCalendarList() {
      if (controls.calendarListVersion === 1) {
        controls.calendarListVersion = 2
        return [
          {
            calendarId: 'primary',
            calendarName: 'Primary',
            primaryFlag: true,
            visible: true,
            canWrite: true,
          },
          {
            calendarId: 'team',
            calendarName: 'Team',
            primaryFlag: false,
            visible: true,
            canWrite: true,
          },
          {
            calendarId: 'hidden',
            calendarName: 'Hidden',
            primaryFlag: false,
            visible: false,
            canWrite: false,
          },
        ]
      }

      return [
        {
          calendarId: 'primary',
          calendarName: 'Primary',
          primaryFlag: true,
          visible: true,
          canWrite: true,
        },
        {
          calendarId: 'team',
          calendarName: 'Team',
          primaryFlag: false,
          visible: true,
          canWrite: false,
        },
        {
          calendarId: 'new-visible',
          calendarName: 'Side Projects',
          primaryFlag: false,
          visible: true,
          canWrite: true,
        },
      ]
    },
    async fetchCalendarEvents(_accessToken, calendarId, options) {
      if (options.syncToken) {
        if (controls.expireSyncTokenOnNextRequest) {
          controls.expireSyncTokenOnNextRequest = false
          throw new GoogleApiError('Google request failed (410): Sync token expired.', 410)
        }

        if (controls.eventVersion === 2) {
          if (calendarId === 'primary') {
            return {
              events: [
                {
                  googleEventId: 'primary-meeting-1',
                  googleRecurringEventId: null,
                  status: 'confirmed',
                  summary: 'Updated planning review',
                  description: null,
                  location: 'Room B',
                  startsAt: new Date('2026-04-09T15:00:00.000Z'),
                  endsAt: new Date('2026-04-09T15:30:00.000Z'),
                  allDay: false,
                  eventTimezone: 'UTC',
                  htmlLink: null,
                  organizerEmail: 'owner@example.com',
                  attendeeCount: 3,
                  updatedAtRemote: new Date('2026-04-08T08:00:00.000Z'),
                },
              ],
              nextSyncToken: 'primary-sync-v2',
            }
          }

          return {
            events: [
              {
                googleEventId: 'team-offsite',
                googleRecurringEventId: null,
                status: 'cancelled',
                summary: null,
                description: null,
                location: null,
                startsAt: null,
                endsAt: null,
                allDay: false,
                eventTimezone: null,
                htmlLink: null,
                organizerEmail: null,
                attendeeCount: null,
                updatedAtRemote: new Date('2026-04-08T08:05:00.000Z'),
              },
            ],
            nextSyncToken: 'team-sync-v2',
          }
        }

        return {
          events: [],
          nextSyncToken: calendarId === 'primary' ? 'primary-sync-v1' : 'team-sync-v1',
        }
      }

      if (controls.eventVersion === 1) {
        if (calendarId === 'primary') {
          return {
            events: [
              {
                googleEventId: 'primary-meeting-1',
                googleRecurringEventId: null,
                status: 'confirmed',
                summary: 'Primary kickoff',
                description: null,
                location: 'Room A',
                startsAt: new Date('2026-04-07T16:00:00.000Z'),
                endsAt: new Date('2026-04-07T17:00:00.000Z'),
                allDay: false,
                eventTimezone: 'UTC',
                htmlLink: 'https://calendar.google.com/event?eid=primary-meeting-1',
                organizerEmail: 'owner@example.com',
                attendeeCount: 2,
                updatedAtRemote: new Date('2026-04-06T10:00:00.000Z'),
              },
            ],
            nextSyncToken: 'primary-sync-v1',
          }
        }

        return {
          events: [
            {
              googleEventId: 'team-offsite',
              googleRecurringEventId: null,
              status: 'confirmed',
              summary: 'Team offsite',
              description: null,
              location: null,
              startsAt: new Date('2026-04-08T12:00:00.000Z'),
              endsAt: new Date('2026-04-09T12:00:00.000Z'),
              allDay: true,
              eventTimezone: 'UTC',
              htmlLink: null,
              organizerEmail: 'team@example.com',
              attendeeCount: 6,
              updatedAtRemote: new Date('2026-04-06T12:00:00.000Z'),
            },
          ],
          nextSyncToken: 'team-sync-v1',
        }
      }

      if (calendarId === 'primary') {
        return {
          events: [
            {
              googleEventId: 'primary-meeting-1',
              googleRecurringEventId: null,
              status: 'confirmed',
              summary: 'Updated planning review',
              description: null,
              location: 'Room B',
              startsAt: new Date('2026-04-09T15:00:00.000Z'),
              endsAt: new Date('2026-04-09T15:30:00.000Z'),
              allDay: false,
              eventTimezone: 'UTC',
              htmlLink: null,
              organizerEmail: 'owner@example.com',
              attendeeCount: 3,
              updatedAtRemote: new Date('2026-04-08T08:00:00.000Z'),
            },
          ],
          nextSyncToken: 'primary-sync-v2',
        }
      }

      return {
        events: [],
        nextSyncToken: 'team-sync-v2',
      }
    },
    async createCalendarEvent(_accessToken, calendarId, event) {
      controls.createdEventSummary = event.summary ?? ''
      return {
        googleEventId: `created-${calendarId}`,
        googleRecurringEventId: null,
        status: 'confirmed',
        summary: event.summary ?? null,
        description: event.description ?? null,
        location: event.location ?? null,
        startsAt: event.start.dateTime ? new Date(event.start.dateTime) : new Date(`${event.start.date}T12:00:00.000Z`),
        endsAt: event.end.dateTime ? new Date(event.end.dateTime) : new Date(`${event.end.date}T13:00:00.000Z`),
        allDay: !!event.start.date,
        eventTimezone: event.start.timeZone ?? event.end.timeZone ?? 'UTC',
        htmlLink: null,
        organizerEmail: 'owner@example.com',
        attendeeCount: event.attendees?.length ?? null,
        updatedAtRemote: new Date('2026-04-10T10:00:00.000Z'),
      }
    },
    async updateCalendarEvent(_accessToken, calendarId, googleEventId, event) {
      controls.updatedEventSummary = event.summary ?? ''
      return {
        googleEventId,
        googleRecurringEventId: null,
        status: 'confirmed',
        summary: event.summary ?? null,
        description: event.description ?? null,
        location: event.location ?? null,
        startsAt: event.start.dateTime ? new Date(event.start.dateTime) : new Date(`${event.start.date}T12:00:00.000Z`),
        endsAt: event.end.dateTime ? new Date(event.end.dateTime) : new Date(`${event.end.date}T13:00:00.000Z`),
        allDay: !!event.start.date,
        eventTimezone: event.start.timeZone ?? event.end.timeZone ?? 'UTC',
        htmlLink: `https://calendar.google.com/event?eid=${googleEventId}`,
        organizerEmail: 'owner@example.com',
        attendeeCount: event.attendees?.length ?? null,
        updatedAtRemote: new Date('2026-04-10T11:00:00.000Z'),
      }
    },
    async deleteCalendarEvent(_accessToken, _calendarId, googleEventId) {
      controls.deletedEventIds.push(googleEventId)
    },
  }
}

describe('calendar service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createCalendarService>
  let controls: GoogleApiControls
  const userId = 'user-1'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    await db.insert(schema.users).values({
      id: userId,
      email: 'user-1@example.com',
      displayName: 'User One',
      timezone: 'UTC',
    })
    controls = {
      calendarListVersion: 1,
      eventVersion: 1,
      expireSyncTokenOnNextRequest: false,
      createdEventSummary: '',
      updatedEventSummary: '',
      deletedEventIds: [],
    }
    service = createCalendarService(db, makeGoogleApi(controls, userId))
  })

  it('starts the connect flow for the authenticated user', async () => {
    const result = await service.startGoogleConnect(userId)

    expect(result.url).toContain('https://accounts.example.test/connect')
    expect(result.url).toContain(userId)
  })

  it('persists the google account and selects visible calendars by default', async () => {
    const result = await service.completeGoogleConnect(userId, 'code', 'state')

    expect(result.ok).toBe(true)
    expect(result.email).toBe('person@example.com')
    expect(result.selectedCalendarCount).toBe(2)
    expect(result.syncedEventCount).toBe(2)

    const settings = await service.getSettingsData(userId)
    const connectedDay = await service.getCalendarEventsForDay(userId, '2026-04-07')

    expect(settings.account?.status).toBe('connected')
    expect(settings.calendars).toHaveLength(3)
    expect(settings.syncStatus?.lastStatus).toBe('success')
    expect(connectedDay.events.map((event) => event.summary)).toEqual(['Primary kickoff'])
    expect(settings.calendars.map((item) => [item.calendarId, item.isSelected])).toEqual([
      ['primary', true],
      ['team', true],
      ['hidden', false],
    ])
    expect(settings.calendars.map((item) => [item.calendarId, item.canWrite])).toEqual([
      ['primary', true],
      ['team', true],
      ['hidden', false],
    ])
  })

  it('refreshes Google access in the background when loading calendar settings', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await db
      .update(schema.googleAccounts)
      .set({
        accessToken: null,
        tokenExpiryAt: new Date(Date.now() - 60_000),
      })
      .where(sql`${schema.googleAccounts.userId} = ${userId}`)

    const settings = await service.getSettingsData(userId)
    const [account] = await db.select().from(schema.googleAccounts).where(sql`${schema.googleAccounts.userId} = ${userId}`)

    expect(settings.account?.status).toBe('connected')
    expect(account?.accessToken).toBe('refreshed-access-token')
    expect(account?.disconnectedAt).toBeNull()
  })

  it('refreshes Google access in the background when loading calendar view data', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await db
      .update(schema.googleAccounts)
      .set({
        accessToken: null,
        tokenExpiryAt: new Date(Date.now() - 60_000),
      })
      .where(sql`${schema.googleAccounts.userId} = ${userId}`)

    const view = await service.getCalendarViewData(userId, new Date('2026-04-09T09:00:00.000Z'))
    const [account] = await db.select().from(schema.googleAccounts).where(sql`${schema.googleAccounts.userId} = ${userId}`)

    expect(view.account?.status).toBe('connected')
    expect(account?.accessToken).toBe('refreshed-access-token')
  })

  it('refreshes Google access in the background when loading events for a day', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await db
      .update(schema.googleAccounts)
      .set({
        accessToken: null,
        tokenExpiryAt: new Date(Date.now() - 60_000),
      })
      .where(sql`${schema.googleAccounts.userId} = ${userId}`)

    const day = await service.getCalendarEventsForDay(userId, '2026-04-07')
    const [account] = await db.select().from(schema.googleAccounts).where(sql`${schema.googleAccounts.userId} = ${userId}`)

    expect(day.events.map((event) => event.summary)).toEqual(['Primary kickoff'])
    expect(account?.accessToken).toBe('refreshed-access-token')
  })

  it('preserves saved selections and auto-selects newly discovered visible calendars', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.updateCalendarSelections(userId, {
      calendarIds: ['primary'],
    })

    const refreshed = await service.refreshCalendarConnections(userId)

    expect(refreshed.ok).toBe(true)
    expect(refreshed.calendars.map((item) => [item.calendarId, item.isSelected])).toEqual([
      ['primary', true],
      ['new-visible', true],
      ['hidden', false],
      ['team', false],
    ])
    expect(refreshed.calendars.map((item) => [item.calendarId, item.canWrite])).toEqual([
      ['primary', true],
      ['new-visible', true],
      ['hidden', false],
      ['team', false],
    ])
  })

  it('disconnects google while keeping cached calendar selection records', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.disconnectGoogleCalendar(userId)

    const settings = await service.getSettingsData(userId)

    expect(settings.account?.status).toBe('disconnected')
    expect(settings.calendars.map((item) => item.calendarId)).toEqual(['primary', 'team', 'hidden'])

    const account = await db.query.googleAccounts.findFirst()
    expect(account?.accessToken).toBeNull()
    expect(account?.refreshToken).toBeNull()
    expect(account?.disconnectedAt).toBeInstanceOf(Date)
  })

  it('syncs selected calendars into local read-only event snapshots', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    const result = await service.syncSelectedCalendarEvents(userId, new Date('2026-04-07T09:00:00.000Z'))

    expect(result.ok).toBe(true)
    expect(result.calendarCount).toBe(2)
    expect(result.eventCount).toBe(0)

    const page = await service.getCalendarViewData(userId, new Date('2026-04-07T09:00:00.000Z'))
    const primaryDay = await service.getCalendarEventsForDay(userId, '2026-04-07')
    const offsiteDay = await service.getCalendarEventsForDay(userId, '2026-04-08')

    expect(page.daysWithEvents).toEqual(['2026-04-07', '2026-04-08'])
    expect(primaryDay.events.map((event) => [event.calendarName, event.summary])).toEqual([
      ['Primary', 'Primary kickoff'],
    ])
    expect(offsiteDay.events.map((event) => [event.calendarName, event.summary])).toEqual([
      ['Team', 'Team offsite'],
    ])
    expect(page.syncStatus?.lastStatus).toBe('success')
    expect(page.syncStatus?.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('applies incremental sync updates and removes cancelled events', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    controls.eventVersion = 2
    const result = await service.syncSelectedCalendarEvents(userId, new Date('2026-04-09T09:00:00.000Z'))

    const updatedDay = await service.getCalendarEventsForDay(userId, '2026-04-09')
    const removedDay = await service.getCalendarEventsForDay(userId, '2026-04-08')

    expect(result.eventCount).toBe(1)
    expect(result.recoveredExpiredToken).toBe(false)
    expect(updatedDay.events.map((event) => event.summary)).toEqual(['Updated planning review'])
    expect(removedDay.events).toHaveLength(0)
  })

  it('recovers from an expired sync token by clearing state and running a full resync', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    controls.eventVersion = 2
    controls.expireSyncTokenOnNextRequest = true

    const result = await service.syncSelectedCalendarEvents(userId, new Date('2026-04-09T09:00:00.000Z'))
    const updatedDay = await service.getCalendarEventsForDay(userId, '2026-04-09')
    const removedDay = await service.getCalendarEventsForDay(userId, '2026-04-08')

    expect(result.ok).toBe(true)
    expect(result.recoveredExpiredToken).toBe(true)
    expect(updatedDay.events.map((event) => event.summary)).toEqual(['Updated planning review'])
    expect(removedDay.events).toHaveLength(0)
  })

  it('writes created events into the local snapshot immediately', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    const result = await service.createCalendarEvent(userId, 'primary', {
      summary: 'Writable boundary test',
      description: 'Created via Google API',
      location: 'Room C',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    const day = await service.getCalendarEventsForDay(userId, '2026-04-10')

    expect(result.ok).toBe(true)
    expect(controls.createdEventSummary).toBe('Writable boundary test')
    expect(day.events.map((event) => event.summary)).toEqual(['Writable boundary test'])
  })

  it('resolves the primary alias to the actual primary calendar id before writing', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    const result = await service.createCalendarEvent(userId, 'primary', {
      summary: 'Primary alias write test',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    const day = await service.getCalendarEventsForDay(userId, '2026-04-10')

    expect(result.ok).toBe(true)
    expect(day.events.map((event) => [event.calendarName, event.summary])).toEqual([
      ['Primary', 'Primary alias write test'],
    ])
  })

  it('selects an explicitly targeted writable calendar before snapshotting the created event', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.updateCalendarSelections(userId, {
      calendarIds: ['primary'],
    })

    const before = await service.getCalendarViewData(userId, new Date('2026-04-10T09:00:00.000Z'))
    expect(before.selectedCalendars.map((calendar) => calendar.calendarId)).toEqual(['primary'])

    await service.createCalendarEvent(userId, 'team', {
      summary: 'Alternate writable visibility test',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    const after = await service.getCalendarViewData(userId, new Date('2026-04-10T09:00:00.000Z'))
    const day = await service.getCalendarEventsForDay(userId, '2026-04-10')

    expect(after.selectedCalendars.map((calendar) => calendar.calendarId)).toEqual(['primary', 'team'])
    expect(day.events.map((event) => [event.calendarName, event.summary])).toEqual([
      ['Team', 'Alternate writable visibility test'],
    ])
  })

  it('rejects writes to known read-only calendars', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await expect(
      service.createCalendarEvent(userId, 'hidden', {
        summary: 'Read only test',
        start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
      }),
    ).rejects.toThrow('This Google calendar is read-only. Choose a writable calendar to continue.')

    expect(controls.createdEventSummary).toBe('')
  })

  it('refreshes calendar connections in the background before writing to a newly discovered writable calendar', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    const result = await service.createCalendarEvent(userId, 'new-visible', {
      summary: 'Background refresh write test',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    const settings = await service.getSettingsData(userId)
    const day = await service.getCalendarEventsForDay(userId, '2026-04-10')

    expect(result.ok).toBe(true)
    expect(controls.createdEventSummary).toBe('Background refresh write test')
    expect(settings.calendars.map((calendar) => calendar.calendarId)).toContain('new-visible')
    expect(day.events.map((event) => [event.calendarName, event.summary])).toEqual([
      ['Side Projects', 'Background refresh write test'],
    ])
  })

  it('updates and deletes writable events in local snapshots immediately', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.createCalendarEvent(userId, 'primary', {
      summary: 'Original writable event',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    await service.updateCalendarEvent(userId, 'primary', 'created-primary', {
      summary: 'Updated writable event',
      start: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T16:00:00.000Z', timeZone: 'UTC' },
    })

    const updatedDay = await service.getCalendarEventsForDay(userId, '2026-04-10')
    expect(controls.updatedEventSummary).toBe('Updated writable event')
    expect(updatedDay.events.map((event) => event.summary)).toEqual(['Updated writable event'])

    await service.deleteCalendarEvent(userId, 'primary', 'created-primary')

    const deletedDay = await service.getCalendarEventsForDay(userId, '2026-04-10')
    expect(controls.deletedEventIds).toEqual(['created-primary'])
    expect(deletedDay.events).toHaveLength(0)
  })

  it('marks the touched calendar sync state fresh after a confirmed create', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    const staleAt = new Date('2026-04-01T08:00:00.000Z')
    const mutationNow = new Date('2026-04-10T09:00:00.000Z')

    await db
      .update(schema.syncStates)
      .set({
        lastSyncedAt: staleAt,
        lastStatus: 'success',
        lastError: null,
        updatedAt: staleAt,
      })
      .where(eq(schema.syncStates.userId, userId))

    await service.createCalendarEvent(
      userId,
      'primary',
      {
        summary: 'Fresh sync marker test',
        start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
      },
      mutationNow,
    )

    const primaryState = await findSyncState(db, userId, 'primary')
    const view = await service.getCalendarViewData(userId, mutationNow)

    expect(primaryState?.lastSyncedAt?.toISOString()).toBe(mutationNow.toISOString())
    expect(primaryState?.lastStatus).toBe('success')
    expect(primaryState?.lastError).toBeNull()
    expect(view.syncStatus?.lastSyncedAt?.toISOString()).toBe(mutationNow.toISOString())
    expect(view.syncStatus?.isStale).toBe(false)
  })

  it('refreshes the touched calendar sync state after update and delete', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.createCalendarEvent(userId, 'primary', {
      summary: 'Writable event for sync refresh',
      start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
    })

    const staleAt = new Date('2026-04-01T08:00:00.000Z')
    const updateNow = new Date('2026-04-10T16:00:00.000Z')

    await db
      .update(schema.syncStates)
      .set({
        lastSyncedAt: staleAt,
        lastStatus: 'error',
        lastError: 'stale before update',
        updatedAt: staleAt,
      })
      .where(eq(schema.syncStates.scopeKey, 'primary'))

    await service.updateCalendarEvent(
      userId,
      'primary',
      'created-primary',
      {
        summary: 'Updated sync freshness event',
        start: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-04-10T16:00:00.000Z', timeZone: 'UTC' },
      },
      updateNow,
    )

    let primaryState = await findSyncState(db, userId, 'primary')
    expect(primaryState?.lastSyncedAt?.toISOString()).toBe(updateNow.toISOString())
    expect(primaryState?.lastStatus).toBe('success')
    expect(primaryState?.lastError).toBeNull()

    const deleteNow = new Date('2026-04-10T17:00:00.000Z')

    await db
      .update(schema.syncStates)
      .set({
        lastSyncedAt: staleAt,
        lastStatus: 'error',
        lastError: 'stale before delete',
        updatedAt: staleAt,
      })
      .where(eq(schema.syncStates.scopeKey, 'primary'))

    await service.deleteCalendarEvent(userId, 'primary', 'created-primary', deleteNow)

    primaryState = await findSyncState(db, userId, 'primary')
    const deletedDay = await service.getCalendarEventsForDay(userId, '2026-04-10')

    expect(primaryState?.lastSyncedAt?.toISOString()).toBe(deleteNow.toISOString())
    expect(primaryState?.lastStatus).toBe('success')
    expect(primaryState?.lastError).toBeNull()
    expect(deletedDay.events).toHaveLength(0)
  })

  it('rolls back local projection writes when snapshot persistence fails', async () => {
    await service.completeGoogleConnect(userId, 'code', 'state')

    await service.updateCalendarSelections(userId, {
      calendarIds: ['primary'],
    })

    await db.run(sql`
      CREATE TRIGGER fail_calendar_event_insert
      BEFORE INSERT ON calendar_events
      BEGIN
        SELECT RAISE(ABORT, 'snapshot insert failed');
      END;
    `)

    await expect(
      service.createCalendarEvent(userId, 'team', {
        summary: 'Rollback test',
        start: { dateTime: '2026-04-10T14:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-04-10T15:00:00.000Z', timeZone: 'UTC' },
      }),
    ).rejects.toThrow('snapshot insert failed')

    const view = await service.getCalendarViewData(userId, new Date('2026-04-10T09:00:00.000Z'))
    const day = await service.getCalendarEventsForDay(userId, '2026-04-10')
    const teamState = await findSyncState(db, userId, 'team')

    expect(controls.createdEventSummary).toBe('Rollback test')
    expect(view.selectedCalendars.map((calendar) => calendar.calendarId)).toEqual(['primary'])
    expect(day.events).toHaveLength(0)
    expect(teamState?.lastSyncedAt).not.toEqual(new Date('2026-04-10T14:00:00.000Z'))
  })
})
