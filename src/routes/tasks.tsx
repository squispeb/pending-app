import { useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
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
  isTaskCompleted,
  sortTasks,
  taskFormSchema,
  toTaskFormValues,
  type TaskFilter,
  type TaskFormValues,
  type TaskSort,
} from '../lib/tasks'
import { z } from 'zod'
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showForm, setShowForm] = useState(false)

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
    <main className="page-wrap px-4 pb-24 pt-10">
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
              ? 'mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700'
              : 'mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700'
          }
        >
          {feedbackMessage}
        </section>
      ) : null}

      <section className="mt-6 grid gap-6">

        <article className="min-w-0 space-y-6">
          <section className="panel rounded-[1.75rem] p-6 sm:p-8">
            <div className="mb-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-soft)]">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as TaskSort)}
                    className="rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    className={
                      filter === option.value
                        ? 'primary-pill cursor-pointer border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                        : 'secondary-pill cursor-pointer border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                    }
                  >
                    {option.label}
                  </button>
                ))}
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

      {/* Bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ${showForm ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mx-auto w-full max-w-2xl">
          <div className="panel rounded-t-[2rem] px-6 pb-10 pt-3 lg:mb-8 lg:rounded-[2rem]">
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />

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

      {/* Floating action button */}
      <button
        type="button"
        onClick={() => setShowForm(true)}
        aria-label="New task"
        className="fixed bottom-6 right-6 z-30 flex size-14 cursor-pointer items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-lg transition hover:opacity-90 active:scale-95"
      >
        <Plus size={22} />
      </button>
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
  task: Task
  onEdit: () => void
  onToggleComplete: () => void
  onArchive: () => void
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
    <article className="subpanel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`mt-0.5 size-2 shrink-0 rounded-full ${priorityDot}`} />
            <h3 className="m-0 text-sm font-semibold text-[var(--ink-strong)]">
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
