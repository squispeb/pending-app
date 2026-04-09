import { useEffect, useMemo, useRef, useState } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Bell, CalendarDays, CheckSquare, Mic, Repeat, Settings2 } from 'lucide-react'
import type { Habit, Task } from '../db/schema'
import { getTaskTimingLabel, getTodayDateString, isTaskCompleted } from '../lib/tasks'
import { getHabitCadenceLabel } from '../lib/habits'
import type { ReminderItem } from '../lib/reminders'
import { completeTask, reopenTask } from '../server/tasks'
import { completeHabitForDate, uncompleteHabitForDate } from '../server/habits'
import { getDashboardData } from '../server/dashboard'
import { getCalendarEventsForDay, getCalendarView, syncGoogleCalendar } from '../server/calendar'
import {
  deferReminder,
  dismissReminder,
  markReminderDelivered,
  snoozeReminder,
} from '../server/reminders'
import { useCaptureContext } from '../contexts/CaptureContext'

const dashboardQueryOptions = () =>
  queryOptions({
    queryKey: ['dashboard'],
    queryFn: () => getDashboardData(),
  })

const calendarDayQueryOptions = (dateStr: string) =>
  queryOptions({
    queryKey: ['calendar-day', dateStr],
    queryFn: () => getCalendarEventsForDay({ data: { dateStr } }),
    staleTime: 60_000,
  })

const calendarViewQueryOptions = () =>
  queryOptions({
    queryKey: ['calendar-view'],
    queryFn: () => getCalendarView(),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
  component: DashboardPage,
})

