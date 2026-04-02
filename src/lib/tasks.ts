import { z } from 'zod'
import type { Task } from '../db/schema'

export const taskStatusSchema = z.enum(['active', 'completed', 'archived'])
export const taskPrioritySchema = z.enum(['low', 'medium', 'high'])

const timeFieldSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/)
  .optional()
  .or(z.literal(''))
  .transform((value) => value || undefined)

const dateFieldSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(''))
  .transform((value) => value || undefined)

const datetimeLocalFieldSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .optional()
  .or(z.literal(''))
  .transform((value) => value || undefined)

export const taskFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120),
    notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .or(z.literal(''))
      .transform((value) => value || undefined),
    priority: taskPrioritySchema.default('medium'),
    dueDate: dateFieldSchema,
    dueTime: timeFieldSchema,
    reminderAt: datetimeLocalFieldSchema,
    estimatedMinutes: z
      .union([z.number().int().positive().max(1440), z.null(), z.undefined()])
      .transform((value) => value ?? undefined),
    preferredStartTime: timeFieldSchema,
    preferredEndTime: timeFieldSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.preferredStartTime && !value.preferredEndTime) || (!value.preferredStartTime && value.preferredEndTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredStartTime'],
        message: 'Preferred start and end time must be set together',
      })
    }

    if (
      value.preferredStartTime &&
      value.preferredEndTime &&
      value.preferredEndTime <= value.preferredStartTime
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredEndTime'],
        message: 'Preferred end time must be later than the start time',
      })
    }

    if (value.reminderAt && !value.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reminderAt'],
        message: 'Set a due date before adding a reminder',
      })
    }
  })

export const taskCreateSchema = taskFormSchema

export const taskUpdateSchema = taskFormSchema.extend({
  id: z.string().min(1),
})

export const taskMutationResultSchema = z.object({
  ok: z.literal(true),
})

export type TaskStatus = z.infer<typeof taskStatusSchema>
export type TaskPriority = z.infer<typeof taskPrioritySchema>
export type TaskFormValues = z.infer<typeof taskFormSchema>
export type CreateTaskInput = z.infer<typeof taskCreateSchema>
export type UpdateTaskInput = z.infer<typeof taskUpdateSchema>

export type TaskFilter =
  | 'active'
  | 'today'
  | 'overdue'
  | 'completed'
  | 'archived'
  | 'high-priority'
  | 'scheduled'
  | 'all'

export type TaskSort = 'created-desc' | 'due-asc' | 'priority-desc' | 'title-asc'

export function getTodayDateString(now = new Date()) {
  return [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, '0'),
    `${now.getDate()}`.padStart(2, '0'),
  ].join('-')
}

export function getCurrentTimeString(now = new Date()) {
  return `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`
}

