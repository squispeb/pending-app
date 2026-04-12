import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ExternalLink, X } from 'lucide-react'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import type { PlanningItemCalendarLinkView } from '../server/planning-item-calendar-links'
import type { Habit, HabitCompletion } from '../db/schema'
import {
  applyHabitFilter,
  getHabitCadenceLabel,
  getHabitSummary,
  habitFormSchema,
  isHabitArchived,
  isHabitCompletedOnDate,
  isHabitDueOnDate,
  toHabitFormValues,
  type HabitFilter,
  type HabitFormValues,
  type HabitWeekday,
} from '../lib/habits'
import { getTodayDateString } from '../lib/tasks'
import {
  archiveHabit,
  completeHabitForDate,
  createHabit,
  listHabitCompletions,
  listHabits,
  uncompleteHabitForDate,
  updateHabit,
} from '../server/habits'

// ─── Query options ────────────────────────────────────────────────────────────

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

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/habits')({
  beforeLoad: async ({ context, location }) => {
    if (context.auth.state !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(habitsQueryOptions()),
      context.queryClient.ensureQueryData(habitCompletionsQueryOptions()),
    ])
  },
  component: HabitsPage,
})

// ─── Constants ───────────────────────────────────────────────────────────────

const HABIT_FILTERS: Array<{ value: HabitFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'due-today', label: 'Due today' },
  { value: 'completed-today', label: 'Completed today' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

const WEEKDAYS: Array<{ value: HabitWeekday; label: string }> = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

const EMPTY_FORM = toHabitFormValues(null)

type HabitWithCalendarLinks = Habit & {
  calendarLinks?: Array<PlanningItemCalendarLinkView>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function HabitsPage() {
  const queryClient = useQueryClient()
  const { data: habits } = useSuspenseQuery(habitsQueryOptions())
  const { data: completions } = useSuspenseQuery(habitCompletionsQueryOptions())

  const today = getTodayDateString()
  const summary = getHabitSummary(habits, completions)

  const [filter, setFilter] = useState<HabitFilter>('active')
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [formValues, setFormValues] = useState<HabitFormValues>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({})
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error' | null>(null)
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const chipScrollRef = useRef<HTMLDivElement>(null)
  const [chipScrollLeft, setChipScrollLeft] = useState(0)

  useEffect(() => {
    if (!feedbackMessage) return
    const timer = setTimeout(() => {
      setFeedbackMessage(null)
      setFeedbackTone(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [feedbackMessage])

  useEffect(() => {
    const el = chipScrollRef.current
    if (!el) return
    const onScroll = () => setChipScrollLeft(el.scrollLeft)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const filteredHabits = applyHabitFilter(habits, completions, filter)

  const invalidateHabits = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['habits'] }),
      queryClient.invalidateQueries({ queryKey: ['habit-completions'] }),
    ])
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveHabitMutation = useMutation({
    mutationFn: async (values: HabitFormValues) => {
      const parsed = habitFormSchema.parse(values)
      if (editingHabit) {
        await updateHabit({ data: { id: editingHabit.id, ...parsed } })
      } else {
        await createHabit({ data: parsed })
      }
    },
    onSuccess: async () => {
      const wasEditing = editingHabit
      setFormValues(EMPTY_FORM)
      setEditingHabit(null)
      setFormError(null)
      setFieldErrors({})
      setShowAdvanced(false)
      setShowForm(false)
      setFeedbackTone('success')
      setFeedbackMessage(wasEditing ? 'Habit updated.' : 'Habit created.')
      setActiveHabitId(null)
      await invalidateHabits()
    },
    onError: (error) => {
      if (error instanceof z.ZodError) {
        const flattened = error.flatten().fieldErrors
        setFieldErrors({
          title: flattened.title?.[0],
          cadenceType: flattened.cadenceType?.[0],
          cadenceDays: flattened.cadenceDays?.[0],
          targetCount: flattened.targetCount?.[0],
          preferredStartTime: flattened.preferredStartTime?.[0],
          preferredEndTime: flattened.preferredEndTime?.[0],
          reminderAt: flattened.reminderAt?.[0],
        })
        setFormError('Fix the highlighted fields and try again.')
      } else {
        setFormError(error instanceof Error ? error.message : 'Failed to save habit')
      }
      setFeedbackTone('error')
      setFeedbackMessage('Habit save failed.')
      setActiveHabitId(null)
    },
  })

  const toggleCompleteMutation = useMutation({
    mutationFn: async (habit: Habit) => {
      setActiveHabitId(habit.id)
      if (isHabitCompletedOnDate(habit, completions, today)) {
        await uncompleteHabitForDate({ data: { habitId: habit.id, date: today } })
        return 'undo' as const
      } else {
        await completeHabitForDate({ data: { habitId: habit.id, date: today } })
        return 'complete' as const
      }
    },
    onSuccess: async (action) => {
      setActiveHabitId(null)
      setFeedbackTone('success')
      setFeedbackMessage(action === 'complete' ? 'Habit completed.' : 'Completion removed.')
      await invalidateHabits()
    },
    onError: () => {
      setFeedbackTone('error')
      setFeedbackMessage('Could not update habit.')
      setActiveHabitId(null)
    },
  })

  const archiveHabitMutation = useMutation({
    mutationFn: async (habitId: string) => {
      setActiveHabitId(habitId)
      return archiveHabit({ data: { id: habitId } })
    },
    onSuccess: async () => {
      if (editingHabit) {
        setEditingHabit(null)
        setFormValues(EMPTY_FORM)
      }
      setActiveHabitId(null)
      setFeedbackTone('success')
      setFeedbackMessage('Habit archived.')
      await invalidateHabits()
    },
    onError: () => {
      setFeedbackTone('error')
      setFeedbackMessage('Habit archive failed.')
      setActiveHabitId(null)
    },
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setActiveHabitId(editingHabit?.id ?? 'new-habit')
    saveHabitMutation.mutate(formValues)
  }

  function handleChange<K extends keyof HabitFormValues>(key: K, value: HabitFormValues[K]) {
    setFieldErrors((current) => {
      if (!current[key]) return current
      return { ...current, [key]: undefined }
    })
    setFormValues((current) => ({ ...current, [key]: value }))
  }

  function beginEdit(habit: Habit) {
    setEditingHabit(habit)
    setFormValues(toHabitFormValues(habit))
    setFormError(null)
    setFieldErrors({})
    setFeedbackMessage(null)
    setFeedbackTone(null)
    const hasSecondary = !!(
      habit.preferredStartTime ||
      habit.preferredEndTime ||
      habit.reminderAt ||
      (habit.targetCount && habit.targetCount > 1)
    )
    setShowAdvanced(hasSecondary)
    setShowForm(true)
  }

  function resetForm() {
    setEditingHabit(null)
    setFormValues(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowAdvanced(false)
    setShowForm(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="page-wrap px-4 pb-28 pt-10 lg:pb-10">
      {/* Hero */}
      <section className="hero-panel rounded-[2rem] px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="display-title text-3xl font-bold text-[var(--ink-strong)]">Habits</h1>

          <div className="grid grid-cols-2 gap-y-4 sm:flex sm:flex-wrap sm:items-center">
            {(
              [
                ['Active', summary.active],
                ['Due today', summary.dueToday],
                ['Completed today', summary.completedToday],
                ['Archived', summary.archived],
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
        </div>
      </section>

      {/* Feedback toast */}
      {feedbackMessage ? (
        <section
          className={
            feedbackTone === 'error'
              ? 'mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400'
              : 'mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400'
          }
        >
          {feedbackMessage}
        </section>
      ) : null}

      <section className="mt-6 grid gap-6">
        <article className="min-w-0 space-y-6">
          <section className="panel rounded-[1.75rem] p-6 sm:p-8">
            {/* Filter chips */}
            <div className="mb-5">
              <div className="relative">
                <div
                  ref={chipScrollRef}
                  className="flex gap-2 overflow-x-auto pb-0.5"
                  style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {HABIT_FILTERS.map((option) => {
                    const count = applyHabitFilter(habits, completions, option.value).length
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFilter(option.value)}
                        className={
                          filter === option.value
                            ? 'primary-pill inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                            : 'secondary-pill inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                        }
                      >
                        {option.label}
                        <span
                          className={`tabular-nums text-xs ${filter === option.value ? 'opacity-70' : 'opacity-50'}`}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Left fade — visible once scrolled */}
                {chipScrollLeft > 0 ? (
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 w-10"
                    style={{ background: 'linear-gradient(to left, transparent, var(--surface))' }}
                  />
                ) : null}
                {/* Right fade */}
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-10"
                  style={{ background: 'linear-gradient(to right, transparent, var(--surface))' }}
                />
              </div>
            </div>

            {/* Habit list */}
            {filteredHabits.length === 0 ? (
              <div className="subpanel rounded-2xl p-6 text-sm leading-7 text-[var(--ink-soft)]">
                No habits.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHabits.map((habit) => (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    completions={completions}
                    today={today}
                    onEdit={() => beginEdit(habit)}
                    onToggleComplete={() => toggleCompleteMutation.mutate(habit)}
                    onArchive={() => archiveHabitMutation.mutate(habit.id)}
                    isMutating={activeHabitId === habit.id}
                  />
                ))}
              </div>
            )}
          </section>
        </article>
      </section>

      {/* Backdrop */}
      <div
        onClick={resetForm}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${
          showForm ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Bottom sheet / desktop modal */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 duration-300 lg:inset-0 lg:flex lg:items-center lg:justify-center ${
          showForm
            ? 'translate-y-0 opacity-100 transition-[transform,opacity] lg:pointer-events-auto'
            : 'translate-y-full opacity-0 transition-[transform,opacity] lg:translate-y-0 lg:pointer-events-none'
        }`}
      >
        <div className="mx-auto w-full max-w-2xl lg:px-4">
          <div className="panel rounded-t-[2rem] px-6 pb-10 pt-3 lg:rounded-[2rem]">
            {/* Drag handle — mobile only */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)] lg:hidden" />

            {/* Sheet header */}
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold text-[var(--ink-strong)]">
                {editingHabit ? 'Edit habit' : 'New habit'}
              </h2>
              <button
                type="button"
                onClick={resetForm}
                aria-label="Close"
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink-strong)]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable form area */}
            <div className="max-h-[65vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <form className="space-y-4" onSubmit={handleSubmit}>
                {/* Title */}
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                    Title
                  </span>
                  <input
                    value={formValues.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    placeholder="Morning run, read 20 pages, meditate"
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  />
                  {fieldErrors.title ? (
                    <span className="mt-2 block text-sm font-medium text-red-600">
                      {fieldErrors.title}
                    </span>
                  ) : null}
                </label>

                {/* Cadence toggle */}
                <div>
                  <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                    Cadence
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleChange('cadenceType', 'daily')}
                      className={
                        formValues.cadenceType === 'daily'
                          ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                          : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                      }
                    >
                      Daily
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('cadenceType', 'selected_days')}
                      className={
                        formValues.cadenceType === 'selected_days'
                          ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                          : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                      }
                    >
                      Specific days
                    </button>
                  </div>
                </div>

                {/* Weekday picker */}
                {formValues.cadenceType === 'selected_days' ? (
                  <div>
                    <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                      Days
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => {
                        const selected = formValues.cadenceDays.includes(day.value)
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => {
                              const current = formValues.cadenceDays
                              handleChange(
                                'cadenceDays',
                                selected
                                  ? current.filter((d) => d !== day.value)
                                  : [...current, day.value],
                              )
                            }}
                            className={
                              selected
                                ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1 !px-2.5 text-xs font-semibold'
                                : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1 !px-2.5 text-xs font-semibold'
                            }
                          >
                            {day.label}
                          </button>
                        )
                      })}
                    </div>
                    {fieldErrors.cadenceDays ? (
                      <span className="mt-2 block text-sm font-medium text-red-600">
                        {fieldErrors.cadenceDays}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* More options toggle */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                >
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                  />
                  More options
                </button>

                {/* Secondary fields */}
                {showAdvanced ? (
                  <div className="space-y-4">
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                        Preferred window
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          value={formValues.preferredStartTime ?? ''}
                          onChange={(e) => handleChange('preferredStartTime', e.target.value)}
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                        <input
                          type="time"
                          value={formValues.preferredEndTime ?? ''}
                          onChange={(e) => handleChange('preferredEndTime', e.target.value)}
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                      </div>
                      {fieldErrors.preferredStartTime ?? fieldErrors.preferredEndTime ? (
                        <span className="mt-2 block text-sm font-medium text-red-600">
                          {fieldErrors.preferredStartTime ?? fieldErrors.preferredEndTime}
                        </span>
                      ) : null}
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                        Reminder
                      </span>
                      <input
                        type="datetime-local"
                        value={formValues.reminderAt ?? ''}
                        onChange={(e) => handleChange('reminderAt', e.target.value)}
                        className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                      />
                      {fieldErrors.reminderAt ? (
                        <span className="mt-2 block text-sm font-medium text-red-600">
                          {fieldErrors.reminderAt}
                        </span>
                      ) : null}
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                        Target count
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={formValues.targetCount ?? 1}
                        onChange={(e) =>
                          handleChange(
                            'targetCount',
                            e.target.value ? Number(e.target.value) : 1,
                          )
                        }
                        className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                      />
                      {fieldErrors.targetCount ? (
                        <span className="mt-2 block text-sm font-medium text-red-600">
                          {fieldErrors.targetCount}
                        </span>
                      ) : null}
                    </label>
                  </div>
                ) : null}

                {formError ? (
                  <p className="m-0 text-sm font-medium text-red-600">{formError}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={saveHabitMutation.isPending}
                    className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveHabitMutation.isPending
                      ? 'Saving...'
                      : editingHabit
                        ? 'Save changes'
                        : 'Create habit'}
                  </button>

                  <button
                    type="button"
                    onClick={resetForm}
                    className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

// ─── HabitCard ────────────────────────────────────────────────────────────────

function HabitCard({
  habit,
  completions,
  today,
  onEdit,
  onToggleComplete,
  onArchive,
  isMutating,
}: {
  habit: HabitWithCalendarLinks
  completions: Array<HabitCompletion>
  today: string
  onEdit: () => void
  onToggleComplete: () => void
  onArchive: () => void
  isMutating: boolean
}) {
  const completedToday = isHabitCompletedOnDate(habit, completions, today)
  const archived = isHabitArchived(habit)
  const isDone = completedToday || archived

  // Last 7 days: oldest → newest, derived from today string to avoid timezone drift
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const [y, mo, d] = today.split('-').map(Number)
    const date = new Date(y, mo - 1, d)
    date.setDate(date.getDate() - (6 - i))
    const yy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const dateString = `${yy}-${mm}-${dd}`
    const isDue = isHabitDueOnDate(habit, date)
    const isCompleted = isHabitCompletedOnDate(habit, completions, dateString)
    return { dateString, isDue, isCompleted }
  })

  return (
    <article className={`subpanel rounded-2xl p-4 transition-opacity ${isDone ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`mt-0.5 size-2 shrink-0 rounded-full bg-[var(--brand)] ${isDone ? 'opacity-40' : ''}`}
            />
            <h3
              className={`m-0 text-sm font-semibold ${isDone ? 'line-through text-[var(--ink-soft)]' : 'text-[var(--ink-strong)]'}`}
            >
              {habit.title}
            </h3>
          </div>

          <div className="ml-4 mt-1.5 flex flex-wrap gap-3 text-xs text-[var(--ink-soft)]">
            <span>{getHabitCadenceLabel(habit)}</span>
            {habit.preferredStartTime && habit.preferredEndTime ? (
              <span>
                {habit.preferredStartTime}–{habit.preferredEndTime}
              </span>
            ) : null}
            {habit.reminderAt ? <span>Reminder set</span> : null}
          </div>

          {habit.calendarLinks?.length ? (
            <div className="ml-4 mt-3 flex flex-wrap gap-2">
              {habit.calendarLinks.map((link) => {
                const content = (
                  <>
                    <CalendarDays size={12} className="shrink-0" />
                    <span>Linked to {link.matchedSummary}</span>
                    {link.resolvedEvent?.htmlLink ? <ExternalLink size={11} className="shrink-0 opacity-70" /> : null}
                  </>
                )

                return link.resolvedEvent?.htmlLink ? (
                  <a
                    key={link.id}
                    href={link.resolvedEvent.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary-pill inline-flex items-center gap-1.5 border-0 !px-3 !py-1 text-xs font-semibold no-underline"
                    title={link.matchReason}
                  >
                    {content}
                  </a>
                ) : (
                  <span
                    key={link.id}
                    className="secondary-pill inline-flex items-center gap-1.5 border-0 !px-3 !py-1 text-xs font-semibold"
                    title={link.matchReason}
                  >
                    {content}
                  </span>
                )
              })}
            </div>
          ) : null}

          {/* 7-day dot strip */}
          <div className="ml-4 mt-2 flex items-center gap-1.5">
            {last7Days.map(({ dateString, isDue, isCompleted }) => {
              if (!isDue) return null
              return (
                <span
                  key={dateString}
                  title={dateString}
                  className={`inline-block size-2 rounded-full ${
                    isCompleted ? 'bg-[var(--brand)]' : 'border border-[var(--line)]'
                  }`}
                />
              )
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onToggleComplete}
            disabled={isMutating || archived}
            className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {completedToday ? 'Undo' : 'Done'}
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={isMutating || archived}
            className="cursor-pointer text-xs font-semibold text-red-500 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Archive
          </button>
        </div>
      </div>
    </article>
  )
}
