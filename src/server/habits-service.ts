import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { habitCompletions, habits } from '../db/schema'
import {
  habitCompletionSchema,
  habitCreateSchema,
  habitUpdateSchema,
  type CreateHabitInput,
  type UpdateHabitInput,
} from '../lib/habits'
import { listPlanningItemCalendarLinks } from './planning-item-calendar-links'

export function createHabitsService(database: Database) {
  return {
    async listHabits(userId: string) {
      return database.query.habits.findMany({
        where: eq(habits.userId, userId),
        orderBy: [asc(habits.archivedAt), asc(habits.title)],
      })
    },
    async listHabitsWithCalendarLinks(userId: string, now = new Date()) {
      const rows = await database.query.habits.findMany({
        where: eq(habits.userId, userId),
        orderBy: [asc(habits.archivedAt), asc(habits.title)],
      })
      const linksByHabitId = await listPlanningItemCalendarLinks(database, {
        userId,
        sourceType: 'habit',
        sourceIds: rows.map((habit) => habit.id),
        now,
      })

      return rows.map((habit) => ({
        ...habit,
        calendarLinks: linksByHabitId.get(habit.id) ?? [],
      }))
    },
    async listHabitCompletions(userId: string, startDate?: string, endDate?: string) {
      const all = await database.query.habitCompletions.findMany({
        where: eq(habitCompletions.userId, userId),
        orderBy: [desc(habitCompletions.completionDate)],
      })

      if (!startDate && !endDate) {
        return all
      }

      return all.filter((completion) => {
        if (startDate && completion.completionDate < startDate) {
          return false
        }

        if (endDate && completion.completionDate > endDate) {
          return false
        }

        return true
      })
    },
    async createHabit(userId: string, input: CreateHabitInput) {
      const data = habitCreateSchema.parse(input)
      const now = new Date()
      const id = crypto.randomUUID()

      await database.insert(habits).values({
        id,
        userId,
        title: data.title,
        cadenceType: data.cadenceType,
        cadenceDays: data.cadenceDays.length > 0 ? JSON.stringify(data.cadenceDays) : null,
        targetCount: data.targetCount,
        preferredStartTime: data.preferredStartTime,
        preferredEndTime: data.preferredEndTime,
        reminderAt: data.reminderAt ? new Date(data.reminderAt) : null,
        createdAt: now,
        updatedAt: now,
      })

      return { ok: true as const, id }
    },
    async updateHabit(userId: string, input: UpdateHabitInput) {
      const data = habitUpdateSchema.parse(input)

      await database
        .update(habits)
        .set({
          title: data.title,
          cadenceType: data.cadenceType,
          cadenceDays: data.cadenceDays.length > 0 ? JSON.stringify(data.cadenceDays) : null,
          targetCount: data.targetCount,
          preferredStartTime: data.preferredStartTime,
          preferredEndTime: data.preferredEndTime,
          reminderAt: data.reminderAt ? new Date(data.reminderAt) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(habits.id, data.id), eq(habits.userId, userId), isNull(habits.archivedAt)))

      return { ok: true as const }
    },
    async archiveHabit(id: string, userId: string) {
      await database
        .update(habits)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(habits.id, id), eq(habits.userId, userId), isNull(habits.archivedAt)))

      return { ok: true as const }
    },
    async completeHabitForDate(userId: string, input: { habitId: string; date?: string }) {
      const data = habitCompletionSchema.parse(input)
      const habit = await database.query.habits.findFirst({
        where: and(eq(habits.id, data.habitId), eq(habits.userId, userId), isNull(habits.archivedAt)),
      })

      if (!habit) {
        throw new Error('Habit not found')
      }

      const existing = await database.query.habitCompletions.findFirst({
        where: and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.habitId, data.habitId),
          eq(habitCompletions.completionDate, data.date),
        ),
      })

      if (existing) {
        return { ok: true as const }
      }

      const now = new Date()

      await database.insert(habitCompletions).values({
        id: crypto.randomUUID(),
        habitId: data.habitId,
        userId,
        completionDate: data.date,
        completedAt: now,
        createdAt: now,
      })

      return { ok: true as const }
    },
    async uncompleteHabitForDate(userId: string, input: { habitId: string; date?: string }) {
      const data = habitCompletionSchema.parse(input)
      const habit = await database.query.habits.findFirst({
        where: and(eq(habits.id, data.habitId), eq(habits.userId, userId), isNull(habits.archivedAt)),
      })

      if (!habit) {
        throw new Error('Habit not found')
      }

      await database
        .delete(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, userId),
            eq(habitCompletions.habitId, data.habitId),
            eq(habitCompletions.completionDate, data.date),
          ),
        )

      return { ok: true as const }
    },
  }
}
