import type { Database } from '../db/client'
import { resolveAssistantIdeaThread } from './assistant-service-client'
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
  }
}
