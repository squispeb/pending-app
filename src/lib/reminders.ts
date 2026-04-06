import { getTodayDateString, parseLocalDateTime, toDatetimeLocalValue } from './tasks'
import { isHabitCompletedOnDate, isHabitDueOnDate } from './habits'
import type { Habit, HabitCompletion, ReminderEvent, Task } from '../db/schema'

export type ReminderSourceType = 'task' | 'habit'

export type ReminderItem = {
  id: string
  sourceType: ReminderSourceType
  sourceId: string
  title: string
  scheduledFor: Date
  dueNow: boolean
  deliveredInAppAt: Date | null
  deliveredBrowserAt: Date | null
  snoozedUntil: Date | null
  dismissedAt: Date | null
  completedViaReminderAt: Date | null
  timingLabel: string
}

export function getReminderEventId(sourceType: ReminderSourceType, sourceId: string, scheduledFor: Date) {
  return `${sourceType}:${sourceId}:${scheduledFor.toISOString()}`
}

export function getTaskReminderEventPayload(task: Task) {
  if (!task.reminderAt) {
    return null
  }

  return {
    sourceType: 'task' as const,
    sourceId: task.id,
    title: task.title,
    scheduledFor: task.reminderAt,
    timingLabel: `Task reminder ${toDatetimeLocalValue(task.reminderAt).replace('T', ' ')}`,
  }
}

export function getHabitReminderEventPayload(
  habit: Habit,
  completions: Array<HabitCompletion>,
  now = new Date(),
) {
  if (!habit.reminderAt || !isHabitDueOnDate(habit, now)) {
    return null
  }

  const today = getTodayDateString(now)
  if (isHabitCompletedOnDate(habit, completions, today)) {
    return null
  }

  const reminderValue = toDatetimeLocalValue(habit.reminderAt)
  const [datePart, timePart] = reminderValue.split('T')

  if (!timePart) {
    return null
  }

  const scheduledFor = parseLocalDateTime(`${today}T${timePart}`)
  if (!scheduledFor) {
    return null
  }

  return {
    sourceType: 'habit' as const,
    sourceId: habit.id,
    title: habit.title,
    scheduledFor,
    timingLabel: `Habit reminder ${timePart}`,
  }
}

export function toReminderItem(
  payload: {
    sourceType: ReminderSourceType
    sourceId: string
    title: string
    scheduledFor: Date
    timingLabel: string
  },
  existing?: ReminderEvent | null,
  now = new Date(),
): ReminderItem {
  return {
    id: existing?.id ?? getReminderEventId(payload.sourceType, payload.sourceId, payload.scheduledFor),
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    title: payload.title,
    scheduledFor: payload.scheduledFor,
    dueNow: payload.scheduledFor.getTime() <= now.getTime(),
    deliveredInAppAt: existing?.deliveredInAppAt ?? null,
    deliveredBrowserAt: existing?.deliveredBrowserAt ?? null,
    snoozedUntil: existing?.snoozedUntil ?? null,
    dismissedAt: existing?.dismissedAt ?? null,
    completedViaReminderAt: existing?.completedViaReminderAt ?? null,
    timingLabel: payload.timingLabel,
  }
}

export function isReminderVisible(item: ReminderItem, now = new Date()) {
  if (item.dismissedAt || item.completedViaReminderAt) {
    return false
  }

  const effectiveTime = item.snoozedUntil ?? item.scheduledFor
  return effectiveTime.getTime() <= now.getTime()
}
