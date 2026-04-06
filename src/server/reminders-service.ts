import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { habitCompletions, habits, reminderEvents, tasks } from '../db/schema'
import { ensureDefaultUser } from './default-user'
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

export function createRemindersService(database: Database) {
  return {
    ensureDefaultUser: () => ensureDefaultUser(database),
    async syncReminderEvents(now = new Date()) {
      const user = await ensureDefaultUser(database)
      const today = getTodayDateString(now)

      const [userTasks, userHabits, completions, existingEvents] = await Promise.all([
        database.query.tasks.findMany({ where: eq(tasks.userId, user.id) }),
        database.query.habits.findMany({ where: eq(habits.userId, user.id) }),
        database.query.habitCompletions.findMany({
          where: and(
            eq(habitCompletions.userId, user.id),
            eq(habitCompletions.completionDate, today),
          ),
        }),
        database.query.reminderEvents.findMany({ where: eq(reminderEvents.userId, user.id) }),
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
            userId: user.id,
            sourceType: payload.sourceType,
            sourceId: payload.sourceId,
            scheduledFor: payload.scheduledFor,
            createdAt: nowStamp,
            updatedAt: nowStamp,
          })
        }
      }

      return this.listDueReminders(now)
    },
    async listDueReminders(now = new Date()) {
      const user = await ensureDefaultUser(database)
      const events = await database.query.reminderEvents.findMany({
        where: eq(reminderEvents.userId, user.id),
      })

      const [userTasks, userHabits] = await Promise.all([
        database.query.tasks.findMany({ where: eq(tasks.userId, user.id) }),
        database.query.habits.findMany({ where: eq(habits.userId, user.id) }),
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
            eq(habitCompletions.userId, user.id),
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
    async snoozeReminder(id: string, minutes = 15) {
      const nextTime = new Date(Date.now() + minutes * 60_000)
      await database
        .update(reminderEvents)
        .set({ snoozedUntil: nextTime, updatedAt: new Date() })
        .where(eq(reminderEvents.id, id))

      return { ok: true as const }
    },
    async dismissReminder(id: string) {
      await database
        .update(reminderEvents)
        .set({ dismissedAt: new Date(), updatedAt: new Date() })
        .where(eq(reminderEvents.id, id))

      return { ok: true as const }
    },
    async markReminderDelivered(id: string, channel: 'in-app' | 'browser') {
      await database
        .update(reminderEvents)
        .set(
          channel === 'browser'
            ? { deliveredBrowserAt: new Date(), updatedAt: new Date() }
            : { deliveredInAppAt: new Date(), updatedAt: new Date() },
        )
        .where(eq(reminderEvents.id, id))

      return { ok: true as const }
    },
    async completeReminder(id: string) {
      await database
        .update(reminderEvents)
        .set({ completedViaReminderAt: new Date(), updatedAt: new Date() })
        .where(eq(reminderEvents.id, id))

      return { ok: true as const }
    },
  }
}
