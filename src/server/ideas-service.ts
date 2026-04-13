import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { ideaSnapshots, ideaThreadRefs, ideas } from '../db/schema'
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
    async createInitialSnapshotAndThreadRef(
      input: {
        ideaId: string
        threadId: string
      },
      userId: string,
    ) {
      const idea = await database.query.ideas.findFirst({
        where: and(eq(ideas.id, input.ideaId), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })

      if (!idea) {
        throw new Error('Idea not found')
      }

      const now = new Date()
      const snapshotId = crypto.randomUUID()

      await database.insert(ideaSnapshots).values({
        id: snapshotId,
        ideaId: idea.id,
        version: 1,
        title: idea.title,
        body: idea.body,
        sourceType: idea.sourceType,
        sourceInput: idea.sourceInput,
        threadSummary: idea.threadSummary,
        createdAt: now,
        updatedAt: now,
      })

      await database.insert(ideaThreadRefs).values({
        id: crypto.randomUUID(),
        ideaId: idea.id,
        threadId: input.threadId,
        initialSnapshotId: snapshotId,
        createdAt: now,
        updatedAt: now,
      })

      return {
        snapshotId,
        threadId: input.threadId,
      }
    },
    async getIdeaThreadRef(ideaId: string, userId: string) {
      const idea = await database.query.ideas.findFirst({
        where: and(eq(ideas.id, ideaId), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })

      if (!idea) {
        return undefined
      }

      return database.query.ideaThreadRefs.findFirst({
        where: eq(ideaThreadRefs.ideaId, ideaId),
      })
    },
    async getLatestIdeaSnapshot(ideaId: string, userId: string) {
      const idea = await database.query.ideas.findFirst({
        where: and(eq(ideas.id, ideaId), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })

      if (!idea) {
        return undefined
      }

      const snapshots = await database.query.ideaSnapshots.findMany({
        where: eq(ideaSnapshots.ideaId, ideaId),
        orderBy: [desc(ideaSnapshots.version)],
        limit: 1,
      })

      return snapshots[0]
    },
    async applyApprovedProposal(
      input: {
        ideaId: string
        expectedSnapshotVersion: number
        title: string
        body: string
        threadSummary: string | null
      },
      userId: string,
    ) {
      const idea = await database.query.ideas.findFirst({
        where: and(eq(ideas.id, input.ideaId), eq(ideas.userId, userId), isNull(ideas.archivedAt)),
      })

      if (!idea) {
        throw new Error('Idea not found')
      }

      const latestSnapshot = await this.getLatestIdeaSnapshot(input.ideaId, userId)

      if (!latestSnapshot) {
        throw new Error('Accepted snapshot not found')
      }

      if (latestSnapshot.version !== input.expectedSnapshotVersion) {
        throw new Error('Idea snapshot conflict')
      }

      const now = new Date()
      const nextVersion = latestSnapshot.version + 1
      const snapshotId = crypto.randomUUID()

      await database.insert(ideaSnapshots).values({
        id: snapshotId,
        ideaId: idea.id,
        version: nextVersion,
        title: input.title,
        body: input.body,
        sourceType: idea.sourceType,
        sourceInput: idea.sourceInput,
        threadSummary: input.threadSummary,
        createdAt: now,
        updatedAt: now,
      })

      await database
        .update(ideas)
        .set({
          title: input.title,
          body: input.body,
          threadSummary: input.threadSummary,
          updatedAt: now,
        })
        .where(and(eq(ideas.id, idea.id), eq(ideas.userId, userId), isNull(ideas.archivedAt)))

      return {
        snapshotId,
        version: nextVersion,
      }
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