export function parseLocalDateTime(value?: string | null) {
  if (!value) {
    return undefined
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  return parsed
}

export function toDatetimeLocalValue(value?: Date | null) {
  if (!value) {
    return ''
  }

  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hours = `${value.getHours()}`.padStart(2, '0')
  const minutes = `${value.getMinutes()}`.padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function normalizeTaskValuesForStorage(
  values: Pick<
    TaskFormValues,
    | 'title'
    | 'notes'
    | 'priority'
    | 'dueDate'
    | 'dueTime'
    | 'reminderAt'
    | 'estimatedMinutes'
    | 'preferredStartTime'
    | 'preferredEndTime'
  >,
) {
  return {
    title: values.title,
    notes: values.notes,
    priority: values.priority,
    dueDate: values.dueDate,
    dueTime: values.dueTime,
    reminderAt: parseLocalDateTime(values.reminderAt) ?? null,
    estimatedMinutes: values.estimatedMinutes,
    preferredStartTime: values.preferredStartTime,
    preferredEndTime: values.preferredEndTime,
  }
}

export function isTaskArchived(task: Task) {
  return task.archivedAt !== null
}

export function isTaskCompleted(task: Task) {
  return task.status === 'completed' || task.completedAt !== null
}

export function isTaskDueToday(task: Task, now = new Date()) {
  if (!task.dueDate || isTaskArchived(task) || isTaskCompleted(task)) {
    return false
  }

  return task.dueDate === getTodayDateString(now)
}

export function isTaskOverdue(task: Task, now = new Date()) {
  if (!task.dueDate || isTaskArchived(task) || isTaskCompleted(task)) {
    return false
  }

  const today = getTodayDateString(now)

  if (task.dueDate < today) {
    return true
  }

  if (task.dueDate > today) {
    return false
  }

  if (!task.dueTime) {
    return false
  }

  return task.dueTime < getCurrentTimeString(now)
}

export function getTaskTimingLabel(task: Task) {
  if (!task.dueDate) {
    return 'No due date'
  }

  if (!task.dueTime) {
    return `Due ${task.dueDate}`
  }

  return `Due ${task.dueDate} at ${task.dueTime}`
}

export function getReminderLabel(task: Task) {
  if (!task.reminderAt) {
    return 'No reminder'
  }

  return `Reminder ${toDatetimeLocalValue(task.reminderAt).replace('T', ' ')}`
}

function comparePriority(priority: Task['priority']) {
  switch (priority) {
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
    default:
      return 1
  }
}

export function sortTasks(tasks: Array<Task>, sort: TaskSort) {
  return [...tasks].sort((left, right) => {
    switch (sort) {
      case 'due-asc': {
        const leftKey = `${left.dueDate ?? '9999-99-99'}:${left.dueTime ?? '99:99'}`
        const rightKey = `${right.dueDate ?? '9999-99-99'}:${right.dueTime ?? '99:99'}`

        return leftKey.localeCompare(rightKey)
      }
      case 'priority-desc': {
        const delta = comparePriority(right.priority) - comparePriority(left.priority)
        return delta !== 0 ? delta : left.title.localeCompare(right.title)
      }
      case 'title-asc':
        return left.title.localeCompare(right.title)
      case 'created-desc':
      default:
        return right.createdAt.getTime() - left.createdAt.getTime()
    }
  })
}

export function applyTaskFilter(tasks: Array<Task>, filter: TaskFilter, now = new Date()) {
  switch (filter) {
    case 'active':
      return tasks.filter((task) => !isTaskArchived(task) && !isTaskCompleted(task))
    case 'today':
      return tasks.filter((task) => isTaskDueToday(task, now))
    case 'overdue':
      return tasks.filter((task) => isTaskOverdue(task, now))
    case 'completed':
      return tasks.filter((task) => isTaskCompleted(task) && !isTaskArchived(task))
    case 'archived':
      return tasks.filter((task) => isTaskArchived(task))
    case 'high-priority':
      return tasks.filter(
        (task) =>
          !isTaskArchived(task) && !isTaskCompleted(task) && task.priority === 'high',
      )
    case 'scheduled':
      return tasks.filter(
        (task) =>
          !isTaskArchived(task) &&
          !isTaskCompleted(task) &&
          Boolean(task.dueDate || task.reminderAt),
      )
    case 'all':
    default:
      return tasks
  }
}

export function groupActiveTasks(tasks: Array<Task>, now = new Date()) {
  const activeTasks = tasks.filter(
    (task) => !isTaskArchived(task) && !isTaskCompleted(task),
  )

  return {
    overdue: activeTasks.filter((task) => isTaskOverdue(task, now)),
    dueToday: activeTasks.filter(
      (task) => isTaskDueToday(task, now) && !isTaskOverdue(task, now),
    ),
    upcoming: activeTasks.filter(
      (task) => task.dueDate && task.dueDate > getTodayDateString(now),
    ),
    unscheduled: activeTasks.filter((task) => !task.dueDate),
    completed: tasks.filter(
      (task) => isTaskCompleted(task) && !isTaskArchived(task),
    ),
  }
}

export function getTaskSummary(tasks: Array<Task>, now = new Date()) {
  return {
    active: applyTaskFilter(tasks, 'active', now).length,
    dueToday: applyTaskFilter(tasks, 'today', now).length,
    overdue: applyTaskFilter(tasks, 'overdue', now).length,
    completed: applyTaskFilter(tasks, 'completed', now).length,
  }
}

export function toTaskFormValues(task?: Task | null): TaskFormValues {
  if (!task) {
    return {
      title: '',
      notes: '',
      priority: 'medium',
      dueDate: '',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    }
  }

  return {
    title: task.title,
    notes: task.notes ?? '',
    priority: task.priority as TaskPriority,
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    reminderAt: toDatetimeLocalValue(task.reminderAt),
    estimatedMinutes: task.estimatedMinutes ?? undefined,
    preferredStartTime: task.preferredStartTime ?? '',
    preferredEndTime: task.preferredEndTime ?? '',
  }
}
