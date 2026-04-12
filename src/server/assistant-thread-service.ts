import type { Database } from '../db/client'
import { getAssistantIdeaThread, resolveAssistantIdeaThread } from './assistant-service-client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'

type ResolveIdeaThreadOptions = {
  requestHeaders?: HeadersInit
  fetchImpl?: typeof fetch
  assistantServiceBaseUrl?: string
}

export function createAssistantThreadService(database: Database) {
  const ideasService = createIdeasService(database)

  return {
    async bootstrapIdeaThread(ideaId: string, options?: ResolveIdeaThreadOptions) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const existingThreadRef = await ideasService.getIdeaThreadRef(ideaId, user.id)

      if (existingThreadRef) {
        return {
          threadId: existingThreadRef.threadId,
          initialSnapshotId: existingThreadRef.initialSnapshotId,
          created: false as const,
        }
      }

      const thread = await resolveAssistantIdeaThread(
        {
          ideaId,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )

      const linkage = await ideasService.createInitialSnapshotAndThreadRef(
        {
          ideaId,
          threadId: thread.threadId,
        },
        user.id,
      )

      return {
        threadId: linkage.threadId,
        initialSnapshotId: linkage.snapshotId,
        created: true as const,
      }
    },
    async resolveIdeaThread(ideaId: string, options?: ResolveIdeaThreadOptions) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return resolveAssistantIdeaThread(
        {
          ideaId,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async getIdeaThread(ideaId: string, options?: ResolveIdeaThreadOptions) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return getAssistantIdeaThread(
        {
          ideaId,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
  }
}
