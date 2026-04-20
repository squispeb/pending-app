import type { Database } from '../db/client'
import {
  acceptIdeaThreadStructuredAction,
  approveIdeaThreadProposal,
  getAssistantIdeaThread,
  requestIdeaThreadBreakdown as requestIdeaThreadBreakdownFromAssistant,
  requestIdeaThreadConvertToTask as requestIdeaThreadConvertToTaskFromAssistant,
  requestIdeaThreadRestructure as requestIdeaThreadRestructureFromAssistant,
  requestIdeaThreadSummaryImprovement as requestIdeaThreadSummaryImprovementFromAssistant,
  requestIdeaThreadTitleImprovement as requestIdeaThreadTitleImprovementFromAssistant,
  rejectIdeaThreadStructuredAction,
  rejectIdeaThreadProposal,
  recordBreakdownPlanForIdeaThread,
  recordProgressUpdateForIdeaThread,
  recordTaskCreatedForIdeaThread,
  requestIdeaThreadElaboration,
  resolveAssistantIdeaThread,
  streamAssistantIdeaThread,
  submitIdeaDiscoveryTurn,
} from './assistant-service-client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'

type IdeasService = ReturnType<typeof createIdeasService>
type ExecutionSummary = Awaited<ReturnType<IdeasService['getExecutionSummary']>>

type ResolveIdeaThreadOptions = {
  requestHeaders?: HeadersInit
  fetchImpl?: typeof fetch
  assistantServiceBaseUrl?: string
}

export function createAssistantThreadService(database: Database) {
  const ideasService = createIdeasService(database)

  async function syncThreadCheckpointIfNeeded(
    ideaId: string,
    userId: string,
    thread: {
      stage: 'discovery' | 'framing' | 'developed'
      lastTurn: { state: 'queued' | 'processing' | 'streaming' | 'completed' | 'failed' } | null
      workingIdea: {
        provisionalTitle: string | null
        currentSummary: string | null
      }
      visibleEvents: Array<{ type: string }>
    },
  ) {
    const latestSnapshot = await ideasService.getLatestIdeaSnapshot(ideaId, userId)

    if (!latestSnapshot || thread.lastTurn?.state !== 'completed') {
      return
    }

    const latestVisibleEvent = thread.visibleEvents.at(-1)?.type

    if (latestVisibleEvent !== 'assistant_question' && latestVisibleEvent !== 'stage_changed') {
      return
    }

    const idea = await ideasService.getIdea(ideaId, userId)

    if (!idea) {
      throw new Error('Idea not found')
    }

    await ideasService.syncIdeaThreadCheckpoint(
      {
        ideaId,
        expectedSnapshotVersion: latestSnapshot.version,
        title: thread.workingIdea.provisionalTitle ?? idea.title,
        body: idea.body,
        threadSummary: thread.workingIdea.currentSummary,
        stage: thread.stage,
      },
      userId,
    )
  }

  async function getExecutionSummary(ideaId: string, userId: string) {
    return ideasService.getExecutionSummary(ideaId, userId)
  }

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

      const thread = await getAssistantIdeaThread(
        {
          ideaId,
          authHeaders,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )

      await syncThreadCheckpointIfNeeded(ideaId, user.id, thread)

      return thread
    },
    async streamIdeaThread(ideaId: string, options?: ResolveIdeaThreadOptions & { lastEventId?: string | null }) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return streamAssistantIdeaThread(
        {
          ideaId,
          authHeaders,
          lastEventId: options?.lastEventId ?? null,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadElaboration(
      ideaId: string,
      input: {
        actionInput: string | null
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadElaboration(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadTitleImprovement(
      ideaId: string,
      input: {
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadTitleImprovementFromAssistant(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadSummaryImprovement(
      ideaId: string,
      input: {
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadSummaryImprovementFromAssistant(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadRestructure(
      ideaId: string,
      input: {
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadRestructureFromAssistant(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadBreakdown(
      ideaId: string,
      input: {
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadBreakdownFromAssistant(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async requestIdeaThreadConvertToTask(
      ideaId: string,
      input: {
        currentSnapshotVersion: number
        currentTitle: string
        currentBody: string
        currentSummary: string | null
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const executionSummary = input.executionSummary ?? (await getExecutionSummary(ideaId, user.id))

      return requestIdeaThreadConvertToTaskFromAssistant(
        {
          ideaId,
          authHeaders,
          ...input,
          executionSummary: executionSummary ?? undefined,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async submitIdeaDiscoveryTurn(
      ideaId: string,
      input: {
        message: string
        executionSummary?: ExecutionSummary
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      const result = await submitIdeaDiscoveryTurn(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )

      return result
    },
    async approveIdeaThreadProposal(
      ideaId: string,
      input: {
        proposalId: string
        expectedSnapshotVersion: number
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return approveIdeaThreadProposal(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async acceptIdeaThreadStructuredAction(
      ideaId: string,
      input: {
        proposalId: string
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return acceptIdeaThreadStructuredAction(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async recordTaskCreatedForIdeaThread(
      ideaId: string,
      input: {
        taskId: string
        summary: string
        stepOrder?: number
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return recordTaskCreatedForIdeaThread(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async recordProgressUpdateForIdeaThread(
      ideaId: string,
      input: {
        summary: string
        stepOrder?: number
        status?: 'completed' | 'reopened'
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return recordProgressUpdateForIdeaThread(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async recordBreakdownPlanForIdeaThread(
      ideaId: string,
      input: {
        summary: string
        stepCount: number
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return recordBreakdownPlanForIdeaThread(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async rejectIdeaThreadProposal(
      ideaId: string,
      input: {
        proposalId: string
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return rejectIdeaThreadProposal(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
    async rejectIdeaThreadStructuredAction(
      ideaId: string,
      input: {
        proposalId: string
      },
      options?: ResolveIdeaThreadOptions,
    ) {
      const { user, authHeaders } = await resolveAuthenticatedPlannerUser(database, {
        requestHeaders: options?.requestHeaders,
        fetchImpl: options?.fetchImpl,
        baseUrl: options?.assistantServiceBaseUrl,
      })
      const idea = await ideasService.getIdea(ideaId, user.id)

      if (!idea) {
        throw new Error('Idea not found')
      }

      return rejectIdeaThreadStructuredAction(
        {
          ideaId,
          authHeaders,
          ...input,
        },
        {
          fetchImpl: options?.fetchImpl,
          baseUrl: options?.assistantServiceBaseUrl,
        },
      )
    },
  }
}
