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
import { ensureDefaultUser } from './default-user'

export function createHabitsService(database: Database) {
  return {
    ensureDefaultUser: () => ensureDefaultUser(database),
    async listHabits() {
      const user = await ensureDefaultUser(database)

      return database.query.habits.findMany({
        where: eq(habits.userId, user.id),
        orderBy: [asc(habits.archivedAt), asc(habits.title)],
      })
    },
    async listHabitCompletions(startDate?: string, endDate?: string) {
      const user = await ensureDefaultUser(database)

      const all = await database.query.habitCompletions.findMany({
        where: eq(habitCompletions.userId, user.id),
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
    async createHabit(input: CreateHabitInput) {
      const data = habitCreateSchema.parse(input)
      const user = await ensureDefaultUser(database)
      const now = new Date()

      await database.insert(habits).values({
        id: crypto.randomUUID(),
        userId: user.id,
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

      return { ok: true as const }
    },
    async updateHabit(input: UpdateHabitInput) {
      const data = habitUpdateSchema.parse(input)
      const user = await ensureDefaultUser(database)

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
        .where(and(eq(habits.id, data.id), eq(habits.userId, user.id), isNull(habits.archivedAt)))

      return { ok: true as const }
    },
    async archiveHabit(id: string) {
      const user = await ensureDefaultUser(database)

      await database
        .update(habits)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(habits.id, id), eq(habits.userId, user.id), isNull(habits.archivedAt)))

      return { ok: true as const }
    },
    async completeHabitForDate(input: { habitId: string; date?: string }) {
      const data = habitCompletionSchema.parse(input)
      const user = await ensureDefaultUser(database)
      const existing = await database.query.habitCompletions.findFirst({
        where: and(
          eq(habitCompletions.userId, user.id),
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
        userId: user.id,
        completionDate: data.date,
        completedAt: now,
        createdAt: now,
      })

      return { ok: true as const }
    },
    async uncompleteHabitForDate(input: { habitId: string; date?: string }) {
      const data = habitCompletionSchema.parse(input)
      const user = await ensureDefaultUser(database)

      await database
        .delete(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, user.id),
            eq(habitCompletions.habitId, data.habitId),
            eq(habitCompletions.completionDate, data.date),
          ),
        )

      return { ok: true as const }
    },
  }
}
