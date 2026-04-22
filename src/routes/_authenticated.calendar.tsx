import { useEffect, useMemo, useRef, useState } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, RefreshCw, Settings2 } from 'lucide-react'
import { formatDisplayTime, useClientTimeZone } from '../lib/date-time'
import { getCalendarView, getCalendarEventsForDay, syncGoogleCalendar } from '../server/calendar'
import { getTodayDateString } from '../lib/tasks'

// Meta query — account, sync status, which days have events (no event payloads)
const calendarViewQueryOptions = () =>
  queryOptions({
    queryKey: ['calendar-view'],
    queryFn: () => getCalendarView(),
  })

// Per-day query — full event list for a single day, fetched on demand
const calendarDayQueryOptions = (dateStr: string) =>
  queryOptions({
    queryKey: ['calendar-day', dateStr],
    queryFn: () => getCalendarEventsForDay({ data: { dateStr } }),
    staleTime: 60_000, // re-use cached result for 60s before background refresh
  })

export const Route = createFileRoute('/_authenticated/calendar')({
  loader: ({ context }) => {
    return context.queryClient.ensureQueryData(calendarViewQueryOptions())
  },
  component: CalendarPage,
})

// Days rendered in the swipeable strip
const DAYS_BACK = 30
const DAYS_FORWARD = 90

function formatEventTimeRange(start: Date, end: Date, allDay: boolean, timeZone: string) {
  if (allDay) return 'All day'
  return `${formatDisplayTime(start, timeZone)} – ${formatDisplayTime(end, timeZone)}`
}

