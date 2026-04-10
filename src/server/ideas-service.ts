import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { ideas } from '../db/schema'
import {
  ideaCreateSchema,
  normalizeIdeaValuesForStorage,
  sortIdeas,
  type CreateIdeaInput,
} from '../lib/ideas'

export function createIdeasService(database: Database) {
  return {
    async listIdeas(userId: string) {
      const rows = await database.query.ideas.findMany({
        where: and(eq(ideas.userId, userId), isNull(ideas.archivedAt)),
        orderBy: [desc(ideas.starredAt), desc(ideas.updatedAt)],
      })

      return sortIdeas(rows)
    },
    async getIdea(id: string, userId: string) {
      return database.query.ideas.findFirst({
        where: and(eq(ideas.id, id), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })
    },
    async createIdea(userId: string, input: CreateIdeaInput) {
      const data = ideaCreateSchema.parse(input)
      const now = new Date()
      const id = crypto.randomUUID()

      await database.insert(ideas).values({
        id,
        userId,
        ...normalizeIdeaValuesForStorage(data),
        updatedAt: now,
        createdAt: now,
      })

      return { ok: true as const, id }
    },
    async toggleIdeaStar(id: string, userId: string) {
      const existing = await database.query.ideas.findFirst({
        where: and(eq(ideas.id, id), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })

      if (!existing) {
        throw new Error('Idea not found')
      }

      await database
        .update(ideas)
        .set({
          starredAt: existing.starredAt ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(ideas.id, id), eq(ideas.userId, userId), isNull(ideas.archivedAt)))

      return { ok: true as const }
    },
  }
}
