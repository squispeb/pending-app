import { useEffect, useMemo, useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, RefreshCw, Settings2 } from 'lucide-react'
import { getCalendarView, syncGoogleCalendar } from '../server/calendar'
import { getTodayDateString } from '../lib/tasks'

const calendarViewQueryOptions = () =>
  queryOptions({
    queryKey: ['calendar-view'],
    queryFn: () => getCalendarView(),
  })

export const Route = createFileRoute('/calendar')({
  loader: ({ context }) => context.queryClient.ensureQueryData(calendarViewQueryOptions()),
  component: CalendarPage,
})

function formatEventDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function formatEventTimeRange(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    return 'All day'
  }

  return `${start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function getDayLabel(eventStart: Date, now: Date): string {
  const todayStr = getTodayDateString(now)
  const eventDayStr = getTodayDateString(eventStart)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrowStr = getTodayDateString(tomorrow)

  if (eventDayStr === todayStr) return 'Today'
  if (eventDayStr === tomorrowStr) return 'Tomorrow'
  return formatEventDate(eventStart)
}

type CalendarEvent = {
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
}: {
  event: CalendarEvent
  isInProgress: boolean
  isNext: boolean
}) {
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)

  return (
    <article className="subpanel rounded-2xl px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {isInProgress || isNext ? (
            <div className="mb-1.5">
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

          <p className="m-0 text-base font-semibold text-[var(--ink-strong)]">
            {event.summary || '(Untitled event)'}
          </p>
          <p className="m-0 mt-1 text-sm leading-6 text-[var(--ink-soft)]">
            {formatEventTimeRange(start, end, event.allDay)}
          </p>
        </div>

        <span className="shrink-0 rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
          {event.calendarName}
        </span>
      </div>

      {event.location ? (
        <p className="m-0 mt-3 text-sm leading-6 text-[var(--ink-soft)]">{event.location}</p>
      ) : null}

      {event.htmlLink ? (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex text-sm font-semibold text-[var(--brand)] no-underline transition hover:opacity-70"
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

  const [now, setNow] = useState(() => new Date())
  const [showPastToday, setShowPastToday] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const syncMutation = useMutation({
    mutationFn: async () => syncGoogleCalendar(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-settings'] }),
      ])
    },
  })

  const todayStr = getTodayDateString(now)

  const { todayPastEvents, upcomingGroups } = useMemo(() => {
    const todayPast: Array<(typeof data.events)[number]> = []
    const groups = new Map<string, Array<(typeof data.events)[number]>>()

    for (const event of data.events) {
      const eventStart = new Date(event.startsAt)
      const eventEnd = new Date(event.endsAt)
      const eventDayStr = getTodayDateString(eventStart)

      // Skip events from previous days entirely
      if (eventDayStr < todayStr) continue

      // Today's already-finished events → collapsible past section
      if (eventDayStr === todayStr && eventEnd < now) {
        todayPast.push(event)
        continue
      }

      const label = getDayLabel(eventStart, now)
      const bucket = groups.get(label) ?? []
      bucket.push(event)
      groups.set(label, bucket)
    }

    return {
      todayPastEvents: todayPast,
      upcomingGroups: Array.from(groups.entries()),
    }
  }, [data.events, now, todayStr])

  // First event that hasn't started yet (for "Next up" label)
  const nextEventId = useMemo(() => {
    for (const [, events] of upcomingGroups) {
      for (const event of events) {
        if (new Date(event.startsAt) > now) {
          return event.id
        }
      }
    }
    return null
  }, [upcomingGroups, now])

  function renderStatusCopy() {
    if (!data.account) {
      return 'Connect Google Calendar in Settings to bring your meetings here.'
    }
    if (data.account.status === 'disconnected') {
      return 'Google Calendar is disconnected. Cached meetings stay visible until you reconnect.'
    }
    if (data.syncStatus?.lastSyncedAt) {
      return `Connected as ${data.account.email}. Last synced ${new Date(data.syncStatus.lastSyncedAt).toLocaleString()}.`
    }
    return `Connected as ${data.account.email}. Run a sync to import your upcoming meetings.`
  }

  const liveDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const liveTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <article className="panel rounded-[1.75rem] p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="display-title m-0 text-3xl font-bold text-[var(--ink-strong)]">Calendar</h1>
          <span className="text-base text-[var(--ink-soft)]">
            {liveDate} · {liveTime}
          </span>
        </div>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">{renderStatusCopy()}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={
              data.account?.status !== 'connected' ||
              data.selectedCalendars.length === 0 ||
              syncMutation.isPending
            }
            onClick={() => syncMutation.mutate()}
            className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={16} className={syncMutation.isPending ? 'animate-spin' : ''} />
              Sync now
            </span>
          </button>

          <a
            href="/settings"
            className="secondary-pill inline-flex cursor-pointer items-center gap-2 border-0 text-sm font-semibold no-underline"
          >
            <Settings2 size={16} />
            Manage calendars
          </a>
        </div>

        {syncMutation.error instanceof Error ? (
          <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-400">
            {syncMutation.error.message}
          </p>
        ) : null}

        {data.syncStatus?.lastError ? (
          <p className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-300">
            {data.syncStatus.lastError}
          </p>
        ) : null}
      </article>

      <section className="panel mt-4 rounded-[1.75rem] p-6 sm:p-8">
        <h2 className="m-0 text-2xl font-semibold text-[var(--ink-strong)]">Upcoming meetings</h2>

        {!data.account ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Connect Google Calendar in settings to start building a local meeting snapshot.
          </div>
        ) : data.selectedCalendars.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Select at least one calendar in settings before syncing events here.
          </div>
        ) : upcomingGroups.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            {todayPastEvents.length > 0 ? 'No more meetings today.' : 'No upcoming meetings. You\'re clear.'}
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            {upcomingGroups.map(([dayLabel, events]) => (
              <section key={dayLabel}>
                <h3 className="m-0 text-base font-semibold text-[var(--ink-strong)]">{dayLabel}</h3>
                <div className="mt-3 grid gap-3">
                  {events.map((event) => {
                    const eventStart = new Date(event.startsAt)
                    const eventEnd = new Date(event.endsAt)
                    const isInProgress = eventStart <= now && now < eventEnd
                    const isNext = event.id === nextEventId

                    return (
                      <EventCard
                        key={event.id}
                        event={event}
                        isInProgress={isInProgress}
                        isNext={isNext}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Earlier today — collapsible */}
        {todayPastEvents.length > 0 ? (
          <div className="mt-6 border-t border-[var(--line)] pt-5">
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
              <div className="mt-3 grid gap-3 opacity-60">
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
