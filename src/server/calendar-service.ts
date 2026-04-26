import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { SyncState } from '../db/schema'
import type { Database } from '../db/client'
import { calendarConnections, calendarEvents, googleAccounts, syncStates } from '../db/schema'
import type {
  GoogleCalendarEventInstance,
  GoogleIntegrationApi,
  GoogleTokenExchange,
} from './google-client'
import { GoogleApiError, googleIntegrationApi } from './google-client'
import { getGoogleConfigStatus } from './google-auth'
import {
  GOOGLE_CALENDAR_PROVIDER,
  type GoogleCalendarEventInput,
  getGoogleSyncWindow,
  type GoogleCalendarSelectionInput,
} from '../lib/google'

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

  function shouldDisconnectGoogleAccountOnRefreshFailure(error: unknown) {
    if (error instanceof GoogleApiError) {
      return error.status === 400 || error.status === 401
    }

    return error instanceof Error && /Google access has expired/i.test(error.message)
  }

  async function disconnectGoogleAccountRecord(accountId: string, now: Date) {
    await database
      .update(googleAccounts)
      .set({
        accessToken: null,
        refreshToken: null,
        tokenExpiryAt: null,
        disconnectedAt: now,
        updatedAt: now,
      })
      .where(eq(googleAccounts.id, accountId))
  }

  async function getRelevantAccount(
    userId: string,
    options?: {
      ensureFreshAccess?: boolean
      suppressRefreshErrors?: boolean
    },
  ) {
    let accounts = await listUserAccounts(userId)
    let account = selectRelevantAccount(accounts)

    if (!options?.ensureFreshAccess || !account || account.disconnectedAt) {
      return account
    }

    try {
      await getFreshAccessToken(account.id)
    } catch (error) {
      if (shouldDisconnectGoogleAccountOnRefreshFailure(error)) {
        await disconnectGoogleAccountRecord(account.id, new Date())
      } else if (!options.suppressRefreshErrors) {
        throw error
      }
    }

    accounts = await listUserAccounts(userId)
    account = selectRelevantAccount(accounts)
    return account
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

  function buildEnsureCalendarSelectionStatement(
    userId: string,
    googleAccountId: string,
    calendarId: string,
    now: Date,
  ) {
    return database
      .update(calendarConnections)
      .set({
        isSelected: true,
        updatedAt: now,
      })
      .where(and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.googleAccountId, googleAccountId),
        eq(calendarConnections.calendarId, calendarId),
      ))
  }

  async function resolveTargetCalendarId(userId: string, googleAccountId: string, calendarId: string) {
    if (calendarId !== 'primary') {
      return calendarId
    }

    let connections = await listConnectionsForAccount(userId, googleAccountId)
    let primaryConnection = connections.find((item) => item.primaryFlag) ?? null

    if (!primaryConnection) {
      connections = await refreshCalendarConnectionsForAccount(userId, googleAccountId, new Date())
      primaryConnection = connections.find((item) => item.primaryFlag) ?? null
    }

    return primaryConnection?.calendarId ?? calendarId
  }

  async function refreshCalendarConnectionsForAccount(userId: string, googleAccountId: string, now: Date) {
    const accessToken = await getFreshAccessToken(googleAccountId)
    const calendars = await googleApi.fetchCalendarList(accessToken)
    return upsertCalendarConnections(userId, googleAccountId, calendars, now)
  }

  async function requireWritableConnection(userId: string, googleAccountId: string, calendarId: string) {
    let connections = await listConnectionsForAccount(userId, googleAccountId)
    let connection = connections.find((item) => item.calendarId === calendarId) ?? null

    if (!connection) {
      connections = await refreshCalendarConnectionsForAccount(userId, googleAccountId, new Date())
      connection = connections.find((item) => item.calendarId === calendarId) ?? null
    }

    if (!connection) {
      throw new Error('Refresh Google calendars before writing to this calendar.')
    }

    if (!connection.canWrite) {
      throw new Error('This Google calendar is read-only. Choose a writable calendar to continue.')
    }

    return connection
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
    existingId?: string | null,
  ) {
    if (existingId) {
      await database
        .update(syncStates)
        .set({
          ...values,
          updatedAt: now,
        })
        .where(eq(syncStates.id, existingId))

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

  function buildCalendarEventSnapshotValues(
    userId: string,
    calendarId: string,
    event: GoogleCalendarEventInstance,
    now: Date,
  ) {
    return {
      id: crypto.randomUUID(),
      userId,
      calendarId,
      googleEventId: event.googleEventId,
      googleRecurringEventId: event.googleRecurringEventId,
      status: event.status,
      summary: event.summary,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt!,
      endsAt: event.endsAt!,
      allDay: event.allDay,
      eventTimezone: event.eventTimezone,
      htmlLink: event.htmlLink,
      organizerEmail: event.organizerEmail,
      attendeeCount: event.attendeeCount,
      syncedAt: now,
      updatedAtRemote: event.updatedAtRemote,
      createdAt: now,
      updatedAt: now,
    }
  }

  function buildFreshSyncStateValues(
    userId: string,
    calendarId: string,
    now: Date,
    existingState?: SyncState | null,
  ) {
    return {
      userId,
      provider: GOOGLE_CALENDAR_PROVIDER,
      scopeKey: calendarId,
      lastSyncedAt: now,
      nextSyncToken: existingState?.nextSyncToken ?? null,
      syncWindowStart: existingState?.syncWindowStart ?? null,
      syncWindowEnd: existingState?.syncWindowEnd ?? null,
      lastStatus: 'success',
      lastError: null,
      updatedAt: now,
    }
  }

  function buildFreshSyncStateStatement(
    userId: string,
    calendarId: string,
    now: Date,
    existingState?: SyncState | null,
  ) {
    const values = buildFreshSyncStateValues(userId, calendarId, now, existingState)

    if (existingState) {
      return database.update(syncStates).set(values).where(eq(syncStates.id, existingState.id))
    }

    return database.insert(syncStates).values({
      id: crypto.randomUUID(),
      createdAt: now,
      ...values,
    })
  }

  async function persistMutatedCalendarProjection(operations: Parameters<Database['batch']>[0]) {
    await database.batch(operations)
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
      events
        .filter((event) => event.status !== 'cancelled' && event.startsAt && event.endsAt)
        .map((event) => ({
          id: crypto.randomUUID(),
          userId,
          calendarId,
          googleEventId: event.googleEventId,
          googleRecurringEventId: event.googleRecurringEventId,
          status: event.status,
          summary: event.summary,
          description: event.description,
          location: event.location,
          startsAt: event.startsAt!,
          endsAt: event.endsAt!,
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

  async function deleteCalendarSnapshots(userId: string, calendarId: string) {
    await database
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.calendarId, calendarId)))
  }

  async function deleteCalendarEventSnapshot(
    userId: string,
    calendarId: string,
    googleEventId: string,
  ) {
    await database
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.calendarId, calendarId),
          eq(calendarEvents.googleEventId, googleEventId),
        ),
      )
  }

  function buildDeleteCalendarEventSnapshotStatement(userId: string, calendarId: string, googleEventId: string) {
    return database
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.calendarId, calendarId),
          eq(calendarEvents.googleEventId, googleEventId),
        ),
      )
  }

  function buildInsertCalendarEventSnapshotStatement(
    userId: string,
    calendarId: string,
    event: GoogleCalendarEventInstance,
    now: Date,
  ) {
    return database.insert(calendarEvents).values(buildCalendarEventSnapshotValues(userId, calendarId, event, now))
  }

  async function upsertCalendarEventSnapshot(
    userId: string,
    calendarId: string,
    event: GoogleCalendarEventInstance,
    now: Date,
  ) {
    await deleteCalendarEventSnapshot(userId, calendarId, event.googleEventId)

    if (event.status === 'cancelled' || !event.startsAt || !event.endsAt) {
      return
    }

    await database.insert(calendarEvents).values(buildCalendarEventSnapshotValues(userId, calendarId, event, now))
  }

  async function applyIncrementalCalendarChanges(
    userId: string,
    calendarId: string,
    events: Array<GoogleCalendarEventInstance>,
    now: Date,
  ) {
    for (const event of events) {
      await upsertCalendarEventSnapshot(userId, calendarId, event, now)
    }
  }

  function isExpiredSyncTokenError(error: unknown) {
    return error instanceof GoogleApiError && error.status === 410
  }

  async function runFullCalendarSync(
    userId: string,
    calendarId: string,
    accessToken: string,
    now: Date,
  ) {
    const planningWindow = getGoogleSyncWindow(now)
    const result = await googleApi.fetchCalendarEvents(accessToken, calendarId, {
      timeMin: planningWindow.start,
      timeMax: planningWindow.end,
    })

    await replaceCalendarEvents(userId, calendarId, result.events, now)
    await upsertSyncState(
      userId,
      calendarId,
      {
        lastSyncedAt: now,
        nextSyncToken: result.nextSyncToken,
        syncWindowStart: planningWindow.start,
        syncWindowEnd: planningWindow.end,
        lastStatus: 'success',
        lastError: null,
      },
      now,
    )

    return {
      eventCount: result.events.filter((event) => event.status !== 'cancelled').length,
      recoveredExpiredToken: false,
    }
  }

  async function runIncrementalCalendarSync(
    userId: string,
    calendarId: string,
    accessToken: string,
    existingState: SyncState,
    now: Date,
  ) {
    try {
      const result = await googleApi.fetchCalendarEvents(accessToken, calendarId, {
        syncToken: existingState.nextSyncToken ?? undefined,
      })

      await applyIncrementalCalendarChanges(userId, calendarId, result.events, now)
      await upsertSyncState(
        userId,
        calendarId,
        {
          lastSyncedAt: now,
          nextSyncToken: result.nextSyncToken ?? existingState.nextSyncToken,
          syncWindowStart: existingState.syncWindowStart,
          syncWindowEnd: existingState.syncWindowEnd,
          lastStatus: 'success',
          lastError: null,
        },
        now,
      )

      return {
        eventCount: result.events.filter((event) => event.status !== 'cancelled').length,
        recoveredExpiredToken: false,
      }
    } catch (error) {
      if (!isExpiredSyncTokenError(error)) {
        throw error
      }

      await deleteCalendarSnapshots(userId, calendarId)
      const result = await runFullCalendarSync(userId, calendarId, accessToken, now)

      return {
        ...result,
        recoveredExpiredToken: true,
      }
    }
  }

  async function syncCalendarConnection(
    userId: string,
    calendarId: string,
    accessToken: string,
    now: Date,
  ) {
    const existingState = await findSyncState(userId, calendarId)

    if (existingState?.nextSyncToken) {
      return runIncrementalCalendarSync(userId, calendarId, accessToken, existingState, now)
    }

    return runFullCalendarSync(userId, calendarId, accessToken, now)
  }

  async function getAccountAndConnections(
    userId: string,
    options?: {
      ensureFreshAccess?: boolean
      suppressRefreshErrors?: boolean
    },
  ) {
    const account = await getRelevantAccount(userId, options)
    const connections = account ? await listConnectionsForAccount(userId, account.id) : []

    return { account, connections }
  }

  async function getSettingsData(userId: string) {
    const config = getGoogleConfigStatus()
    const { account, connections } = await getAccountAndConnections(userId, {
      ensureFreshAccess: true,
      suppressRefreshErrors: true,
    })
    const states = await listSyncStates(userId)
    const syncSummary = getSyncSummary(states, { disconnected: !!account?.disconnectedAt })
    const [{ count: cachedEventCount }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))

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

  async function startGoogleConnect(userId: string) {
    return {
      url: googleApi.buildAuthUrl(userId),
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
            canWrite: calendar.canWrite,
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
        canWrite: calendar.canWrite,
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

  async function getCalendarViewData(userId: string, now = new Date()) {
    const { account, connections } = await getAccountAndConnections(userId, {
      ensureFreshAccess: true,
      suppressRefreshErrors: true,
    })
    const selectedConnections = connections.filter((connection) => connection.isSelected)
    const selectedCalendarIds = selectedConnections.map((connection) => connection.calendarId)
    const states = await listSyncStates(userId)
    const syncSummary = getSyncSummary(
      states.filter((state) => selectedCalendarIds.includes(state.scopeKey)),
      { disconnected: !!account?.disconnectedAt },
    )
    const planningWindow = getGoogleSyncWindow(now)

    // Lightweight: fetch only startsAt timestamps to derive which days have events.
    // The full event list is fetched per-day on demand via getCalendarEventsForDay.
    const viewStart = new Date(now)
    viewStart.setDate(viewStart.getDate() - 30)
    viewStart.setHours(0, 0, 0, 0)
    const viewEnd = new Date(now)
    viewEnd.setDate(viewEnd.getDate() + 90)
    viewEnd.setHours(23, 59, 59, 999)

    const eventStartRows = selectedCalendarIds.length
      ? await database
          .select({ startsAt: calendarEvents.startsAt })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.userId, userId),
              inArray(calendarEvents.calendarId, selectedCalendarIds),
              gte(calendarEvents.endsAt, viewStart),
              lte(calendarEvents.startsAt, viewEnd),
            ),
          )
      : []

    // Derive unique YYYY-MM-DD day strings (server local time, which is UTC for this app)
    const daysWithEventsSet = new Set<string>()
    for (const { startsAt } of eventStartRows) {
      const d = new Date(startsAt)
      daysWithEventsSet.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      )
    }

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
      daysWithEvents: [...daysWithEventsSet],
    }
  }

  async function getCalendarEventsForDay(userId: string, dateStr: string) {
    const { account, connections } = await getAccountAndConnections(userId, {
      ensureFreshAccess: true,
      suppressRefreshErrors: true,
    })
    const selectedConnections = connections.filter((connection) => connection.isSelected)
    const selectedCalendarIds = selectedConnections.map((connection) => connection.calendarId)

    if (!selectedCalendarIds.length) {
      return { events: [] as Array<{ id: string; summary: string | null; startsAt: Date; endsAt: Date; allDay: boolean; calendarName: string; location: string | null; htmlLink: string | null; primaryFlag: boolean }> }
    }

    const [y, m, d] = dateStr.split('-').map(Number)
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999)

    const events = await database.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, userId),
        inArray(calendarEvents.calendarId, selectedCalendarIds),
        gte(calendarEvents.endsAt, dayStart),
        lte(calendarEvents.startsAt, dayEnd),
      ),
      orderBy: [asc(calendarEvents.startsAt), asc(calendarEvents.endsAt)],
    })

    const connectionByCalendarId = new Map(
      selectedConnections.map((connection) => [connection.calendarId, connection]),
    )

    return {
      events: events.map((event) => {
        const connection = connectionByCalendarId.get(event.calendarId)
        return {
          id: event.id,
          summary: event.summary,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          location: event.location,
          htmlLink: event.htmlLink,
          calendarName: connection?.calendarName ?? event.calendarId,
          primaryFlag: connection?.primaryFlag ?? false,
        }
      }),
    }
  }

  async function syncSelectedCalendarEvents(userId: string, now = new Date()) {
    const { account } = await getAccountAndConnections(userId)

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before syncing events.')
    }

    const selectedConnections = await listSelectedConnections(userId, account.id)

    if (!selectedConnections.length) {
      throw new Error('Select at least one calendar before syncing events.')
    }

    const accessToken = await getFreshAccessToken(account.id)
    let eventCount = 0
    let recoveredExpiredToken = false

    for (const connection of selectedConnections) {
      try {
        const result = await syncCalendarConnection(userId, connection.calendarId, accessToken, now)
        eventCount += result.eventCount
        recoveredExpiredToken = recoveredExpiredToken || result.recoveredExpiredToken
      } catch (error) {
        const existingState = await findSyncState(userId, connection.calendarId)
        const planningWindow = getGoogleSyncWindow(now)

        await upsertSyncState(
          userId,
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
      recoveredExpiredToken,
    }
  }

  async function createCalendarEvent(
    userId: string,
    calendarId: string,
    event: GoogleCalendarEventInput,
    now = new Date(),
  ) {
    const { account } = await getAccountAndConnections(userId)

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before creating events.')
    }

    const resolvedCalendarId = await resolveTargetCalendarId(userId, account.id, calendarId)

    await requireWritableConnection(userId, account.id, resolvedCalendarId)

    const accessToken = await getFreshAccessToken(account.id)
    const createdEvent = await googleApi.createCalendarEvent(accessToken, resolvedCalendarId, event)
    const existingState = await findSyncState(userId, resolvedCalendarId)

    const operations: Parameters<Database['batch']>[0] = [
      buildEnsureCalendarSelectionStatement(userId, account.id, resolvedCalendarId, now),
      buildDeleteCalendarEventSnapshotStatement(userId, resolvedCalendarId, createdEvent.googleEventId),
    ]

    if (createdEvent.status !== 'cancelled' && createdEvent.startsAt && createdEvent.endsAt) {
      operations.push(buildInsertCalendarEventSnapshotStatement(userId, resolvedCalendarId, createdEvent, now))
    }

    operations.push(buildFreshSyncStateStatement(userId, resolvedCalendarId, now, existingState))

    await persistMutatedCalendarProjection(operations)

    return { ok: true as const, event: createdEvent }
  }

  async function updateCalendarEvent(
    userId: string,
    calendarId: string,
    googleEventId: string,
    event: GoogleCalendarEventInput,
    now = new Date(),
  ) {
    const { account } = await getAccountAndConnections(userId)

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before updating events.')
    }

    const resolvedCalendarId = await resolveTargetCalendarId(userId, account.id, calendarId)

    await requireWritableConnection(userId, account.id, resolvedCalendarId)

    const accessToken = await getFreshAccessToken(account.id)
    const updatedEvent = await googleApi.updateCalendarEvent(accessToken, resolvedCalendarId, googleEventId, event)
    const existingState = await findSyncState(userId, resolvedCalendarId)

    const operations: Parameters<Database['batch']>[0] = [
      buildDeleteCalendarEventSnapshotStatement(userId, resolvedCalendarId, updatedEvent.googleEventId),
    ]

    if (updatedEvent.status !== 'cancelled' && updatedEvent.startsAt && updatedEvent.endsAt) {
      operations.push(buildInsertCalendarEventSnapshotStatement(userId, resolvedCalendarId, updatedEvent, now))
    }

    operations.push(buildFreshSyncStateStatement(userId, resolvedCalendarId, now, existingState))

    await persistMutatedCalendarProjection(operations)

    return { ok: true as const, event: updatedEvent }
  }

  async function deleteCalendarEvent(
    userId: string,
    calendarId: string,
    googleEventId: string,
    now = new Date(),
  ) {
    const { account } = await getAccountAndConnections(userId)

    if (!account || account.disconnectedAt) {
      throw new Error('Reconnect Google Calendar before deleting events.')
    }

    const resolvedCalendarId = await resolveTargetCalendarId(userId, account.id, calendarId)

    await requireWritableConnection(userId, account.id, resolvedCalendarId)

    const accessToken = await getFreshAccessToken(account.id)
    await googleApi.deleteCalendarEvent(accessToken, resolvedCalendarId, googleEventId)
    const existingState = await findSyncState(userId, resolvedCalendarId)

    const operations: Parameters<Database['batch']>[0] = [
      buildDeleteCalendarEventSnapshotStatement(userId, resolvedCalendarId, googleEventId),
      buildFreshSyncStateStatement(userId, resolvedCalendarId, now, existingState),
    ]

    await persistMutatedCalendarProjection(operations)

    return { ok: true as const, deleted: true as const, deletedAt: now }
  }

  return {
    getSettingsData,
    getCalendarViewData,
    getCalendarEventsForDay,
    syncSelectedCalendarEvents,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    startGoogleConnect,
    async completeGoogleConnect(userId: string, code: string, state: string) {
      const payload = googleApi.verifyState(state)

      if (payload.userId !== userId) {
        throw new Error('Google OAuth state does not match the active user')
      }

      const tokens = await googleApi.exchangeCode(code)
      const userInfo = await googleApi.fetchUserInfo(tokens.accessToken)
      const now = new Date()
      const googleAccountId = await persistGoogleAccount(userId, userInfo, tokens, now)
      const calendars = await googleApi.fetchCalendarList(tokens.accessToken)
      const connections = await upsertCalendarConnections(userId, googleAccountId, calendars, now)
      const selectedConnections = connections.filter((calendar) => calendar.isSelected)
      let syncedEventCount = 0

      for (const connection of selectedConnections) {
        const result = await runFullCalendarSync(userId, connection.calendarId, tokens.accessToken, now)
        syncedEventCount += result.eventCount
      }

      return {
        ok: true as const,
        email: userInfo.email,
        selectedCalendarCount: connections.filter((calendar) => calendar.isSelected).length,
        syncedEventCount,
      }
    },
    async refreshCalendarConnections(userId: string) {
      const account = await getRelevantAccount(userId)

      if (!account || account.disconnectedAt) {
        throw new Error('Reconnect Google Calendar before refreshing calendars.')
      }

      const now = new Date()
      const connections = await refreshCalendarConnectionsForAccount(userId, account.id, now)

      return {
        ok: true as const,
        calendars: connections,
      }
    },
    async updateCalendarSelections(userId: string, input: GoogleCalendarSelectionInput) {
      const account = await getRelevantAccount(userId)

      if (!account) {
        throw new Error('Connect Google Calendar before choosing calendars.')
      }

      const selectedIds = new Set(input.calendarIds)
      const connections = await database.query.calendarConnections.findMany({
        where: and(
          eq(calendarConnections.userId, userId),
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
    async disconnectGoogleCalendar(userId: string) {
      const account = await getRelevantAccount(userId)

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
