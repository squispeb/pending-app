import { z } from 'zod'
import type { Habit, HabitCompletion } from '../db/schema'
import { getTodayDateString, parseLocalDateTime, toDatetimeLocalValue } from './tasks'

export const habitCadenceSchema = z.enum(['daily', 'selected_days'])
export const habitWeekdaySchema = z.enum([
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
])

const timeFieldSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/)
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

export const habitFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120),
    cadenceType: habitCadenceSchema.default('daily'),
    cadenceDays: z.array(habitWeekdaySchema).default([]),
    targetCount: z
      .union([z.number().int().positive().max(20), z.null(), z.undefined()])
      .transform((value) => value ?? 1),
    preferredStartTime: timeFieldSchema,
    preferredEndTime: timeFieldSchema,
    reminderAt: datetimeLocalFieldSchema,
  })
  .superRefine((value, ctx) => {
    if (
      (value.preferredStartTime && !value.preferredEndTime) ||
      (!value.preferredStartTime && value.preferredEndTime)
    ) {
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

    if (value.cadenceType === 'selected_days' && value.cadenceDays.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cadenceDays'],
        message: 'Select at least one weekday',
      })
    }
  })

export const habitCreateSchema = habitFormSchema

export const habitUpdateSchema = habitFormSchema.extend({
  id: z.string().min(1),
})

export const habitCompletionSchema = z.object({
  habitId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(getTodayDateString()),
})

export type HabitCadence = z.infer<typeof habitCadenceSchema>
export type HabitWeekday = z.infer<typeof habitWeekdaySchema>
export type HabitFormValues = z.infer<typeof habitFormSchema>
export type CreateHabitInput = z.infer<typeof habitCreateSchema>
export type UpdateHabitInput = z.infer<typeof habitUpdateSchema>

export type HabitFilter = 'active' | 'due-today' | 'completed-today' | 'archived' | 'all'

export function weekdayFromDate(date = new Date()): HabitWeekday {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()] as HabitWeekday
}

export function parseCadenceDays(value?: string | null) {
  if (!value) {
    return [] as Array<HabitWeekday>
  }

  try {
    const parsed = JSON.parse(value)
    return z.array(habitWeekdaySchema).parse(parsed)
  } catch {
    return [] as Array<HabitWeekday>
  }
}

export function serializeCadenceDays(days: Array<HabitWeekday>) {
  return days.length > 0 ? JSON.stringify(days) : null
}

export function normalizeHabitValuesForStorage(values: HabitFormValues) {
  return {
    title: values.title,
    cadenceType: values.cadenceType,
    cadenceDays: serializeCadenceDays(values.cadenceDays),
    targetCount: values.targetCount,
    preferredStartTime: values.preferredStartTime,
    preferredEndTime: values.preferredEndTime,
    reminderAt: parseLocalDateTime(values.reminderAt) ?? null,
  }
}

export function isHabitArchived(habit: Habit) {
  return habit.archivedAt !== null
}

export function isHabitDueOnDate(habit: Habit, date = new Date()) {
  if (isHabitArchived(habit)) {
    return false
  }

  if (habit.cadenceType === 'daily') {
    return true
  }

  return parseCadenceDays(habit.cadenceDays).includes(weekdayFromDate(date))
}

export function isHabitCompletedOnDate(
  habit: Habit,
  completions: Array<HabitCompletion>,
  dateString: string,
) {
  return completions.some(
    (completion) => completion.habitId === habit.id && completion.completionDate === dateString,
  )
}

export function applyHabitFilter(
  habits: Array<Habit>,
  completions: Array<HabitCompletion>,
  filter: HabitFilter,
  now = new Date(),
) {
  const today = getTodayDateString(now)

  switch (filter) {
    case 'active':
      return habits.filter((habit) => !isHabitArchived(habit))
    case 'due-today':
      return habits.filter((habit) => isHabitDueOnDate(habit, now))
    case 'completed-today':
      return habits.filter((habit) => isHabitCompletedOnDate(habit, completions, today))
    case 'archived':
      return habits.filter((habit) => isHabitArchived(habit))
    case 'all':
    default:
      return habits
  }
}

export function getHabitSummary(
  habits: Array<Habit>,
  completions: Array<HabitCompletion>,
  now = new Date(),
) {
  const today = getTodayDateString(now)

  return {
    active: habits.filter((habit) => !isHabitArchived(habit)).length,
    dueToday: habits.filter((habit) => isHabitDueOnDate(habit, now)).length,
    completedToday: habits.filter((habit) => isHabitCompletedOnDate(habit, completions, today))
      .length,
    archived: habits.filter((habit) => isHabitArchived(habit)).length,
  }
}

export function getHabitCadenceLabel(habit: Habit) {
  if (habit.cadenceType === 'daily') {
    return 'Daily'
  }

  const days = parseCadenceDays(habit.cadenceDays)
  return days.length > 0 ? `Selected days: ${days.join(', ')}` : 'Selected days'
}

export function toHabitFormValues(habit?: Habit | null): HabitFormValues {
  if (!habit) {
    return {
      title: '',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    }
  }

  return {
    title: habit.title,
    cadenceType: habit.cadenceType as HabitCadence,
    cadenceDays: parseCadenceDays(habit.cadenceDays),
    targetCount: habit.targetCount,
    preferredStartTime: habit.preferredStartTime ?? '',
    preferredEndTime: habit.preferredEndTime ?? '',
    reminderAt: toDatetimeLocalValue(habit.reminderAt),
  }
}
