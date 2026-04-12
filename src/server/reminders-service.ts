import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../db/client'
import { habitCompletions, habits, reminderEvents, tasks } from '../db/schema'
import {
  getHabitReminderEventPayload,
  getReminderEventId,
  getTaskReminderEventPayload,
  isReminderVisible,
  toReminderItem,
  type ReminderItem,
  type ReminderSourceType,
} from '../lib/reminders'
import { getTodayDateString } from '../lib/tasks'
import { createTasksService } from './tasks-service'

export function createRemindersService(database: Database) {
  const tasksService = createTasksService(database)

  return {
    async syncReminderEvents(userId: string, now = new Date()) {
      const today = getTodayDateString(now)

      const [userTasks, userHabits, completions, existingEvents] = await Promise.all([
        database.query.tasks.findMany({ where: eq(tasks.userId, userId) }),
        database.query.habits.findMany({ where: eq(habits.userId, userId) }),
        database.query.habitCompletions.findMany({
          where: and(
            eq(habitCompletions.userId, userId),
            eq(habitCompletions.completionDate, today),
          ),
        }),
        database.query.reminderEvents.findMany({ where: eq(reminderEvents.userId, userId) }),
      ])

      const existingMap = new Map(
        existingEvents.map((event) => [
          getReminderEventId(event.sourceType as ReminderSourceType, event.sourceId, event.scheduledFor),
          event,
        ]),
      )

      const taskPayloads = userTasks
        .map((task) => getTaskReminderEventPayload(task))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))

      const habitPayloads = userHabits
        .map((habit) => getHabitReminderEventPayload(habit, completions, now))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))

      const payloads = [...taskPayloads, ...habitPayloads]

      for (const payload of payloads) {
        const key = getReminderEventId(payload.sourceType, payload.sourceId, payload.scheduledFor)
        const existing = existingMap.get(key)

        if (!existing) {
          const nowStamp = new Date()
          await database.insert(reminderEvents).values({
            id: key,
            userId,
            sourceType: payload.sourceType,
            sourceId: payload.sourceId,
            scheduledFor: payload.scheduledFor,
            createdAt: nowStamp,
            updatedAt: nowStamp,
          })
        }
      }

      return this.listDueReminders(userId, now)
    },
    async listDueReminders(userId: string, now = new Date()) {
      const events = await database.query.reminderEvents.findMany({
        where: eq(reminderEvents.userId, userId),
      })

      const [userTasks, userHabits] = await Promise.all([
        database.query.tasks.findMany({ where: eq(tasks.userId, userId) }),
        database.query.habits.findMany({ where: eq(habits.userId, userId) }),
      ])

      const tasksById = new Map(userTasks.map((task) => [task.id, task]))
      const habitsById = new Map(userHabits.map((habit) => [habit.id, habit]))

      const items: Array<ReminderItem> = []

      for (const event of events) {
        if (event.sourceType === 'task') {
          const task = tasksById.get(event.sourceId)
          const payload = task ? getTaskReminderEventPayload(task) : null
          if (!payload) continue
          items.push(toReminderItem(payload, event, now))
          continue
        }

        const habit = habitsById.get(event.sourceId)
        if (!habit) continue

        const completionRows = await database.query.habitCompletions.findMany({
          where: and(
            eq(habitCompletions.userId, userId),
            eq(habitCompletions.habitId, habit.id),
            eq(habitCompletions.completionDate, getTodayDateString(now)),
          ),
        })
        const payload = getHabitReminderEventPayload(habit, completionRows, now)
        if (!payload) continue
        items.push(toReminderItem(payload, event, now))
      }

      return items
        .filter((item) => isReminderVisible(item, now))
        .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime())
    },
    async snoozeReminder(id: string, userId: string, minutes = 15) {
      const nextTime = new Date(Date.now() + minutes * 60_000)
      await database
        .update(reminderEvents)
        .set({ snoozedUntil: nextTime, updatedAt: new Date() })
        .where(and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)))

      return { ok: true as const }
    },
    async dismissReminder(id: string, userId: string) {
      await database
        .update(reminderEvents)
        .set({ dismissedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)))

      return { ok: true as const }
    },
    async deferReminder(id: string, userId: string, minutes = 30) {
      const event = await database.query.reminderEvents.findFirst({
        where: and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)),
      })

      if (!event) {
        throw new Error('Reminder not found')
      }

      if (event.sourceType !== 'task') {
        throw new Error('Only task reminders can be deferred')
      }

      await tasksService.deferTaskReminder(event.sourceId, userId, minutes)

      await database
        .update(reminderEvents)
        .set({ completedViaReminderAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)))

      return { ok: true as const }
    },
    async markReminderDelivered(id: string, userId: string, channel: 'in-app' | 'browser') {
      await database
        .update(reminderEvents)
        .set(
          channel === 'browser'
            ? { deliveredBrowserAt: new Date(), updatedAt: new Date() }
            : { deliveredInAppAt: new Date(), updatedAt: new Date() },
        )
        .where(and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)))

      return { ok: true as const }
    },
    async markRemindersDelivered(ids: Array<string>, userId: string, channel: 'in-app' | 'browser') {
      if (!ids.length) {
        return { ok: true as const }
      }

      await database
        .update(reminderEvents)
        .set(
          channel === 'browser'
            ? { deliveredBrowserAt: new Date(), updatedAt: new Date() }
            : { deliveredInAppAt: new Date(), updatedAt: new Date() },
        )
        .where(and(eq(reminderEvents.userId, userId), inArray(reminderEvents.id, ids)))

      return { ok: true as const }
    },
    async completeReminder(id: string, userId: string) {
      await database
        .update(reminderEvents)
        .set({ completedViaReminderAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reminderEvents.id, id), eq(reminderEvents.userId, userId)))

      return { ok: true as const }
    },
  }
}
