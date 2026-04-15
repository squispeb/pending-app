import { z } from 'zod'
import { env } from '../lib/env'

const threadEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(['thread_created', 'user_turn_added', 'assistant_question', 'assistant_synthesis', 'stage_changed', 'assistant_failed']),
  createdAt: z.string().min(1),
  summary: z.string().min(1),
  visibleToUser: z.literal(true),
})

const workingIdeaSchema = z.object({
  provisionalTitle: z.string().min(1).nullable(),
  currentSummary: z.string().min(1).nullable(),
  purpose: z.string().min(1).nullable(),
  scope: z.string().min(1).nullable(),
  targetUsers: z.array(z.string().min(1)),
  expectedImpact: z.string().min(1).nullable(),
  researchAreas: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
})

const pendingStructuredActionSchema = z.object({
  proposalId: z.string().min(1),
  action: z.enum(['restructure', 'breakdown', 'convert-to-task']),
  basedOnSnapshotVersion: z.number().int().positive(),
  proposedSummary: z.string().min(1),
  explanation: z.string().min(1),
  taskCreationPayload: z
    .object({
      taskTitle: z.string().min(1),
      taskDescription: z.string(),
      suggestedSteps: z.array(z.string().min(1)).max(10),
    })
    .optional(),
})

const taskCreationPayloadSchema = z.object({
  taskTitle: z.string().min(1),
  taskDescription: z.string(),
  suggestedSteps: z.array(z.string().min(1)).max(10),
})

const threadTurnSchema = z.object({
  turnId: z.string().min(1),
  source: z.literal('text'),
  userMessage: z.string().min(1),
  transcriptLanguage: z.null(),
  state: z.enum(['queued', 'processing', 'streaming', 'completed', 'failed']),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
})

const ideaThreadViewSchema = z.object({
  threadId: z.string().min(1),
  ideaId: z.string().min(1),
  userId: z.string().min(1),
  stage: z.enum(['discovery', 'framing', 'developed']),
  status: z.enum(['idle', 'queued', 'processing', 'streaming', 'failed']),
  activeTurn: threadTurnSchema.nullable(),
  queuedTurns: z.array(threadTurnSchema),
  lastTurn: threadTurnSchema.nullable(),
  visibleEvents: z.array(threadEventSchema),
  workingIdea: workingIdeaSchema,
  pendingStructuredAction: pendingStructuredActionSchema.nullable().optional(),
})

const resolveIdeaThreadResponseSchema = ideaThreadViewSchema

const getIdeaThreadResponseSchema = ideaThreadViewSchema

const elaborateIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('proposal_created'),
  thread: ideaThreadViewSchema,
  proposal: z.object({
    explanation: z.string().min(1),
  }),
})

const improveIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('proposal_created'),
  action: z.enum(['title', 'summary']),
  thread: ideaThreadViewSchema,
  proposal: z.object({
    explanation: z.string().min(1),
  }),
})

const transformIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('proposal_created'),
  action: z.enum(['restructure', 'breakdown', 'convert-to-task']),
  thread: ideaThreadViewSchema,
  proposal: z.object({
    explanation: z.string().min(1),
    taskProposal: taskCreationPayloadSchema.optional(),
  }),
})

const submitDiscoveryTurnResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('accepted'),
  turnId: z.string().min(1),
  state: z.enum(['processing', 'queued']),
  queueDepth: z.number().int().nonnegative(),
  thread: ideaThreadViewSchema,
})

const approveIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('approved'),
  thread: ideaThreadViewSchema,
  canonicalWritePayload: z.object({
    ideaId: z.string().min(1),
    expectedSnapshotVersion: z.number().int().positive(),
    title: z.string().min(1),
    body: z.string(),
    threadSummary: z.string().nullable(),
  }),
  threadEventId: z.string().min(1),
})

const rejectIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('rejected'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
})

const acceptStructuredActionResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('accepted'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
  taskCreationPayload: taskCreationPayloadSchema.optional(),
})

const rejectStructuredActionResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('rejected'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
})

async function parseAssistantResponse(response: Response) {
  const payload = await response.json()

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Assistant service request failed'
    throw new Error(message)
  }

  return payload
}

