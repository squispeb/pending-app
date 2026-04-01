import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { tasks, users } from '../db/schema'
import {
  normalizeTaskValuesForStorage,
  taskCreateSchema,
  taskUpdateSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../lib/tasks'

export const DEFAULT_USER = {
  id: 'local-user',
  email: 'local@pending.app',
  displayName: 'Local User',
  timezone: 'UTC',
} as const

export function createTasksService(database: Database) {
  async function ensureDefaultUser() {
    const existing = await database.query.users.findFirst({
      where: eq(users.id, DEFAULT_USER.id),
    })

    if (existing) {
      return existing
    }

    await database.insert(users).values(DEFAULT_USER).onConflictDoNothing()

    const created = await database.query.users.findFirst({
      where: eq(users.id, DEFAULT_USER.id),
    })

    if (!created) {
      throw new Error('Failed to initialize the local user')
    }

    return created
  }

  return {
    ensureDefaultUser,
    async listTasks() {
      const user = await ensureDefaultUser()

      return database.query.tasks.findMany({
        where: and(eq(tasks.userId, user.id), isNull(tasks.archivedAt)),
        orderBy: [desc(tasks.completedAt), desc(tasks.createdAt)],
      })
    },
    async createTask(input: CreateTaskInput) {
      const data = taskCreateSchema.parse(input)
      const user = await ensureDefaultUser()
      const now = new Date()

      await database.insert(tasks).values({
        id: crypto.randomUUID(),
        userId: user.id,
        ...normalizeTaskValuesForStorage(data),
        updatedAt: now,
        createdAt: now,
      })

      return { ok: true as const }
    },
    async updateTask(input: UpdateTaskInput) {
      const data = taskUpdateSchema.parse(input)
      const user = await ensureDefaultUser()

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
      const user = await ensureDefaultUser()

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
      const user = await ensureDefaultUser()

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
      const user = await ensureDefaultUser()

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
  }
}
