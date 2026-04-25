import type { Database } from '../db/client'
import {
  getAssistantSession,
  resolveAssistantTaskEditSession,
  streamAssistantSession,
  submitAssistantSessionTurn,
} from './assistant-service-client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'

type SessionOptions = {
  requestHeaders?: HeadersInit
  fetchImpl?: typeof fetch
  assistantServiceBaseUrl?: string
}

export function createAssistantSessionService(database: Database) {
  return {
    async resolveTaskEditSession(
      input: {
        sessionId?: string
        task: {
          taskId: string
          title: string
          notes?: string | null
          dueDate?: string | null
          dueTime?: string | null
          priority?: 'low' | 'medium' | 'high' | null
        }
        routeIntent?: 'tasks' | 'habits' | 'ideas' | 'auto'
        requestedFields?: Array<'title' | 'description' | 'dueDate' | 'dueTime'>
        activeField?: 'title' | 'description' | 'dueDate' | 'dueTime' | null
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return resolveAssistantTaskEditSession(
        {
          ...input,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async getSession(sessionId: string, options?: SessionOptions) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return getAssistantSession(
        {
          sessionId,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async streamSession(sessionId: string, options?: SessionOptions & { lastEventId?: string | null }) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return streamAssistantSession(
        {
          sessionId,
          authHeaders,
          lastEventId: options?.lastEventId ?? null,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async submitSessionTurn(
      input: {
        sessionId: string
        message: string
        source: 'text' | 'voice'
        transcriptLanguage?: 'es' | 'en' | 'unknown' | null
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return submitAssistantSessionTurn(
        {
          ...input,
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