function formatRelativeSyncTime(syncedAt: Date, now: Date): string {
  const diffMins = Math.floor((now.getTime() - syncedAt.getTime()) / 60_000)
  if (diffMins < 1) return 'Just synced'
  if (diffMins < 60) return `Synced ${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `Synced ${diffHours}h ago`
  return `Synced ${Math.floor(diffHours / 24)}d ago`
}

type DayEvent = {
  id: string
  summary: string | null
  startsAt: Date | string
  endsAt: Date | string
  allDay: boolean
  calendarName: string
  location: string | null
  htmlLink: string | null
}

function EventCard({
  event,
  isInProgress,
  isNext,
  timeZone,
}: {
  event: DayEvent
  isInProgress: boolean
  isNext: boolean
  timeZone: string
}) {
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)

  return (
    <article className="subpanel rounded-2xl px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isInProgress || isNext ? (
            <div className="mb-1">
              {isInProgress ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
                  <span className="size-1.5 rounded-full bg-[var(--brand)]" />
                  In progress
                </span>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                  Next up
                </span>
              )}
            </div>
          ) : null}
          <p className="m-0 text-sm font-semibold leading-snug text-[var(--ink-strong)]">
            {event.summary || '(Untitled event)'}
          </p>
          <p className="m-0 mt-0.5 truncate text-xs leading-5 text-[var(--ink-soft)]">
            {formatEventTimeRange(start, end, event.allDay, timeZone)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
          {event.calendarName}
        </span>
      </div>
      {event.htmlLink ? (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-xs font-semibold text-[var(--brand)] no-underline transition hover:opacity-70"
        >
          Open in Google Calendar
        </a>
      ) : null}
    </article>
  )
}

function CalendarPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(calendarViewQueryOptions())
  const timeZone = useClientTimeZone()

  const [now, setNow] = useState(() => new Date())
  const [showPastToday, setShowPastToday] = useState(false)
  // Offset in days from today; 0 = today, negative = past, positive = future
  const [dayOffset, setDayOffset] = useState(0)

  const stripRef = useRef<HTMLDivElement>(null)
  const todayBtnRef = useRef<HTMLButtonElement>(null)
  const autoSyncAttemptedRef = useRef(false)

  useEffect(() => {
    // Correct stale SSR-rendered time immediately on mount, then tick every 60s
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Center today's chip in the strip on mount
  useEffect(() => {
    const btn = todayBtnRef.current
    const strip = stripRef.current
    if (!btn || !strip) return
    strip.scrollLeft = btn.offsetLeft - strip.clientWidth / 2 + btn.offsetWidth / 2
  }, [])

  const syncMutation = useMutation({
    mutationFn: async () => syncGoogleCalendar(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-day'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-settings'] }),
      ])
    },
  })

  useEffect(() => {
    if (autoSyncAttemptedRef.current) {
      return
    }

    if (data.account?.status !== 'connected' || data.selectedCalendars.length === 0) {
      return
    }

    const lastSyncedAt = data.syncStatus?.lastSyncedAt ? new Date(data.syncStatus.lastSyncedAt) : null
    const shouldAutoSync = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > 15 * 60_000

    if (!shouldAutoSync || syncMutation.isPending) {
      return
    }

    autoSyncAttemptedRef.current = true
    syncMutation.mutate()
  }, [data, syncMutation])

  const todayStr = getTodayDateString(now)

  // All days in the swipeable strip — recompute only when the calendar day changes
  const viewDays = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number)
    return Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => ({
      date: new Date(y, m - 1, d - DAYS_BACK + i),
      offset: i - DAYS_BACK,
    }))
  }, [todayStr])

  // Selected day string derived from offset
  const selectedDayStr = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number)
    return getTodayDateString(new Date(y, m - 1, d + dayOffset))
  }, [todayStr, dayOffset])

  // Per-day event query — fetches on demand, cached per dateStr
  const dayQuery = useQuery(calendarDayQueryOptions(selectedDayStr))

  const isToday = dayOffset === 0
  const daysWithEvents = useMemo(() => new Set(data.daysWithEvents), [data.daysWithEvents])

  // Bucket today's events into past/upcoming; all other days show events as-is
  const { selectedEvents, todayPastEvents } = useMemo(() => {
    const allEvents = dayQuery.data?.events ?? []
    if (!isToday) {
      return { selectedEvents: allEvents, todayPastEvents: [] }
    }
    const past: typeof allEvents = []
    const upcoming: typeof allEvents = []
    for (const event of allEvents) {
      new Date(event.endsAt) < now ? past.push(event) : upcoming.push(event)
    }
    return { selectedEvents: upcoming, todayPastEvents: past }
  }, [dayQuery.data, isToday, now])

  // "Next up" — first future event on today's tab only
  const nextEventId = useMemo(() => {
    if (!isToday) return null
    return selectedEvents.find((e) => new Date(e.startsAt) > now)?.id ?? null
  }, [selectedEvents, now, isToday])

  const liveTime = formatDisplayTime(now, timeZone)

  const syncLabel = !data.account
    ? null
    : data.account.status === 'disconnected'
      ? 'Disconnected'
      : data.syncStatus?.lastSyncedAt
        ? formatRelativeSyncTime(new Date(data.syncStatus.lastSyncedAt), now)
        : 'Never synced'

  return (
    <main className="page-wrap px-4 pb-24 pt-10">
      <article className="panel rounded-[1.75rem] px-5 py-4 sm:px-6 sm:py-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="display-title m-0 text-3xl font-bold text-[var(--ink-strong)]">Calendar</h1>
            <p className="m-0 mt-1 text-sm leading-5 text-[var(--ink-soft)]">
              {liveTime}
              {syncLabel ? <> · {syncLabel}</> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <button
              type="button"
              disabled={
                data.account?.status !== 'connected' ||
                data.selectedCalendars.length === 0 ||
                syncMutation.isPending
              }
              onClick={() => syncMutation.mutate()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncMutation.isPending ? 'animate-spin' : ''} />
              Sync
            </button>
            <a
              href="/settings"
              title="Manage calendars"
              className="flex size-8 items-center justify-center rounded-full text-[var(--ink-soft)] no-underline transition hover:bg-[var(--surface-inset)] hover:text-[var(--ink-strong)]"
            >
              <Settings2 size={16} />
            </a>
          </div>
        </div>

        {/* Swipeable day strip */}
        <div
          ref={stripRef}
          className="mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {viewDays.map(({ date, offset }) => {
            const dayStr = getTodayDateString(date)
            const isDayToday = offset === 0
            const isSelected = dayStr === selectedDayStr
            const hasEvents = daysWithEvents.has(dayStr)

            return (
              <button
                key={dayStr}
                ref={isDayToday ? todayBtnRef : undefined}
                type="button"
                onClick={() => setDayOffset(offset)}
                className={`flex min-w-[52px] flex-col items-center gap-0.5 rounded-2xl px-2 py-2.5 transition ${
                  isSelected
                    ? 'bg-[var(--brand)] text-white'
                    : 'text-[var(--ink-soft)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-strong)]'
                }`}
              >
                <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">
                  {isDayToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className="text-xl font-bold tabular-nums leading-none">{date.getDate()}</span>
                <span
                  className={`size-1.5 rounded-full transition ${
                    hasEvents
                      ? isSelected
                        ? 'bg-white/60'
                        : 'bg-[var(--brand)]'
                      : 'bg-transparent'
                  }`}
                />
              </button>
            )
          })}
        </div>

        {syncMutation.error instanceof Error ? (
          <p className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-400">
            {syncMutation.error.message}
          </p>
        ) : null}
        {data.syncStatus?.lastError ? (
          <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-300">
            {data.syncStatus.lastError}
          </p>
        ) : null}
      </article>

      {/* Events for selected day */}
      <section className={`mt-4 space-y-3 transition-opacity ${dayQuery.isFetching ? 'opacity-50' : 'opacity-100'}`}>
        {!data.account ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Connect Google Calendar in settings to see meetings here.
          </div>
        ) : data.selectedCalendars.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Select at least one calendar in settings.
          </div>
        ) : dayQuery.isLoading ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Loading…
          </div>
        ) : selectedEvents.length === 0 && !(isToday && todayPastEvents.length > 0) ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            {isToday ? 'No more meetings today.' : 'Nothing scheduled.'}
          </div>
        ) : (
          selectedEvents.map((event) => {
            const eventStart = new Date(event.startsAt)
            const eventEnd = new Date(event.endsAt)
            const isInProgress = isToday && eventStart <= now && now < eventEnd
            const isNextEvent = event.id === nextEventId

            return (
                <EventCard
                  key={event.id}
                  event={event}
                  isInProgress={isInProgress}
                  isNext={isNextEvent}
                  timeZone={timeZone}
                />
            )
          })
        )}

        {/* Earlier today — collapsible, Today tab only */}
        {isToday && todayPastEvents.length > 0 ? (
          <div className="border-t border-[var(--line)] pt-4">
            <button
              type="button"
              onClick={() => setShowPastToday((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
            >
              {showPastToday ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              Earlier today
              <span className="rounded-full bg-[var(--surface-inset)] px-1.5 py-0.5 text-[11px] tabular-nums">
                {todayPastEvents.length}
              </span>
            </button>
            {showPastToday ? (
              <div className="mt-3 space-y-3 opacity-60">
                {todayPastEvents.map((event) => (
                  <EventCard key={event.id} event={event} isInProgress={false} isNext={false} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