export async function resolveAssistantIdeaThread(
  input: { ideaId: string; authHeaders: HeadersInit },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ideaId: input.ideaId }),
  })

  const payload = await parseAssistantResponse(response)

  return getIdeaThreadResponseSchema.parse(payload)
}

export async function getAssistantIdeaThread(
  input: { ideaId: string; authHeaders: HeadersInit },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}`, {
    method: 'GET',
    headers,
  })

  const payload = await parseAssistantResponse(response)

  return resolveIdeaThreadResponseSchema.parse(payload)
}

export async function requestIdeaThreadElaboration(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    actionInput: string | null
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/elaborate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      actionInput: input.actionInput,
      currentSnapshotVersion: input.currentSnapshotVersion,
      currentTitle: input.currentTitle,
      currentBody: input.currentBody,
      currentSummary: input.currentSummary,
    }),
  })
  const payload = await parseAssistantResponse(response)

  return elaborateIdeaResponseSchema.parse(payload)
}

async function requestIdeaImprovement(
  path: 'improve-title' | 'improve-summary',
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currentSnapshotVersion: input.currentSnapshotVersion,
      currentTitle: input.currentTitle,
      currentBody: input.currentBody,
      currentSummary: input.currentSummary,
    }),
  })
  const payload = await parseAssistantResponse(response)

  return improveIdeaResponseSchema.parse(payload)
}

export async function requestIdeaThreadTitleImprovement(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  return requestIdeaImprovement('improve-title', input, options)
}

export async function requestIdeaThreadSummaryImprovement(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  return requestIdeaImprovement('improve-summary', input, options)
}

async function requestIdeaTransform(
  path: 'restructure' | 'breakdown' | 'convert-to-task',
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currentSnapshotVersion: input.currentSnapshotVersion,
      currentTitle: input.currentTitle,
      currentBody: input.currentBody,
      currentSummary: input.currentSummary,
    }),
  })
  const payload = await parseAssistantResponse(response)

  return transformIdeaResponseSchema.parse(payload)
}

export async function requestIdeaThreadRestructure(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  return requestIdeaTransform('restructure', input, options)
}

export async function requestIdeaThreadBreakdown(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  return requestIdeaTransform('breakdown', input, options)
}

export async function requestIdeaThreadConvertToTask(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    currentSnapshotVersion: number
    currentTitle: string
    currentBody: string
    currentSummary: string | null
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  return requestIdeaTransform('convert-to-task', input, options)
}

export async function submitIdeaDiscoveryTurn(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    message: string
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/turns`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: input.message }),
  })
  const payload = await parseAssistantResponse(response)

  return submitDiscoveryTurnResponseSchema.parse(payload)
}

export async function streamAssistantIdeaThread(
  input: { ideaId: string; authHeaders: HeadersInit; lastEventId?: string | null },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('accept', 'text/event-stream')

  if (input.lastEventId) {
    headers.set('last-event-id', input.lastEventId)
  }

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/stream`, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    const payload = await parseAssistantResponse(response)
    throw new Error(typeof payload === 'object' && payload && 'message' in payload ? String(payload.message) : 'Assistant stream request failed')
  }

  if (!response.body) {
    throw new Error('Assistant stream did not return a response body')
  }

  return response
}

export async function approveIdeaThreadProposal(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    proposalId: string
    expectedSnapshotVersion: number
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      proposalId: input.proposalId,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
    }),
  })
  const payload = await parseAssistantResponse(response)

  return approveIdeaResponseSchema.parse(payload)
}

export async function rejectIdeaThreadProposal(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    proposalId: string
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/reject`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      proposalId: input.proposalId,
    }),
  })
  const payload = await parseAssistantResponse(response)

  return rejectIdeaResponseSchema.parse(payload)
}

export async function acceptIdeaThreadStructuredAction(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    proposalId: string
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/accept-structured`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ proposalId: input.proposalId }),
  })
  const payload = await parseAssistantResponse(response)

  return acceptStructuredActionResponseSchema.parse(payload)
}

export async function rejectIdeaThreadStructuredAction(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    proposalId: string
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/reject-structured`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ proposalId: input.proposalId }),
  })
  const payload = await parseAssistantResponse(response)

  return rejectStructuredActionResponseSchema.parse(payload)
}
