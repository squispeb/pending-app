import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { CalendarConnection, SyncState } from '../db/schema'
import type { Database } from '../db/client'
import { calendarConnections, calendarEvents, googleAccounts, syncStates } from '../db/schema'
import type {
  GoogleCalendarEventInstance,
  GoogleIntegrationApi,
  GoogleTokenExchange,
} from './google-client'
import { googleIntegrationApi } from './google-client'
import { getGoogleConfigStatus } from './google-auth'
import {
  GOOGLE_CALENDAR_PROVIDER,
  getGoogleSyncWindow,
  type GoogleCalendarSelectionInput,
} from '../lib/google'
import { ensureDefaultUser } from './default-user'

function sortCalendarConnections<T extends { primaryFlag: boolean; isSelected: boolean; calendarName: string }>(
  connections: Array<T>,
) {
  return [...connections].sort((left, right) => {
    if (left.primaryFlag !== right.primaryFlag) {
      return left.primaryFlag ? -1 : 1
    }

    if (left.isSelected !== right.isSelected) {
      return left.isSelected ? -1 : 1
    }

    return left.calendarName.localeCompare(right.calendarName)
  })
}

export function createCalendarService(
  database: Database,
  googleApi: GoogleIntegrationApi = googleIntegrationApi,
) {
  async function listSyncStates(userId: string) {
    return database.query.syncStates.findMany({
      where: and(eq(syncStates.userId, userId), eq(syncStates.provider, GOOGLE_CALENDAR_PROVIDER)),
      orderBy: [desc(syncStates.updatedAt)],
    })
  }

  async function findSyncState(userId: string, scopeKey: string) {
    return database.query.syncStates.findFirst({
      where: and(
        eq(syncStates.userId, userId),
        eq(syncStates.provider, GOOGLE_CALENDAR_PROVIDER),
        eq(syncStates.scopeKey, scopeKey),
      ),
    })
  }

  async function listUserAccounts(userId: string) {
    return database.query.googleAccounts.findMany({
      where: eq(googleAccounts.userId, userId),
      orderBy: [desc(googleAccounts.updatedAt)],
    })
  }

  function selectRelevantAccount<T extends { disconnectedAt: Date | null }>(accounts: Array<T>) {
    return accounts.find((account) => !account.disconnectedAt) ?? accounts[0] ?? null
  }

  async function getRelevantAccount(userId: string) {
    const accounts = await listUserAccounts(userId)
    return selectRelevantAccount(accounts)
  }

  async function listConnectionsForAccount(userId: string, googleAccountId: string) {
    const connections = await database.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.googleAccountId, googleAccountId),
      ),
    })

    return sortCalendarConnections(connections)
  }

  async function listSelectedConnections(userId: string, googleAccountId: string) {
    const connections = await listConnectionsForAccount(userId, googleAccountId)
    return connections.filter((connection) => connection.isSelected)
  }

  function getSyncSummary(states: Array<SyncState>, options?: { disconnected: boolean }) {
    if (!states.length && !options?.disconnected) {
      return null
    }

    const lastSyncedAt = states.reduce<Date | null>((latest, state) => {
      if (!state.lastSyncedAt) {
        return latest
      }

      if (!latest || state.lastSyncedAt.getTime() > latest.getTime()) {
        return state.lastSyncedAt
      }

      return latest
    }, null)

    const latestState = states[0] ?? null
    const latestErrorState = states.find((state) => state.lastStatus === 'error' && state.lastError) ?? null

    return {
      lastSyncedAt,
      lastStatus: latestState?.lastStatus ?? null,
      lastError: latestErrorState?.lastError ?? latestState?.lastError ?? null,
      disconnected: !!options?.disconnected,
      isStale: !!options?.disconnected || !lastSyncedAt || latestState?.lastStatus === 'error',
    }
  }

  async function upsertSyncState(
    userId: string,
    scopeKey: string,
    values: {
      lastSyncedAt: Date | null
      nextSyncToken: string | null
      syncWindowStart: Date | null
      syncWindowEnd: Date | null
      lastStatus: string | null
      lastError: string | null
    },
    now: Date,
  ) {
    const existing = await findSyncState(userId, scopeKey)

    if (existing) {
      await database
        .update(syncStates)
        .set({
          ...values,
          updatedAt: now,
        })
        .where(eq(syncStates.id, existing.id))

      return
    }

    await database.insert(syncStates).values({
      id: crypto.randomUUID(),
      userId,
      provider: GOOGLE_CALENDAR_PROVIDER,
      scopeKey,
      ...values,
      createdAt: now,
      updatedAt: now,
    })
  }

  async function replaceCalendarEvents(
    userId: string,
    calendarId: string,
    events: Array<GoogleCalendarEventInstance>,
    now: Date,
  ) {
    await database
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.calendarId, calendarId)))

    if (!events.length) {
      return
    }

    await database.insert(calendarEvents).values(
      events.map((event) => ({
        id: crypto.randomUUID(),
        userId,
        calendarId,
        googleEventId: event.googleEventId,
        googleRecurringEventId: event.googleRecurringEventId,
        status: event.status,
        summary: event.summary,
        description: event.description,
        location: event.location,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        eventTimezone: event.eventTimezone,
        htmlLink: event.htmlLink,
        organizerEmail: event.organizerEmail,
        attendeeCount: event.attendeeCount,
        syncedAt: now,
        updatedAtRemote: event.updatedAtRemote,
        createdAt: now,
        updatedAt: now,
      })),
    )
  }

  async function getAccountAndConnections(userId: string) {
    const account = await getRelevantAccount(userId)
    const connections = account ? await listConnectionsForAccount(userId, account.id) : []

    return { account, connections }
  }

  async function getSettingsData() {
    const user = await ensureDefaultUser(database)
    const config = getGoogleConfigStatus()
    const { account, connections } = await getAccountAndConnections(user.id)
    const states = await listSyncStates(user.id)
    const syncSummary = getSyncSummary(states, { disconnected: !!account?.disconnectedAt })
    const [{ count: cachedEventCount }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, user.id))

    return {
      configuration: config,
      account: account
        ? {
            id: account.id,
            email: account.email,
            connectedAt: account.connectedAt,
            disconnectedAt: account.disconnectedAt,
            status: account.disconnectedAt ? ('disconnected' as const) : ('connected' as const),
          }
        : null,
      calendars: connections,
      cachedEventCount,
      syncStatus: syncSummary,
    }
  }

  async function startGoogleConnect() {
    const user = await ensureDefaultUser(database)

    return {
      url: googleApi.buildAuthUrl(user.id),
    }
  }

  async function disconnectOtherAccounts(userId: string, exceptId: string, now: Date) {
    const accounts = await listUserAccounts(userId)
    const otherActiveIds = accounts.filter((account) => account.id !== exceptId).map((account) => account.id)

    if (!otherActiveIds.length) {
      return
    }

    await database
      .update(googleAccounts)
      .set({
        accessToken: null,
        refreshToken: null,
        tokenExpiryAt: null,
        disconnectedAt: now,
        updatedAt: now,
      })
      .where(and(eq(googleAccounts.userId, userId), inArray(googleAccounts.id, otherActiveIds)))
  }

  async function persistGoogleAccount(
    userId: string,
    userInfo: { subject: string; email: string },
    tokens: GoogleTokenExchange,
    now: Date,
  ) {
    const accounts = await listUserAccounts(userId)
    const existing = accounts.find((account) => account.googleSubject === userInfo.subject) ?? null
    const refreshToken = tokens.refreshToken || existing?.refreshToken || null

    if (existing) {
      await database
        .update(googleAccounts)
        .set({
          email: userInfo.email,
          accessToken: tokens.accessToken,
          refreshToken,
          tokenExpiryAt: tokens.tokenExpiryAt,
          scope: tokens.scope ?? existing.scope,
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        })
        .where(eq(googleAccounts.id, existing.id))

      await disconnectOtherAccounts(userId, existing.id, now)
      return existing.id
    }

    const id = crypto.randomUUID()
    await database.insert(googleAccounts).values({
      id,
      userId,
      googleSubject: userInfo.subject,
      email: userInfo.email,
      accessToken: tokens.accessToken,
      refreshToken,
      tokenExpiryAt: tokens.tokenExpiryAt,
      scope: tokens.scope,
      connectedAt: now,
      disconnectedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    await disconnectOtherAccounts(userId, id, now)
    return id
  }

  async function upsertCalendarConnections(
    userId: string,
    googleAccountId: string,
    calendars: Awaited<ReturnType<GoogleIntegrationApi['fetchCalendarList']>>,
    now: Date,
  ) {
    const existing = await database.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.googleAccountId, googleAccountId),
      ),
    })
    const existingByCalendarId = new Map(existing.map((connection) => [connection.calendarId, connection]))

    for (const calendar of calendars) {
      const current = existingByCalendarId.get(calendar.calendarId)
      const isSelected = current ? current.isSelected : calendar.visible

      if (current) {
        await database
          .update(calendarConnections)
          .set({
            calendarName: calendar.calendarName,
            primaryFlag: calendar.primaryFlag,
            isSelected,
            updatedAt: now,
          })
          .where(eq(calendarConnections.id, current.id))

        continue
      }

      await database.insert(calendarConnections).values({
        id: crypto.randomUUID(),
        userId,
        googleAccountId,
        calendarId: calendar.calendarId,
        calendarName: calendar.calendarName,
        primaryFlag: calendar.primaryFlag,
        isSelected,
        createdAt: now,
        updatedAt: now,
      })
    }

    return listConnectionsForAccount(userId, googleAccountId)
  }

  async function getFreshAccessToken(accountId: string) {
    const account = await database.query.googleAccounts.findFirst({
      where: eq(googleAccounts.id, accountId),
    })

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before refreshing calendars.')
    }

    const expiresSoon =
      account.tokenExpiryAt && account.tokenExpiryAt.getTime() <= Date.now() + 60_000

    if (account.accessToken && !expiresSoon) {
      return account.accessToken
    }

    if (!account.refreshToken) {
      throw new Error('Google access has expired. Reconnect Google Calendar to continue.')
    }

    const refreshed = await googleApi.refreshAccessToken(account.refreshToken)
    const nextRefreshToken = refreshed.refreshToken || account.refreshToken

    await database
      .update(googleAccounts)
      .set({
        accessToken: refreshed.accessToken,
        refreshToken: nextRefreshToken,
        tokenExpiryAt: refreshed.tokenExpiryAt,
        scope: refreshed.scope ?? account.scope,
        disconnectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(googleAccounts.id, account.id))

    return refreshed.accessToken
  }

  async function getCalendarViewData(now = new Date()) {
    const user = await ensureDefaultUser(database)
    const { account, connections } = await getAccountAndConnections(user.id)
    const selectedConnections = connections.filter((connection) => connection.isSelected)
    const selectedCalendarIds = selectedConnections.map((connection) => connection.calendarId)
    const states = await listSyncStates(user.id)
    const syncSummary = getSyncSummary(
      states.filter((state) => selectedCalendarIds.includes(state.scopeKey)),
      { disconnected: !!account?.disconnectedAt },
    )
    const planningWindow = getGoogleSyncWindow(now)

    // Compact view window: today through +6 days (7 tabs).
    // Overlap filter: event ends on/after start-of-today AND starts on/before end-of-window.
    const viewStart = new Date(now)
    viewStart.setHours(0, 0, 0, 0)
    const viewEnd = new Date(now)
    viewEnd.setDate(viewEnd.getDate() + 6)
    viewEnd.setHours(23, 59, 59, 999)

    const events = selectedCalendarIds.length
      ? await database.query.calendarEvents.findMany({
          where: and(
            eq(calendarEvents.userId, user.id),
            inArray(calendarEvents.calendarId, selectedCalendarIds),
            gte(calendarEvents.endsAt, viewStart),
            lte(calendarEvents.startsAt, viewEnd),
          ),
          orderBy: [asc(calendarEvents.startsAt), asc(calendarEvents.endsAt)],
        })
      : []

    const connectionByCalendarId = new Map(
      selectedConnections.map((connection) => [connection.calendarId, connection]),
    )

    return {
      account: account
        ? {
            id: account.id,
            email: account.email,
            connectedAt: account.connectedAt,
            disconnectedAt: account.disconnectedAt,
            status: account.disconnectedAt ? ('disconnected' as const) : ('connected' as const),
          }
        : null,
      selectedCalendars: selectedConnections,
      syncStatus: syncSummary,
      planningWindow,
      events: events.map((event) => {
        const connection = connectionByCalendarId.get(event.calendarId)

        return {
          ...event,
          calendarName: connection?.calendarName ?? event.calendarId,
          primaryFlag: connection?.primaryFlag ?? false,
        }
      }),
    }
  }

  async function syncSelectedCalendarEvents(now = new Date()) {
    const user = await ensureDefaultUser(database)
    const { account } = await getAccountAndConnections(user.id)

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before syncing events.')
    }

    const selectedConnections = await listSelectedConnections(user.id, account.id)

    if (!selectedConnections.length) {
      throw new Error('Select at least one calendar before syncing events.')
    }

    const accessToken = await getFreshAccessToken(account.id)
    const planningWindow = getGoogleSyncWindow(now)
    let eventCount = 0

    for (const connection of selectedConnections) {
      try {
        const events = await googleApi.fetchCalendarEvents(accessToken, connection.calendarId, {
          timeMin: planningWindow.start,
          timeMax: planningWindow.end,
        })

        await replaceCalendarEvents(user.id, connection.calendarId, events, now)
        await upsertSyncState(
          user.id,
          connection.calendarId,
          {
            lastSyncedAt: now,
            nextSyncToken: null,
            syncWindowStart: planningWindow.start,
            syncWindowEnd: planningWindow.end,
            lastStatus: 'success',
            lastError: null,
          },
          now,
        )

        eventCount += events.length
      } catch (error) {
        const existingState = await findSyncState(user.id, connection.calendarId)

        await upsertSyncState(
          user.id,
          connection.calendarId,
          {
            lastSyncedAt: existingState?.lastSyncedAt ?? null,
            nextSyncToken: null,
            syncWindowStart: planningWindow.start,
            syncWindowEnd: planningWindow.end,
            lastStatus: 'error',
            lastError: error instanceof Error ? error.message : 'Calendar sync failed unexpectedly.',
          },
          now,
        )

        throw error
      }
    }

    return {
      ok: true as const,
      syncedAt: now,
      calendarCount: selectedConnections.length,
      eventCount,
    }
  }

  return {
    ensureDefaultUser: () => ensureDefaultUser(database),
    getSettingsData,
    getCalendarViewData,
    syncSelectedCalendarEvents,
    startGoogleConnect,
    async completeGoogleConnect(code: string, state: string) {
      const payload = googleApi.verifyState(state)
      const user = await ensureDefaultUser(database)

      if (payload.userId !== user.id) {
        throw new Error('Google OAuth state does not match the active user')
      }

      const tokens = await googleApi.exchangeCode(code)
      const userInfo = await googleApi.fetchUserInfo(tokens.accessToken)
      const now = new Date()
      const googleAccountId = await persistGoogleAccount(user.id, userInfo, tokens, now)
      const calendars = await googleApi.fetchCalendarList(tokens.accessToken)
      const connections = await upsertCalendarConnections(user.id, googleAccountId, calendars, now)

      return {
        ok: true as const,
        email: userInfo.email,
        selectedCalendarCount: connections.filter((calendar) => calendar.isSelected).length,
      }
    },
    async refreshCalendarConnections() {
      const user = await ensureDefaultUser(database)
      const account = await getRelevantAccount(user.id)

      if (!account || account.disconnectedAt) {
        throw new Error('Reconnect Google Calendar before refreshing calendars.')
      }

      const accessToken = await getFreshAccessToken(account.id)
      const calendars = await googleApi.fetchCalendarList(accessToken)
      const now = new Date()
      const connections = await upsertCalendarConnections(user.id, account.id, calendars, now)

      return {
        ok: true as const,
        calendars: connections,
      }
    },
    async updateCalendarSelections(input: GoogleCalendarSelectionInput) {
      const user = await ensureDefaultUser(database)
      const account = await getRelevantAccount(user.id)

      if (!account) {
        throw new Error('Connect Google Calendar before choosing calendars.')
      }

      const selectedIds = new Set(input.calendarIds)
      const connections = await database.query.calendarConnections.findMany({
        where: and(
          eq(calendarConnections.userId, user.id),
          eq(calendarConnections.googleAccountId, account.id),
        ),
      })

      await Promise.all(
        connections.map((connection) =>
          database
            .update(calendarConnections)
            .set({
              isSelected: selectedIds.has(connection.calendarId),
              updatedAt: new Date(),
            })
            .where(eq(calendarConnections.id, connection.id)),
        ),
      )

      return {
        ok: true as const,
        selectedCount: connections.filter((connection) => selectedIds.has(connection.calendarId)).length,
      }
    },
    async disconnectGoogleCalendar() {
      const user = await ensureDefaultUser(database)
      const account = await getRelevantAccount(user.id)

      if (!account) {
        return { ok: true as const }
      }

      await database
        .update(googleAccounts)
        .set({
          accessToken: null,
          refreshToken: null,
          tokenExpiryAt: null,
          disconnectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(googleAccounts.id, account.id))

      return { ok: true as const }
    },
  }
}
