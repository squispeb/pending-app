import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Link2, RefreshCw, Unplug } from 'lucide-react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  disconnectGoogleCalendar,
  getCalendarSettings,
  refreshGoogleCalendars,
  saveGoogleCalendarSelections,
  syncGoogleCalendar,
  startGoogleConnect,
} from '../server/calendar'

const settingsQueryOptions = () =>
  queryOptions({
    queryKey: ['calendar-settings'],
    queryFn: () => getCalendarSettings(),
  })

export const Route = createFileRoute('/settings')({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQueryOptions()),
  component: SettingsPage,
})

function SettingsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(settingsQueryOptions())
  const [selectedCalendars, setSelectedCalendars] = useState<Array<string>>(() =>
    data.calendars.filter((c) => c.isSelected).map((c) => c.calendarId),
  )
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error' | null>(null)

  const selectedFromServer = useMemo(
    () => data.calendars.filter((calendar) => calendar.isSelected).map((calendar) => calendar.calendarId),
    [data.calendars],
  )

  useEffect(() => {
    if (!feedbackMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setFeedbackMessage(null)
      setFeedbackTone(null)
    }, 3500)

    return () => window.clearTimeout(timer)
  }, [feedbackMessage])

  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: ['calendar-settings'] })
  }

  const connectMutation = useMutation({
    mutationFn: async () => startGoogleConnect(),
    onSuccess: ({ url }) => {
      if (typeof window !== 'undefined') {
        window.location.assign(url)
      }
    },
    onError: (error) => {
      setFeedbackTone('error')
      setFeedbackMessage(error instanceof Error ? error.message : 'Could not start Google connect.')
    },
  })

  const refreshCalendarsMutation = useMutation({
    mutationFn: async () => refreshGoogleCalendars(),
    onSuccess: async ({ calendars }) => {
      setFeedbackTone('success')
      setFeedbackMessage(`Calendar list refreshed. ${calendars.filter((item) => item.isSelected).length} selected.`)
      await invalidateSettings()
    },
    onError: (error) => {
      setFeedbackTone('error')
      setFeedbackMessage(error instanceof Error ? error.message : 'Could not refresh calendars.')
    },
  })

  const syncCalendarMutation = useMutation({
    mutationFn: async () => syncGoogleCalendar(),
    onSuccess: async ({ calendarCount, eventCount }) => {
      setFeedbackTone('success')
      setFeedbackMessage(
        `Synced ${eventCount} event${eventCount === 1 ? '' : 's'} from ${calendarCount} calendar${calendarCount === 1 ? '' : 's'}.`,
      )
      await Promise.all([
        invalidateSettings(),
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
      ])
    },
    onError: (error) => {
      setFeedbackTone('error')
      setFeedbackMessage(error instanceof Error ? error.message : 'Could not sync Google Calendar events.')
    },
  })

  const saveSelectionsMutation = useMutation({
    mutationFn: async () =>
      saveGoogleCalendarSelections({
        data: {
          calendarIds: selectedCalendars,
        },
      }),
    onSuccess: async ({ selectedCount }) => {
      setFeedbackTone('success')
      setFeedbackMessage(`Saved ${selectedCount} calendar selection${selectedCount === 1 ? '' : 's'}.`)
      // Reset draft to the just-saved value so hasSelectionChanges returns false
      // without needing a useEffect to sync server state back into local state.
      setSelectedCalendars(selectedCalendars)
      await invalidateSettings()
    },
    onError: (error) => {
      setFeedbackTone('error')
      setFeedbackMessage(error instanceof Error ? error.message : 'Could not save calendar selection.')
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => disconnectGoogleCalendar(),
    onSuccess: async () => {
      setFeedbackTone('success')
      setFeedbackMessage('Google Calendar disconnected. Cached meeting snapshots stay available.')
      await invalidateSettings()
    },
    onError: (error) => {
      setFeedbackTone('error')
      setFeedbackMessage(error instanceof Error ? error.message : 'Could not disconnect Google Calendar.')
    },
  })

  const hasSelectionChanges =
    selectedCalendars.length !== selectedFromServer.length ||
    selectedCalendars.some((calendarId) => !selectedFromServer.includes(calendarId))

  const isConnected = data.account?.status === 'connected'

  function toggleCalendar(calendarId: string) {
    setSelectedCalendars((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId],
    )
  }

  function renderConnectionCopy() {
    if (!data.account) {
      return 'Connect Google Calendar to choose which calendars shape your planning view.'
    }

    if (data.account.status === 'disconnected') {
      return 'Google Calendar is disconnected. Cached meetings stay visible but will be marked stale until you reconnect.'
    }

    return `Connected as ${data.account.email}. All visible calendars start selected, and you can narrow them here anytime.`
  }

  return (
    <main className="page-wrap px-4 pb-24 pt-10">
      {feedbackMessage ? (
        <section
          className={
            feedbackTone === 'error'
              ? 'mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400'
              : 'mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400'
          }
        >
          {feedbackMessage}
        </section>
      ) : null}

      <article className="panel rounded-[1.75rem] p-6 sm:p-8">
        <h1 className="display-title mb-4 text-3xl font-bold text-[var(--ink-strong)]">Settings</h1>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">{renderConnectionCopy()}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={connectMutation.isPending}
            onClick={() => connectMutation.mutate()}
            className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <Link2 size={16} />
              {isConnected ? 'Reconnect Google' : 'Connect Google'}
            </span>
          </button>

          <button
            type="button"
            disabled={!isConnected || refreshCalendarsMutation.isPending}
            onClick={() => refreshCalendarsMutation.mutate()}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={16} className={refreshCalendarsMutation.isPending ? 'animate-spin' : ''} />
              Refresh calendars
            </span>
          </button>

          <button
            type="button"
            disabled={!isConnected || selectedFromServer.length === 0 || syncCalendarMutation.isPending}
            onClick={() => syncCalendarMutation.mutate()}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={16} className={syncCalendarMutation.isPending ? 'animate-spin' : ''} />
              Sync events
            </span>
          </button>

          <button
            type="button"
            disabled={!data.account || disconnectMutation.isPending}
            onClick={() => disconnectMutation.mutate()}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <Unplug size={16} />
              Disconnect
            </span>
          </button>
        </div>

      </article>

      <section className="panel mt-4 rounded-[1.75rem] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="m-0 text-2xl font-semibold text-[var(--ink-strong)]">Choose planning calendars</h2>
          </div>

          <button
            type="button"
            disabled={!data.account || !hasSelectionChanges || saveSelectionsMutation.isPending}
            onClick={() => saveSelectionsMutation.mutate()}
            className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save selection
          </button>
        </div>

        {!data.account ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            Connect Google Calendar to load your available calendars.
          </div>
        ) : data.calendars.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
            No calendars have been discovered yet. Refresh calendars after connecting.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {data.calendars.map((calendar) => {
              const checked = selectedCalendars.includes(calendar.calendarId)

              return (
                <label
                  key={calendar.id}
                  className="subpanel flex cursor-pointer items-start gap-4 rounded-2xl px-4 py-4"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCalendar(calendar.calendarId)}
                    className="mt-1 h-4 w-4 rounded border-[var(--line)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--ink-strong)]">{calendar.calendarName}</span>
                      {calendar.primaryFlag ? (
                        <span className="rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
                          Primary
                        </span>
                      ) : null}
                      {calendar.isSelected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
                          <CheckCircle2 size={12} />
                          Saved
                        </span>
                      ) : null}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
