import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
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
}

function makeGoogleApi(controls: GoogleApiControls): GoogleIntegrationApi {
  return {
    buildAuthUrl(userId) {
      return `https://accounts.example.test/connect?user=${userId}`
    },
    verifyState() {
      return {
        userId: 'local-user',
        nonce: 'nonce',
        exp: Date.now() + 60_000,
      }
    },
    async exchangeCode() {
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
        tokenExpiryAt: new Date(Date.now() + 60 * 60_000),
      }
    },
    async refreshAccessToken() {
      return {
        accessToken: 'refreshed-access-token',
        refreshToken: 'refresh-token',
        scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
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
          },
          {
            calendarId: 'team',
            calendarName: 'Team',
            primaryFlag: false,
            visible: true,
          },
          {
            calendarId: 'hidden',
            calendarName: 'Hidden',
            primaryFlag: false,
            visible: false,
          },
        ]
      }

      return [
        {
          calendarId: 'primary',
          calendarName: 'Primary',
          primaryFlag: true,
          visible: true,
        },
        {
          calendarId: 'team',
          calendarName: 'Team',
          primaryFlag: false,
          visible: true,
        },
        {
          calendarId: 'new-visible',
          calendarName: 'Side Projects',
          primaryFlag: false,
          visible: true,
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
  }
}

describe('calendar service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createCalendarService>
  let controls: GoogleApiControls

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    controls = {
      calendarListVersion: 1,
      eventVersion: 1,
      expireSyncTokenOnNextRequest: false,
    }
    service = createCalendarService(db, makeGoogleApi(controls))
  })

  it('starts the connect flow for the default user', async () => {
    const result = await service.startGoogleConnect()

    expect(result.url).toContain('https://accounts.example.test/connect')
    expect(result.url).toContain('local-user')
  })

  it('persists the google account and selects visible calendars by default', async () => {
    const result = await service.completeGoogleConnect('code', 'state')

    expect(result.ok).toBe(true)
    expect(result.email).toBe('person@example.com')
    expect(result.selectedCalendarCount).toBe(2)
    expect(result.syncedEventCount).toBe(2)

    const settings = await service.getSettingsData()
    const connectedDay = await service.getCalendarEventsForDay('2026-04-07')

    expect(settings.account?.status).toBe('connected')
    expect(settings.calendars).toHaveLength(3)
    expect(settings.syncStatus?.lastStatus).toBe('success')
    expect(connectedDay.events.map((event) => event.summary)).toEqual(['Primary kickoff'])
    expect(settings.calendars.map((item) => [item.calendarId, item.isSelected])).toEqual([
      ['primary', true],
      ['team', true],
      ['hidden', false],
    ])
  })

  it('preserves saved selections and auto-selects newly discovered visible calendars', async () => {
    await service.completeGoogleConnect('code', 'state')

    await service.updateCalendarSelections({
      calendarIds: ['primary'],
    })

    const refreshed = await service.refreshCalendarConnections()

    expect(refreshed.ok).toBe(true)
    expect(refreshed.calendars.map((item) => [item.calendarId, item.isSelected])).toEqual([
      ['primary', true],
      ['new-visible', true],
      ['hidden', false],
      ['team', false],
    ])
  })

  it('disconnects google while keeping cached calendar selection records', async () => {
    await service.completeGoogleConnect('code', 'state')

    await service.disconnectGoogleCalendar()

    const settings = await service.getSettingsData()

    expect(settings.account?.status).toBe('disconnected')
    expect(settings.calendars.map((item) => item.calendarId)).toEqual(['primary', 'team', 'hidden'])

    const account = await db.query.googleAccounts.findFirst()
    expect(account?.accessToken).toBeNull()
    expect(account?.refreshToken).toBeNull()
    expect(account?.disconnectedAt).toBeInstanceOf(Date)
  })

  it('syncs selected calendars into local read-only event snapshots', async () => {
    await service.completeGoogleConnect('code', 'state')

    const result = await service.syncSelectedCalendarEvents(new Date('2026-04-07T09:00:00.000Z'))

    expect(result.ok).toBe(true)
    expect(result.calendarCount).toBe(2)
    expect(result.eventCount).toBe(0)

    const page = await service.getCalendarViewData(new Date('2026-04-07T09:00:00.000Z'))
    const primaryDay = await service.getCalendarEventsForDay('2026-04-07')
    const offsiteDay = await service.getCalendarEventsForDay('2026-04-08')

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
    await service.completeGoogleConnect('code', 'state')

    controls.eventVersion = 2
    const result = await service.syncSelectedCalendarEvents(new Date('2026-04-09T09:00:00.000Z'))

    const updatedDay = await service.getCalendarEventsForDay('2026-04-09')
    const removedDay = await service.getCalendarEventsForDay('2026-04-08')

    expect(result.eventCount).toBe(1)
    expect(result.recoveredExpiredToken).toBe(false)
    expect(updatedDay.events.map((event) => event.summary)).toEqual(['Updated planning review'])
    expect(removedDay.events).toHaveLength(0)
  })

  it('recovers from an expired sync token by clearing state and running a full resync', async () => {
    await service.completeGoogleConnect('code', 'state')

    controls.eventVersion = 2
    controls.expireSyncTokenOnNextRequest = true

    const result = await service.syncSelectedCalendarEvents(new Date('2026-04-09T09:00:00.000Z'))
    const updatedDay = await service.getCalendarEventsForDay('2026-04-09')
    const removedDay = await service.getCalendarEventsForDay('2026-04-08')

    expect(result.ok).toBe(true)
    expect(result.recoveredExpiredToken).toBe(true)
    expect(updatedDay.events.map((event) => event.summary)).toEqual(['Updated planning review'])
    expect(removedDay.events).toHaveLength(0)
  })
})
