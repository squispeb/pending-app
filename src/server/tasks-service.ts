import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { tasks } from '../db/schema'
import {
  normalizeTaskValuesForStorage,
  taskCreateSchema,
  taskUpdateSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../lib/tasks'
import { ensureDefaultUser } from './default-user'
import { listPlanningItemCalendarLinks } from './planning-item-calendar-links'

export function createTasksService(database: Database) {
  return {
    ensureDefaultUser: () => ensureDefaultUser(database),
    async listTasks() {
      const user = await ensureDefaultUser(database)

      return database.query.tasks.findMany({
        where: and(eq(tasks.userId, user.id), isNull(tasks.archivedAt)),
        orderBy: [desc(tasks.completedAt), desc(tasks.createdAt)],
      })
    },
    async listTasksWithCalendarLinks(now = new Date()) {
      const user = await ensureDefaultUser(database)
      const rows = await database.query.tasks.findMany({
        where: and(eq(tasks.userId, user.id), isNull(tasks.archivedAt)),
        orderBy: [desc(tasks.completedAt), desc(tasks.createdAt)],
      })
      const linksByTaskId = await listPlanningItemCalendarLinks(database, {
        userId: user.id,
        sourceType: 'task',
        sourceIds: rows.map((task) => task.id),
        now,
      })

      return rows.map((task) => ({
        ...task,
        calendarLinks: linksByTaskId.get(task.id) ?? [],
      }))
    },
    async createTask(input: CreateTaskInput) {
      const data = taskCreateSchema.parse(input)
      const user = await ensureDefaultUser(database)
      const now = new Date()
      const id = crypto.randomUUID()

      await database.insert(tasks).values({
        id,
        userId: user.id,
        ...normalizeTaskValuesForStorage(data),
        updatedAt: now,
        createdAt: now,
      })

      return { ok: true as const, id }
    },
    async updateTask(input: UpdateTaskInput) {
      const data = taskUpdateSchema.parse(input)
      const user = await ensureDefaultUser(database)

      await database
        .update(tasks)
        .set({
          ...normalizeTaskValuesForStorage(data),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, data.id),
            eq(tasks.userId, user.id),
            isNull(tasks.archivedAt),
          ),
        )

      return { ok: true as const }
    },
    async completeTask(id: string) {
      const user = await ensureDefaultUser(database)

      await database
        .update(tasks)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.archivedAt)))

      return { ok: true as const }
    },
    async reopenTask(id: string) {
      const user = await ensureDefaultUser(database)

      await database
        .update(tasks)
        .set({
          status: 'active',
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.archivedAt)))

      return { ok: true as const }
    },
    async archiveTask(id: string) {
      const user = await ensureDefaultUser(database)

      await database
        .update(tasks)
        .set({
          status: 'archived',
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.archivedAt)))

      return { ok: true as const }
    },
    async deferTaskReminder(id: string, minutes = 30, now = new Date()) {
      const user = await ensureDefaultUser(database)
      const task = await database.query.tasks.findFirst({
        where: and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.archivedAt)),
      })

      if (!task) {
        throw new Error('Task not found')
      }

      const baseTime = task.reminderAt && task.reminderAt.getTime() > now.getTime() ? task.reminderAt : now
      const nextReminder = new Date(baseTime.getTime() + minutes * 60_000)

      await database
        .update(tasks)
        .set({
          reminderAt: nextReminder,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.archivedAt)))

      return { ok: true as const, reminderAt: nextReminder }
    },
  }
}
