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

const ideaThreadViewSchema = z.object({
  threadId: z.string().min(1),
  ideaId: z.string().min(1),
  userId: z.string().min(1),
  stage: z.enum(['discovery', 'framing', 'developed']),
  status: z.enum(['idle', 'processing', 'streaming', 'failed']),
  visibleEvents: z.array(threadEventSchema),
  workingIdea: workingIdeaSchema,
})

const resolveIdeaThreadResponseSchema = z.object({
  threadId: z.string().min(1),
  ideaId: z.string().min(1),
  userId: z.string().min(1),
  stage: z.enum(['discovery', 'framing', 'developed']),
  status: z.enum(['idle', 'processing', 'streaming', 'failed']),
  visibleEvents: z.array(threadEventSchema),
  workingIdea: workingIdeaSchema,
})

const getIdeaThreadResponseSchema = ideaThreadViewSchema

const elaborateIdeaResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('proposal_created'),
  thread: ideaThreadViewSchema,
  proposal: z.object({
    explanation: z.string().min(1),
  }),
})

const submitDiscoveryTurnResponseSchema = z.object({
  ok: z.literal(true),
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
