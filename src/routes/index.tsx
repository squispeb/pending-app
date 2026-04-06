import { useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CalendarDays, CheckSquare, Repeat, Settings2 } from 'lucide-react'
import type { Habit, Task } from '../db/schema'
import {
  applyTaskFilter,
  getTaskSummary,
  getTaskTimingLabel,
  getTodayDateString,
  isTaskCompleted,
  sortTasks,
} from '../lib/tasks'
import {
  applyHabitFilter,
  getHabitCadenceLabel,
  getHabitSummary,
  isHabitCompletedOnDate,
} from '../lib/habits'
import { completeTask, listTasks, reopenTask } from '../server/tasks'
import {
  completeHabitForDate,
  listHabitCompletions,
  listHabits,
  uncompleteHabitForDate,
} from '../server/habits'

// ─── Query options ────────────────────────────────────────────────────────────

const tasksQueryOptions = () =>
  queryOptions({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  })

const habitsQueryOptions = () =>
  queryOptions({
    queryKey: ['habits'],
    queryFn: () => listHabits(),
  })

function getCompletionsRange() {
  const now = new Date()
  const endDate = getTodayDateString(now)
  const start = new Date(now)
  start.setDate(start.getDate() - 29)
  const startDate = getTodayDateString(start)
  return { startDate, endDate }
}

const { startDate: COMP_START, endDate: COMP_END } = getCompletionsRange()

const habitCompletionsQueryOptions = () =>
  queryOptions({
    queryKey: ['habit-completions', COMP_START, COMP_END],
    queryFn: () => listHabitCompletions({ data: { startDate: COMP_START, endDate: COMP_END } }),
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(tasksQueryOptions()),
      context.queryClient.ensureQueryData(habitsQueryOptions()),
      context.queryClient.ensureQueryData(habitCompletionsQueryOptions()),
    ]),
  component: DashboardPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTodayHeading() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const queryClient = useQueryClient()
  const { data: tasks } = useSuspenseQuery(tasksQueryOptions())
  const { data: habits } = useSuspenseQuery(habitsQueryOptions())
  const { data: completions } = useSuspenseQuery(habitCompletionsQueryOptions())

  const today = getTodayDateString()
  const taskSummary = getTaskSummary(tasks)
  const habitSummary = getHabitSummary(habits, completions)

  const overdueTasks = sortTasks(applyTaskFilter(tasks, 'overdue'), 'due-asc')
  const dueTodayTasks = sortTasks(applyTaskFilter(tasks, 'today'), 'due-asc')
  const todayHabits = applyHabitFilter(habits, completions, 'due-today')

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null)

  const invalidateTasks = () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  const invalidateHabits = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['habits'] }),
      queryClient.invalidateQueries({ queryKey: ['habit-completions'] }),
    ])

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
      await invalidateTasks()
    },
  })

  const toggleHabitMutation = useMutation({
    mutationFn: async (habit: Habit) => {
      setActiveHabitId(habit.id)
      if (isHabitCompletedOnDate(habit, completions, today)) {
        await uncompleteHabitForDate({ data: { habitId: habit.id, date: today } })
      } else {
        await completeHabitForDate({ data: { habitId: habit.id, date: today } })
      }
    },
    onSettled: async () => {
      setActiveHabitId(null)
      await invalidateHabits()
    },
  })

  const hasFocusTasks = overdueTasks.length > 0 || dueTodayTasks.length > 0

  return (
    <main className="page-wrap px-4 pb-12 pt-10 sm:pt-14">
      {/* Date / stats hero */}
      <section className="hero-panel relative overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.24),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">Today</p>
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
      </section>

      {/* Focus panels */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Tasks to action */}
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
            <p className="text-sm leading-7 text-[var(--ink-soft)]">
              No overdue or due-today tasks.
            </p>
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

        {/* Habits today */}
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
              {todayHabits.map((habit) => {
                const done = isHabitCompletedOnDate(habit, completions, today)
                return (
                  <article
                    key={habit.id}
                    className={`subpanel flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-opacity ${done ? 'opacity-60' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`m-0 text-sm font-semibold ${done ? 'line-through text-[var(--ink-soft)]' : 'text-[var(--ink-strong)]'}`}
                      >
                        {habit.title}
                      </p>
                      <p className="m-0 mt-0.5 text-xs text-[var(--ink-soft)]">
                        {getHabitCadenceLabel(habit)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHabitMutation.mutate(habit)}
                      disabled={activeHabitId === habit.id}
                      className="shrink-0 cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {done ? 'Undo' : 'Done'}
                    </button>
                  </article>
                )
              })}
            </div>
          )}

          {habitSummary.dueToday > 0 ? (
            <p className="mt-4 text-xs text-[var(--ink-soft)]">
              {habitSummary.completedToday} of {habitSummary.dueToday} completed today
            </p>
          ) : null}
        </section>
      </div>

      {/* Quick navigation */}
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

// ─── DashboardTaskRow ─────────────────────────────────────────────────────────

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
