import { useState } from 'react'
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

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
      setActiveTaskId(null)
      await invalidateTasks()
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Failed to save task')
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
      await invalidateTasks()
    },
    onError: () => {
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
      await invalidateTasks()
    },
    onError: () => {
      setActiveTaskId(null)
    },
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setActiveTaskId(editingTask?.id ?? 'new-task')
    saveTaskMutation.mutate(formValues)
  }

  function handleChange<K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) {
    setFormValues((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function beginEdit(task: Task) {
    setEditingTask(task)
    setFormValues(toTaskFormValues(task))
    setFormError(null)
  }

  function resetForm() {
    setEditingTask(null)
    setFormValues(EMPTY_FORM)
    setFormError(null)
  }

  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="hero-panel rounded-[2rem] px-6 py-8 sm:px-8">
        <p className="island-kicker mb-3">Milestone 1</p>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="display-title mb-3 text-4xl font-bold text-[var(--ink-strong)]">
              Tasks workspace
            </h1>
            <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
              Create, edit, complete, archive, filter, and sort local tasks. This
              is the first real productivity slice and becomes the base for the
              daily dashboard.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Active', summary.active],
              ['Due today', summary.dueToday],
              ['Overdue', summary.overdue],
              ['Completed', summary.completed],
            ].map(([label, value]) => (
              <div key={label} className="subpanel rounded-2xl p-4 text-center">
                <p className="mb-1 text-xs font-semibold tracking-[0.16em] text-[var(--ink-soft)] uppercase">
                  {label}
                </p>
                <p className="m-0 text-2xl font-bold text-[var(--ink-strong)]">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <article className="panel rounded-[1.75rem] p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="island-kicker mb-2">Task editor</p>
              <h2 className="m-0 text-2xl font-semibold text-[var(--ink-strong)]">
                {editingTask ? 'Edit task' : 'Create a task'}
              </h2>
            </div>

            {editingTask ? (
              <button
                type="button"
                onClick={resetForm}
                className="secondary-pill cursor-pointer border-0 text-sm font-semibold"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                Title
              </span>
              <input
                value={formValues.title}
                onChange={(event) => handleChange('title', event.target.value)}
                placeholder="Review roadmap, call the bank, plan tomorrow"
                className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                Notes
              </span>
              <textarea
                value={formValues.notes ?? ''}
                onChange={(event) => handleChange('notes', event.target.value)}
                rows={4}
                placeholder="Add context or next steps"
                className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Priority
                </span>
                <select
                  value={formValues.priority}
                  onChange={(event) =>
                    handleChange('priority', event.target.value as TaskFormValues['priority'])
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Estimated minutes
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
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Due date
                </span>
                <input
                  type="date"
                  value={formValues.dueDate ?? ''}
                  onChange={(event) => handleChange('dueDate', event.target.value)}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Due time
                </span>
                <input
                  type="time"
                  value={formValues.dueTime ?? ''}
                  onChange={(event) => handleChange('dueTime', event.target.value)}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                Reminder
              </span>
              <input
                type="datetime-local"
                value={formValues.reminderAt ?? ''}
                onChange={(event) => handleChange('reminderAt', event.target.value)}
                className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Preferred start
                </span>
                <input
                  type="time"
                  value={formValues.preferredStartTime ?? ''}
                  onChange={(event) => handleChange('preferredStartTime', event.target.value)}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                  Preferred end
                </span>
                <input
                  type="time"
                  value={formValues.preferredEndTime ?? ''}
                  onChange={(event) => handleChange('preferredEndTime', event.target.value)}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                />
              </label>
            </div>

            {formError ? (
              <p className="m-0 text-sm font-medium text-red-600">{formError}</p>
            ) : null}

            <div className="flex flex-wrap gap-3">
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
                className="secondary-pill cursor-pointer border-0 text-sm font-semibold"
              >
                Reset form
              </button>
            </div>
          </form>
        </article>

        <article className="space-y-6">
          <section className="panel rounded-[1.75rem] p-6 sm:p-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="island-kicker mb-2">Task filters</p>
                <h2 className="m-0 text-2xl font-semibold text-[var(--ink-strong)]">
                  Current task list
                </h2>
              </div>

              <div className="flex flex-col gap-3 sm:items-end">
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilter(option.value)}
                      className={
                        filter === option.value
                          ? 'primary-pill cursor-pointer border-0 text-sm font-semibold'
                          : 'secondary-pill cursor-pointer border-0 text-sm font-semibold'
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-soft)]">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as TaskSort)}
                    className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-2 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="subpanel rounded-2xl p-6 text-sm leading-7 text-[var(--ink-soft)]">
                No tasks match the current filter yet.
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
              emptyCopy="Nothing overdue right now."
            />
            <TaskBucket
              title="Due today"
              tasks={groupedTasks.dueToday}
              emptyCopy="No tasks due today yet."
            />
            <TaskBucket
              title="Upcoming"
              tasks={groupedTasks.upcoming}
              emptyCopy="No future-dated tasks yet."
            />
            <TaskBucket
              title="Unscheduled"
              tasks={groupedTasks.unscheduled}
              emptyCopy="Every active task has a due date."
            />
          </section>
        </article>
      </section>
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

  return (
    <article className="subpanel rounded-2xl p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">
              {task.title}
            </h3>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              {task.priority}
            </span>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              {completed ? 'completed' : 'active'}
            </span>
          </div>

          {task.notes ? (
            <p className="mb-0 mt-3 text-sm leading-6 text-[var(--ink-soft)]">{task.notes}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--ink-soft)]">
            <span>{getTaskTimingLabel(task)}</span>
            {task.reminderAt ? <span>{getReminderLabel(task)}</span> : null}
            {task.estimatedMinutes ? <span>{task.estimatedMinutes} min estimate</span> : null}
            {task.preferredStartTime && task.preferredEndTime ? (
              <span>
                Preferred window {task.preferredStartTime}-{task.preferredEndTime}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onToggleComplete}
            disabled={isMutating}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {completed ? 'Reopen' : 'Complete'}
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={isMutating}
            className="secondary-pill cursor-pointer border-0 text-sm font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
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
