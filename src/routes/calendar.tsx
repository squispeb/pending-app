import { useMemo } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw, Settings2 } from 'lucide-react'
import { getCalendarView, syncGoogleCalendar } from '../server/calendar'

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
  })} - ${end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function CalendarPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(calendarViewQueryOptions())

  const syncMutation = useMutation({
    mutationFn: async () => syncGoogleCalendar(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-settings'] }),
      ])
    },
  })

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, Array<(typeof data.events)[number]>>()

    for (const event of data.events) {
      const key = formatEventDate(new Date(event.startsAt))
      const bucket = groups.get(key)

      if (bucket) {
        bucket.push(event)
      } else {
        groups.set(key, [event])
      }
    }

    return Array.from(groups.entries())
  }, [data.events])

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

  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <article className="panel rounded-[1.75rem] p-6 sm:p-8">
        <h1 className="display-title mb-4 text-3xl font-bold text-[var(--ink-strong)]">Calendar</h1>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
          {renderStatusCopy()}
        </p>

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
        ) : groupedEvents.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            No cached events yet for the selected planning window. Run a manual sync to import meetings.
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            {groupedEvents.map(([dayLabel, events]) => (
              <section key={dayLabel}>
                <h3 className="m-0 text-base font-semibold text-[var(--ink-strong)]">{dayLabel}</h3>
                <div className="mt-3 grid gap-3">
                  {events.map((event) => (
                    <article key={event.id} className="subpanel rounded-2xl px-4 py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="m-0 text-base font-semibold text-[var(--ink-strong)]">
                            {event.summary || '(Untitled event)'}
                          </p>
                          <p className="m-0 mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                            {formatEventTimeRange(new Date(event.startsAt), new Date(event.endsAt), event.allDay)}
                          </p>
                        </div>

                        <span className="rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
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
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
