import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronDown, ExternalLink, X } from 'lucide-react'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { Task } from '../db/schema'
import {
  applyTaskFilter,
  getReminderLabel,
  getTaskSummary,
  getTaskTimingLabel,
  groupActiveTasks,
  isTaskArchived,
  isTaskCompleted,
  sortTasks,
  taskFormSchema,
  toTaskFormValues,
  type TaskFilter,
  type TaskFormValues,
  type TaskSort,
} from '../lib/tasks'
import { z } from 'zod'
import type { PlanningItemCalendarLinkView } from '../server/planning-item-calendar-links'
import {
  archiveTask,
  completeTask,
  createTask,
  listTasks,
  reopenTask,
  updateTask,
} from '../server/tasks'

const tasksQueryOptions = () =>
  queryOptions({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  })

export const Route = createFileRoute('/tasks')({
  loader: ({ context }) => context.queryClient.ensureQueryData(tasksQueryOptions()),
  component: TasksPage,
})

const FILTERS: Array<{ value: TaskFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'high-priority', label: 'High priority' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

const SORTS: Array<{ value: TaskSort; label: string }> = [
  { value: 'created-desc', label: 'Newest first' },
  { value: 'due-asc', label: 'Earliest due' },
  { value: 'priority-desc', label: 'Highest priority' },
  { value: 'title-asc', label: 'Title A-Z' },
]

const EMPTY_FORM = toTaskFormValues(null)

type TaskWithCalendarLinks = Task & {
  calendarLinks?: Array<PlanningItemCalendarLinkView>
}

function TasksPage() {
  const queryClient = useQueryClient()
  const { data: tasks } = useSuspenseQuery(tasksQueryOptions())
  const [filter, setFilter] = useState<TaskFilter>('active')
  const [sort, setSort] = useState<TaskSort>('due-asc')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [formValues, setFormValues] = useState<TaskFormValues>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof TaskFormValues, string>>>({})
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    if (!feedbackMessage) return
    const timer = setTimeout(() => {
      setFeedbackMessage(null)
      setFeedbackTone(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [feedbackMessage])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortButtonRef = useRef<HTMLButtonElement>(null)
  const [sortMenuPos, setSortMenuPos] = useState<{ top: number; left: number } | null>(null)
  const chipScrollRef = useRef<HTMLDivElement>(null)
  const [chipScrollLeft, setChipScrollLeft] = useState(0)

  useEffect(() => {
    const el = chipScrollRef.current
    if (!el) return
    const onScroll = () => setChipScrollLeft(el.scrollLeft)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  function openSortMenu() {
    if (sortButtonRef.current) {
      const rect = sortButtonRef.current.getBoundingClientRect()
      setSortMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    setShowSortMenu(true)
  }

  const groupedTasks = groupActiveTasks(tasks)
  const filteredTasks = sortTasks(applyTaskFilter(tasks, filter), sort)
  const summary = getTaskSummary(tasks)

  const invalidateTasks = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  const saveTaskMutation = useMutation({
    mutationFn: async (values: TaskFormValues) => {
      const parsed = taskFormSchema.parse(values)

      if (editingTask) {
        await updateTask({ data: { id: editingTask.id, ...parsed } })
      } else {
        await createTask({ data: parsed })
      }
    },
    onSuccess: async () => {
      setFormValues(EMPTY_FORM)
      setEditingTask(null)
      setFormError(null)
      setFieldErrors({})
      setShowAdvanced(false)
      setShowForm(false)
      setFeedbackTone('success')
      setFeedbackMessage(editingTask ? 'Task updated.' : 'Task created.')
      setActiveTaskId(null)
      await invalidateTasks()
    },
    onError: (error) => {
      if (error instanceof z.ZodError) {
        const flattened = error.flatten().fieldErrors
        setFieldErrors({
          title: flattened.title?.[0],
          notes: flattened.notes?.[0],
          priority: flattened.priority?.[0],
          dueDate: flattened.dueDate?.[0],
          dueTime: flattened.dueTime?.[0],
          reminderAt: flattened.reminderAt?.[0],
          estimatedMinutes: flattened.estimatedMinutes?.[0],
          preferredStartTime: flattened.preferredStartTime?.[0],
          preferredEndTime: flattened.preferredEndTime?.[0],
        })
        setFormError('Fix the highlighted fields and try again.')
      } else {
        setFormError(error instanceof Error ? error.message : 'Failed to save task')
      }

      setFeedbackTone('error')
      setFeedbackMessage('Task save failed.')
      setActiveTaskId(null)
    },
  })

  const completeTaskMutation = useMutation({
    mutationFn: async (task: Task) => {
      setActiveTaskId(task.id)

      if (isTaskCompleted(task)) {
        await reopenTask({ data: { id: task.id } })
      } else {
        await completeTask({ data: { id: task.id } })
      }
    },
    onSuccess: async () => {
      setActiveTaskId(null)
      setFeedbackTone('success')
      setFeedbackMessage('Task status updated.')
      await invalidateTasks()
    },
    onError: () => {
      setFeedbackTone('error')
      setFeedbackMessage('Task status update failed.')
      setActiveTaskId(null)
    },
  })

  const archiveTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      setActiveTaskId(taskId)
      return archiveTask({ data: { id: taskId } })
    },
    onSuccess: async () => {
      if (editingTask) {
        setEditingTask(null)
        setFormValues(EMPTY_FORM)
      }

      setActiveTaskId(null)
      setFeedbackTone('success')
      setFeedbackMessage('Task archived.')
      await invalidateTasks()
    },
    onError: () => {
      setFeedbackTone('error')
      setFeedbackMessage('Task archive failed.')
      setActiveTaskId(null)
    },
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setActiveTaskId(editingTask?.id ?? 'new-task')
    saveTaskMutation.mutate(formValues)
  }

  function handleChange<K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) {
    setFieldErrors((current) => {
      if (!current[key]) {
        return current
      }

      return {
        ...current,
        [key]: undefined,
      }
    })

    setFormValues((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function beginEdit(task: Task) {
    setEditingTask(task)
    setFormValues(toTaskFormValues(task))
    setFormError(null)
    setFieldErrors({})
    setFeedbackMessage(null)
    setFeedbackTone(null)
    const hasSecondary = !!(
      task.notes ||
      task.dueTime ||
      task.reminderAt ||
      task.estimatedMinutes ||
      task.preferredStartTime
    )
    setShowAdvanced(hasSecondary)
    setShowForm(true)
  }

  function resetForm() {
    setEditingTask(null)
    setFormValues(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowAdvanced(false)
    setShowForm(false)
  }

  return (
    <main className="page-wrap px-4 pb-28 pt-10 lg:pb-10">
      <section className="hero-panel rounded-[2rem] px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="display-title text-3xl font-bold text-[var(--ink-strong)]">Tasks</h1>

          <div className="grid grid-cols-2 gap-y-4 sm:flex sm:flex-wrap sm:items-center">
            {[
              ['Active', summary.active],
              ['Due today', summary.dueToday],
              ['Overdue', summary.overdue],
              ['Completed', summary.completed],
            ].map(([label, value], i) => (
              <div
                key={label as string}
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
            <div className="mb-5 space-y-3">
              {/* Scrollable chip row */}
              <div className="relative">
                <div
                  ref={chipScrollRef}
                  className="flex gap-2 overflow-x-auto pb-0.5"
                  style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {FILTERS.map((option) => {
                    const count = applyTaskFilter(tasks, option.value).length
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
                        <span className={`tabular-nums text-xs ${filter === option.value ? 'opacity-70' : 'opacity-50'}`}>
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
                {/* Right fade to indicate more chips */}
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-10"
                  style={{ background: 'linear-gradient(to right, transparent, var(--surface))' }}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">Sort</span>
                <button
                  ref={sortButtonRef}
                  type="button"
                  onClick={openSortMenu}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] outline-none transition hover:border-[var(--brand)]"
                >
                  {SORTS.find((s) => s.value === sort)?.label}
                  <ChevronDown
                    size={12}
                    className={`shrink-0 transition-transform duration-150 ${showSortMenu ? 'rotate-180' : ''}`}
                  />
                </button>

                {showSortMenu && sortMenuPos
                  ? createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setShowSortMenu(false)}
                        />
                        <div
                          className="fixed z-40 min-w-[11rem] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] py-1.5 shadow-xl"
                          style={{ top: sortMenuPos.top, left: sortMenuPos.left }}
                        >
                          {SORTS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setSort(option.value)
                                setShowSortMenu(false)
                              }}
                              className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface-inset)] ${
                                sort === option.value
                                  ? 'text-[var(--brand)]'
                                  : 'text-[var(--ink-strong)]'
                              }`}
                            >
                              <span aria-hidden="true" className={`text-xs ${sort === option.value ? 'opacity-100' : 'opacity-0'}`}>✓</span>
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </>,
                      document.body,
                    )
                  : null}
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="subpanel rounded-2xl p-6 text-sm leading-7 text-[var(--ink-soft)]">
                No tasks.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={() => beginEdit(task)}
                    onToggleComplete={() => completeTaskMutation.mutate(task)}
                    onArchive={() => archiveTaskMutation.mutate(task.id)}
                    isMutating={activeTaskId === task.id}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <TaskBucket
              title="Overdue"
              tasks={groupedTasks.overdue}
              emptyCopy="None"
            />
            <TaskBucket
              title="Due today"
              tasks={groupedTasks.dueToday}
              emptyCopy="None"
            />
            <TaskBucket
              title="Upcoming"
              tasks={groupedTasks.upcoming}
              emptyCopy="None"
            />
            <TaskBucket
              title="Unscheduled"
              tasks={groupedTasks.unscheduled}
              emptyCopy="None"
            />
          </section>
        </article>
      </section>

      {/* Backdrop */}
      <div
        onClick={resetForm}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${showForm ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
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
                {editingTask ? 'Edit task' : 'New task'}
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
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                    Title
                  </span>
                  <input
                    value={formValues.title}
                    onChange={(event) => handleChange('title', event.target.value)}
                    placeholder="Review roadmap, call the bank, plan tomorrow"
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  />
                  {fieldErrors.title ? (
                    <span className="mt-2 block text-sm font-medium text-red-600">
                      {fieldErrors.title}
                    </span>
                  ) : null}
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                      Due date
                    </span>
                    <input
                      type="date"
                      value={formValues.dueDate ?? ''}
                      onChange={(event) => handleChange('dueDate', event.target.value)}
                      className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                    />
                    {fieldErrors.dueDate ? (
                      <span className="mt-2 block text-sm font-medium text-red-600">
                        {fieldErrors.dueDate}
                      </span>
                    ) : null}
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                      Priority
                    </span>
                    <select
                      value={formValues.priority}
                      onChange={(event) =>
                        handleChange('priority', event.target.value as TaskFormValues['priority'])
                      }
                      className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    {fieldErrors.priority ? (
                      <span className="mt-2 block text-sm font-medium text-red-600">
                        {fieldErrors.priority}
                      </span>
                    ) : null}
                  </label>
                </div>

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

                {showAdvanced ? (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                        Notes
                      </span>
                      <textarea
                        value={formValues.notes ?? ''}
                        onChange={(event) => handleChange('notes', event.target.value)}
                        rows={3}
                        placeholder="Add context or next steps"
                        className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                      />
                      {fieldErrors.notes ? (
                        <span className="mt-2 block text-sm font-medium text-red-600">
                          {fieldErrors.notes}
                        </span>
                      ) : null}
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                          Due time
                        </span>
                        <input
                          type="time"
                          value={formValues.dueTime ?? ''}
                          onChange={(event) => handleChange('dueTime', event.target.value)}
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                        {fieldErrors.dueTime ? (
                          <span className="mt-2 block text-sm font-medium text-red-600">
                            {fieldErrors.dueTime}
                          </span>
                        ) : null}
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                          Reminder
                        </span>
                        <input
                          type="datetime-local"
                          value={formValues.reminderAt ?? ''}
                          onChange={(event) => handleChange('reminderAt', event.target.value)}
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                        {fieldErrors.reminderAt ? (
                          <span className="mt-2 block text-sm font-medium text-red-600">
                            {fieldErrors.reminderAt}
                          </span>
                        ) : null}
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                          Est. min
                        </span>
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          value={formValues.estimatedMinutes ?? ''}
                          onChange={(event) =>
                            handleChange(
                              'estimatedMinutes',
                              event.target.value ? Number(event.target.value) : undefined,
                            )
                          }
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                        {fieldErrors.estimatedMinutes ? (
                          <span className="mt-2 block text-sm font-medium text-red-600">
                            {fieldErrors.estimatedMinutes}
                          </span>
                        ) : null}
                      </label>

                      <div>
                        <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                          Preferred window
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="time"
                            value={formValues.preferredStartTime ?? ''}
                            onChange={(event) =>
                              handleChange('preferredStartTime', event.target.value)
                            }
                            className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                          />
                          <input
                            type="time"
                            value={formValues.preferredEndTime ?? ''}
                            onChange={(event) =>
                              handleChange('preferredEndTime', event.target.value)
                            }
                            className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                          />
                        </div>
                        {(fieldErrors.preferredStartTime ?? fieldErrors.preferredEndTime) ? (
                          <span className="mt-2 block text-sm font-medium text-red-600">
                            {fieldErrors.preferredStartTime ?? fieldErrors.preferredEndTime}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {formError ? (
                  <p className="m-0 text-sm font-medium text-red-600">{formError}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={saveTaskMutation.isPending}
                    className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveTaskMutation.isPending
                      ? 'Saving...'
                      : editingTask
                        ? 'Save changes'
                        : 'Create task'}
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

function TaskCard({
  task,
  onEdit,
  onToggleComplete,
  onArchive,
  isMutating,
}: {
  task: TaskWithCalendarLinks
  onEdit: () => void
  onToggleComplete: () => void
  onArchive: () => void
  isMutating: boolean
}) {
  const completed = isTaskCompleted(task)
  const archived = isTaskArchived(task)
  const isDone = completed || archived

  const priorityDot =
    task.priority === 'high'
      ? 'bg-red-400'
      : task.priority === 'medium'
        ? 'bg-amber-400'
        : 'bg-slate-400'

  return (
    <article className={`subpanel rounded-2xl p-4 transition-opacity ${isDone ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`mt-0.5 size-2 shrink-0 rounded-full ${priorityDot} ${isDone ? 'opacity-50' : ''}`} />
            <h3 className={`m-0 text-sm font-semibold ${isDone ? 'line-through text-[var(--ink-soft)]' : 'text-[var(--ink-strong)]'}`}>
              {task.title}
            </h3>
          </div>

          {task.notes ? (
            <p className="mb-0 ml-4 mt-1.5 text-xs leading-5 text-[var(--ink-soft)]">
              {task.notes}
            </p>
          ) : null}

          <div className="ml-4 mt-2 flex flex-wrap gap-3 text-xs text-[var(--ink-soft)]">
            <span>{getTaskTimingLabel(task)}</span>
            {task.reminderAt ? <span>{getReminderLabel(task)}</span> : null}
            {task.estimatedMinutes ? <span>{task.estimatedMinutes} min</span> : null}
            {task.preferredStartTime && task.preferredEndTime ? (
              <span>
                {task.preferredStartTime}–{task.preferredEndTime}
              </span>
            ) : null}
          </div>

          {task.calendarLinks?.length ? (
            <div className="ml-4 mt-3 flex flex-wrap gap-2">
              {task.calendarLinks.map((link) => {
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
            disabled={isMutating}
            className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {completed ? 'Reopen' : 'Done'}
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={isMutating}
            className="cursor-pointer text-xs font-semibold text-red-500 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Archive
          </button>
        </div>
      </div>
    </article>
  )
}

function TaskBucket({
  title,
  tasks,
  emptyCopy,
}: {
  title: string
  tasks: Array<Task>
  emptyCopy: string
}) {
  return (
    <section className="panel rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">{title}</h3>
        <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">{emptyCopy}</p>
      ) : (
        <ul className="m-0 space-y-3 pl-5 text-sm leading-6 text-[var(--ink-soft)]">
          {tasks.map((task) => (
            <li key={task.id}>
              <span className="font-semibold text-[var(--ink-strong)]">{task.title}</span>
              {' · '}
              {getTaskTimingLabel(task)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
