import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  disconnectGoogleCalendar,
  getCalendarSettings,
  refreshGoogleCalendars,
  saveGoogleCalendarSelections,
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
  const [selectedCalendars, setSelectedCalendars] = useState<Array<string>>([])
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error' | null>(null)

  const selectedFromServer = useMemo(
    () => data.calendars.filter((calendar) => calendar.isSelected).map((calendar) => calendar.calendarId),
    [data.calendars],
  )

  useEffect(() => {
    setSelectedCalendars(selectedFromServer)
  }, [selectedFromServer])

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
    <main className="page-wrap px-4 pb-12 pt-10">
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

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="panel rounded-[1.75rem] p-6 sm:p-8">
          <p className="island-kicker mb-3">Milestone 4</p>
          <h1 className="display-title mb-4 text-4xl font-bold text-[var(--ink-strong)]">
            Settings and integrations
          </h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
            {renderConnectionCopy()}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!data.configuration.ready || connectMutation.isPending}
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

        <article className="panel rounded-[1.75rem] p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-2">
            {data.configuration.ready ? (
              <ShieldCheck size={18} className="text-emerald-400" />
            ) : (
              <CircleAlert size={18} className="text-amber-400" />
            )}
            <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">Server configuration</p>
          </div>

          {data.configuration.ready ? (
            <p className="text-sm leading-7 text-[var(--ink-soft)]">
              Google OAuth variables are present. Connect can run from this environment.
            </p>
          ) : (
            <>
              <p className="text-sm leading-7 text-[var(--ink-soft)]">
                Add the missing server variables before starting Google OAuth.
              </p>
              <ul className="m-0 mt-3 space-y-2 pl-5 text-sm leading-6 text-[var(--ink-soft)]">
                {data.configuration.missing.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--panel-alt)] px-4 py-4 text-sm leading-7 text-[var(--ink-soft)]">
            <p className="m-0 font-semibold text-[var(--ink-strong)]">Current integration state</p>
            <p className="m-0 mt-2">
              {data.account ? (
                <>
                  Account: <span className="text-[var(--ink-strong)]">{data.account.email}</span>
                </>
              ) : (
                'No Google account connected yet.'
              )}
            </p>
            <p className="m-0 mt-1">
              Cached meeting snapshots: <span className="text-[var(--ink-strong)]">{data.cachedEventCount}</span>
            </p>
            <p className="m-0 mt-1">
              Last event sync:{' '}
              <span className="text-[var(--ink-strong)]">
                {data.syncStatus?.lastSyncedAt
                  ? new Date(data.syncStatus.lastSyncedAt).toLocaleString()
                  : 'Not synced yet'}
              </span>
            </p>
          </div>
        </article>
      </section>

      <section className="panel mt-4 rounded-[1.75rem] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="island-kicker mb-2">Calendar selection</p>
            <h2 className="m-0 text-2xl font-semibold text-[var(--ink-strong)]">Choose planning calendars</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
              Visible calendars are selected automatically on first connect. Hidden calendars stay available to inspect but do not affect planning until you opt in.
            </p>
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
                        <span className="rounded-full bg-[var(--panel-soft)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
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
                    <p className="m-0 mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      <code>{calendar.calendarId}</code>
                    </p>
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
