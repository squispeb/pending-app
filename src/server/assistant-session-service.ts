import type { Database } from '../db/client'
import {
  getAssistantSession,
  resolveAssistantCalendarEventCreateSession,
  resolveAssistantCalendarEventCancelSession,
  resolveAssistantCalendarEventEditSession,
  resolveAssistantCalendarEventTarget,
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
        currentDate: string
        timezone: string
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
    async resolveCalendarEventCreateSession(
      input: {
        sessionId?: string
        currentDate: string
        timezone: string
        draft: {
          title?: string | null
          description?: string | null
          startDate?: string | null
          startTime?: string | null
          endDate?: string | null
          endTime?: string | null
          location?: string | null
          allDay?: boolean | null
          targetCalendarId?: string | null
          targetCalendarName?: string | null
        }
        writableCalendars?: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
        routeIntent?: 'tasks' | 'habits' | 'ideas' | 'auto'
        requestedFields?: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location'>
        activeField?: 'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | null
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return resolveAssistantCalendarEventCreateSession(
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
    async resolveCalendarEventEditSession(
      input: {
        sessionId?: string
        currentDate: string
        timezone: string
        target: { eventId: string; summary: string; calendarName?: string | null }
        draft: {
          title?: string | null
          description?: string | null
          startDate?: string | null
          startTime?: string | null
          endDate?: string | null
          endTime?: string | null
          location?: string | null
          allDay?: boolean | null
          targetCalendarId?: string | null
          targetCalendarName?: string | null
        }
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return resolveAssistantCalendarEventEditSession(
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
    async resolveCalendarEventCancelSession(
      input: {
        sessionId?: string
        currentDate: string
        timezone: string
        target: { eventId: string; summary: string; calendarName?: string | null }
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return resolveAssistantCalendarEventCancelSession(
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
    async resolveCalendarEventTarget(
      input: {
        transcript: string
        transcriptLanguage: 'es' | 'en' | 'unknown' | null
        currentDate: string
        timezone: string
        visibleCalendarEventWindow?: Array<{
          calendarEventId: string
          summary: string
          startsAt: string | null
          endsAt: string | null
          allDay: boolean
          calendarName: string
          primaryFlag: boolean
        }>
      },
      options?: SessionOptions,
    ) {
      const { authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })

      return resolveAssistantCalendarEventTarget(
        {
          transcript: input.transcript,
          transcriptLanguage: input.transcriptLanguage,
          currentDate: input.currentDate,
          timezone: input.timezone,
          visibleCalendarEventWindow: (input.visibleCalendarEventWindow ?? []).map((event) => ({
            eventId: event.calendarEventId,
            summary: event.summary,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            calendarName: event.calendarName,
            primaryFlag: event.primaryFlag,
          })),
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
        context?: {
          writableCalendars?: Array<{
            calendarId: string
            calendarName: string
            primaryFlag: boolean
          }>
          target?: {
            kind: 'calendar_event'
            id?: string
            label: string
          } | null
        }
        workflow?: {
          kind: 'calendar_event'
          operation: 'create'
          phase?: 'collecting' | 'ready_to_confirm' | 'completed' | 'blocked'
          currentDate?: string
          timezone?: string
          draft?: {
            targetCalendarId?: string | null
            targetCalendarName?: string | null
          }
          requestedFields?: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location'>
          missingFields?: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location'>
          activeField?: 'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | null
          fieldAttempts?: {
            title: number
            description: number
            startDate: number
            startTime: number
            endDate: number
            endTime: number
            location: number
          }
          changes?: {
            targetCalendarId?: string | null
            targetCalendarName?: string | null
          }
          result?: null
        }
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