function formatTodayHeading() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function DashboardPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(dashboardQueryOptions())
  const { openCapture, openCaptureWithText } = useCaptureContext()

  const todayStr = getTodayDateString()
  const { data: calendarViewData } = useQuery(calendarViewQueryOptions())
  const { data: calendarDayData } = useQuery(calendarDayQueryOptions(todayStr))
  const todayMeetings = calendarDayData?.events ?? []

  const [quickEntryText, setQuickEntryText] = useState('')

  function handleQuickEntrySubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = quickEntryText.trim()
    if (!text) return
    setQuickEntryText('')
    openCaptureWithText(text)
  }

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null)
  const [activeReminderId, setActiveReminderId] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported'
    }

    return Notification.permission
  })

  const {
    today,
    taskSummary,
    habitSummary,
    overdueTasks,
    dueTodayTasks,
    todayHabits,
    dueReminders,
  } = data

  const visibleReminders = useMemo(
    () => dueReminders.filter((item) => !item.deliveredInAppAt),
    [dueReminders],
  )

  // Stable primitive keys — effects use these as deps to avoid firing on every array re-reference.
  const visibleReminderKey = visibleReminders.map((r) => r.id).join(',')
  const dueReminderKey = dueReminders.map((r) => r.id).join(',')

  // Refs so the effects always read the latest arrays without listing them as deps.
  const visibleRemindersRef = useRef(visibleReminders)
  visibleRemindersRef.current = visibleReminders
  const dueRemindersRef = useRef(dueReminders)
  dueRemindersRef.current = dueReminders
  const autoSyncAttemptedRef = useRef(false)

  const invalidateDashboard = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] })

  const syncCalendarMutation = useMutation({
    mutationFn: async () => syncGoogleCalendar(),
    onSuccess: async () => {
      await Promise.all([
        invalidateDashboard(),
        queryClient.invalidateQueries({ queryKey: ['calendar-day', todayStr] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-settings'] }),
      ])
    },
  })

  const toggleTaskMutation = useMutation({
    mutationFn: async (task: Task) => {
      setActiveTaskId(task.id)
      if (isTaskCompleted(task)) {
        await reopenTask({ data: { id: task.id } })
      } else {
        await completeTask({ data: { id: task.id } })
      }
    },
    onSettled: async () => {
      setActiveTaskId(null)
      await invalidateDashboard()
    },
  })

  const toggleHabitMutation = useMutation({
    mutationFn: async (habit: Habit, completedToday: boolean) => {
      setActiveHabitId(habit.id)
      if (completedToday) {
        await uncompleteHabitForDate({ data: { habitId: habit.id, date: today } })
      } else {
        await completeHabitForDate({ data: { habitId: habit.id, date: today } })
      }
    },
    onSettled: async () => {
      setActiveHabitId(null)
      await invalidateDashboard()
    },
  })

  const snoozeReminderMutation = useMutation({
    mutationFn: async (id: string) => {
      setActiveReminderId(id)
      await snoozeReminder({ data: { id, minutes: 15 } })
    },
    onSettled: async () => {
      setActiveReminderId(null)
      await invalidateDashboard()
    },
  })

  const dismissReminderMutation = useMutation({
    mutationFn: async (id: string) => {
      setActiveReminderId(id)
      await dismissReminder({ data: { id } })
    },
    onSettled: async () => {
      setActiveReminderId(null)
      await invalidateDashboard()
    },
  })

  const deferReminderMutation = useMutation({
    mutationFn: async (id: string) => {
      setActiveReminderId(id)
      await deferReminder({ data: { id, minutes: 30 } })
    },
    onSettled: async () => {
      setActiveReminderId(null)
      await invalidateDashboard()
    },
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoSyncAttemptedRef.current) {
      return
    }

    if (!calendarViewData || calendarViewData.account?.status !== 'connected') {
      return
    }

    if (calendarViewData.selectedCalendars.length === 0) {
      return
    }

    const lastSyncedAt = calendarViewData.syncStatus?.lastSyncedAt
      ? new Date(calendarViewData.syncStatus.lastSyncedAt)
      : null
    const shouldAutoSync = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > 15 * 60_000

    if (!shouldAutoSync || syncCalendarMutation.isPending) {
      return
    }

    autoSyncAttemptedRef.current = true
    syncCalendarMutation.mutate()
  }, [calendarViewData, syncCalendarMutation])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const reminders = visibleRemindersRef.current
    if (!reminders.length) {
      return
    }

    reminders.forEach((item) => {
      markReminderDelivered({ data: { id: item.id, channel: 'in-app' } }).catch(() => {})
    })
  // visibleReminderKey is a stable primitive derived from the IDs — fires exactly when the set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReminderKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      notificationPermission !== 'granted' ||
      !('Notification' in window)
    ) {
      return
    }

    const browserEligible = dueRemindersRef.current.filter((item) => !item.deliveredBrowserAt)
    browserEligible.forEach((item) => {
      new Notification(item.title, {
        body: item.timingLabel,
      })
      markReminderDelivered({ data: { id: item.id, channel: 'browser' } }).catch(() => {})
    })
  // dueReminderKey is a stable primitive derived from the IDs — fires exactly when the set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueReminderKey, notificationPermission])

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const hasFocusTasks = overdueTasks.length > 0 || dueTodayTasks.length > 0

  return (
    <main className="page-wrap px-4 pb-24 pt-10 sm:pt-14 lg:pb-10">
      <section className="hero-panel relative overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.24),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.18),transparent_66%)]" />
        <h1 className="display-title mb-6 text-3xl font-bold tracking-tight text-[var(--ink-strong)] sm:text-4xl">
          {formatTodayHeading()}
        </h1>
        <div className="grid grid-cols-2 gap-y-4 sm:flex sm:flex-wrap sm:items-center">
          {(
            [
              ['Active tasks', taskSummary.active],
              ['Due today', taskSummary.dueToday],
              ['Overdue', taskSummary.overdue],
              ['Habits due', habitSummary.dueToday],
            ] as const
          ).map(([label, value], i) => (
            <div
              key={label}
              className={`flex flex-col items-center gap-1 px-5 ${
                i === 1 || i === 3
                  ? 'border-l border-[var(--line)]'
                  : 'sm:border-l sm:border-[var(--line)]'
              } ${i === 0 ? 'sm:border-l-0' : ''}`}
            >
              <span className="text-2xl font-bold tabular-nums text-[var(--ink-strong)]">
                {value}
              </span>
              <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Quick entry */}
        <form
          onSubmit={handleQuickEntrySubmit}
          className="relative mt-6 flex items-center gap-2"
        >
          <input
            type="text"
            value={quickEntryText}
            onChange={(e) => setQuickEntryText(e.target.value)}
            placeholder="Add a task or habit…"
            aria-label="Quick capture"
            className="flex-1 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.07)] px-4 py-3 text-sm text-[var(--ink-strong)] placeholder:text-[var(--ink-soft)] outline-none transition focus:border-[var(--brand)] focus:bg-[rgba(255,255,255,0.10)]"
          />
          <button
            type="button"
            onClick={openCapture}
            aria-label="Voice capture"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition active:scale-95"
            style={{ background: 'linear-gradient(135deg, #2563eb, #10b981)' }}
          >
            <Mic size={18} className="text-white" />
          </button>
          {quickEntryText.trim() ? (
            <button
              type="submit"
              className="primary-pill cursor-pointer border-0 text-sm font-semibold shrink-0"
            >
              Add
            </button>
          ) : null}
        </form>
      </section>

      <div className="mt-4">
        <ReminderPanel
          reminders={visibleReminders}
          permission={notificationPermission}
          activeReminderId={activeReminderId}
          onRequestPermission={requestNotifications}
          onSnooze={(id) => snoozeReminderMutation.mutate(id)}
          onDefer={(id) => deferReminderMutation.mutate(id)}
          onDismiss={(id) => dismissReminderMutation.mutate(id)}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">Tasks to action</h2>
            <a
              href="/tasks"
              className="text-sm font-semibold text-[var(--brand)] no-underline transition hover:opacity-70"
            >
              All tasks →
            </a>
          </div>

          {!hasFocusTasks ? (
            <p className="text-sm leading-7 text-[var(--ink-soft)]">No overdue or due-today tasks.</p>
          ) : (
            <div className="space-y-2">
              {overdueTasks.length > 0 ? (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-red-400">
                    Overdue
                  </p>
                  {overdueTasks.map((task) => (
                    <DashboardTaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => toggleTaskMutation.mutate(task)}
                      isMutating={activeTaskId === task.id}
                    />
                  ))}
                </>
              ) : null}

              {dueTodayTasks.length > 0 ? (
                <>
                  <p
                    className={`mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)] ${overdueTasks.length > 0 ? 'mt-4' : ''}`}
                  >
                    Due today
                  </p>
                  {dueTodayTasks.map((task) => (
                    <DashboardTaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => toggleTaskMutation.mutate(task)}
                      isMutating={activeTaskId === task.id}
                    />
                  ))}
                </>
              ) : null}
            </div>
          )}
        </section>

        <section className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">Habits today</h2>
            <a
              href="/habits"
              className="text-sm font-semibold text-[var(--brand)] no-underline transition hover:opacity-70"
            >
              All habits →
            </a>
          </div>

          {todayHabits.length === 0 ? (
            <p className="text-sm leading-7 text-[var(--ink-soft)]">No habits due today.</p>
          ) : (
            <div className="space-y-2">
              {todayHabits.map(({ habit, completedToday }) => (
                <article
                  key={habit.id}
                  className={`subpanel flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-opacity ${completedToday ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`m-0 text-sm font-semibold ${completedToday ? 'line-through text-[var(--ink-soft)]' : 'text-[var(--ink-strong)]'}`}
                    >
                      {habit.title}
                    </p>
                    <p className="m-0 mt-0.5 text-xs text-[var(--ink-soft)]">
                      {getHabitCadenceLabel(habit)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleHabitMutation.mutate(habit, completedToday)}
                    disabled={activeHabitId === habit.id}
                    className="shrink-0 cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {completedToday ? 'Undo' : 'Done'}
                  </button>
                </article>
              ))}
            </div>
          )}

          {habitSummary.dueToday > 0 ? (
            <p className="mt-4 text-xs text-[var(--ink-soft)]">
              {habitSummary.completedToday} of {habitSummary.dueToday} completed today
            </p>
          ) : null}
        </section>
      </div>

      {todayMeetings.length > 0 ? (
        <section className="panel mt-6 rounded-[1.75rem] p-6 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">Meetings today</h2>
            <a
              href="/calendar"
              className="text-sm font-semibold text-[var(--brand)] no-underline transition hover:opacity-70"
            >
              Calendar →
            </a>
          </div>
          <div className="space-y-2">
            {todayMeetings.map((event) => (
              <MeetingRow key={event.id} event={event} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { title: 'Tasks', icon: CheckSquare, href: '/tasks' },
          { title: 'Habits', icon: Repeat, href: '/habits' },
          { title: 'Calendar', icon: CalendarDays, href: '/calendar' },
          { title: 'Settings', icon: Settings2, href: '/settings' },
        ].map(({ title, icon: Icon, href }) => (
          <a
            key={title}
            href={href}
            className="subpanel flex items-center gap-3 rounded-2xl px-4 py-4 no-underline"
          >
            <Icon size={18} className="shrink-0 text-[var(--ink-soft)]" />
            <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">{title}</p>
          </a>
        ))}
      </section>
    </main>
  )
}

function ReminderPanel({
  reminders,
  permission,
  activeReminderId,
  onRequestPermission,
  onSnooze,
  onDefer,
  onDismiss,
}: {
  reminders: Array<ReminderItem>
  permission: NotificationPermission | 'unsupported'
  activeReminderId: string | null
  onRequestPermission: () => void
  onSnooze: (id: string) => void
  onDefer: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <section className="panel rounded-[1.75rem] p-6 sm:p-7">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[var(--ink-soft)]" />
          <h2 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">Reminders</h2>
        </div>
        {permission === 'default' ? (
          <button
            type="button"
            onClick={onRequestPermission}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold"
          >
            Enable browser alerts
          </button>
        ) : null}
      </div>

      {reminders.length === 0 ? (
        <p className="text-sm leading-7 text-[var(--ink-soft)]">No reminders are due right now.</p>
      ) : (
        <div className="space-y-3">
          {reminders.map((item) => (
            <article key={item.id} className="subpanel rounded-2xl px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">{item.title}</p>
                  <p className="m-0 mt-1 text-xs text-[var(--ink-soft)]">{item.timingLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSnooze(item.id)}
                    disabled={activeReminderId === item.id}
                    className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Snooze 15m
                  </button>
                  {item.sourceType === 'task' ? (
                    <button
                      type="button"
                      onClick={() => onDefer(item.id)}
                      disabled={activeReminderId === item.id}
                      className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Defer 30m
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDismiss(item.id)}
                    disabled={activeReminderId === item.id}
                    className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function DashboardTaskRow({
  task,
  onToggle,
  isMutating,
}: {
  task: Task
  onToggle: () => void
  isMutating: boolean
}) {
  const completed = isTaskCompleted(task)

  const priorityDot =
    task.priority === 'high'
      ? 'bg-red-400'
      : task.priority === 'medium'
        ? 'bg-amber-400'
        : 'bg-slate-400'

  return (
    <article
      className={`subpanel flex items-start justify-between gap-3 rounded-2xl px-4 py-3 transition-opacity ${completed ? 'opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`mt-0.5 size-2 shrink-0 rounded-full ${priorityDot}`} />
          <p
            className={`m-0 text-sm font-semibold ${completed ? 'line-through text-[var(--ink-soft)]' : 'text-[var(--ink-strong)]'}`}
          >
            {task.title}
          </p>
        </div>
        <p className="m-0 ml-4 mt-0.5 text-xs text-[var(--ink-soft)]">
          {getTaskTimingLabel(task)}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={isMutating}
        className="shrink-0 cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {completed ? 'Reopen' : 'Done'}
      </button>
    </article>
  )
}

function MeetingRow({
  event,
}: {
  event: {
    id: string
    summary: string | null
    startsAt: Date
    endsAt: Date
    allDay: boolean
    location: string | null
    htmlLink: string | null
    calendarName: string
    primaryFlag: boolean
  }
}) {
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  const timeLabel = event.allDay
    ? 'All day'
    : `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

  const now = new Date()
  const isNow = !event.allDay && start <= now && now < end
  const isPast = !event.allDay && end <= now

  const inner = (
    <article
      className={`subpanel flex items-center gap-3 rounded-2xl px-4 py-3 transition-opacity ${isPast ? 'opacity-50' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isNow ? (
            <span className="shrink-0 rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Now
            </span>
          ) : null}
          <p className="m-0 truncate text-sm font-semibold text-[var(--ink-strong)]">
            {event.summary ?? 'Untitled event'}
          </p>
        </div>
        <p className="m-0 mt-0.5 truncate text-xs text-[var(--ink-soft)]">
          {timeLabel}
          {event.location ? ` · ${event.location}` : ''}
        </p>
      </div>
    </article>
  )

  if (event.htmlLink) {
    return (
      <a
        key={event.id}
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block no-underline"
      >
        {inner}
      </a>
    )
  }

  return inner
}
