import { z } from 'zod'
import { env } from '../lib/env'

const resolveIdeaThreadResponseSchema = z.object({
  threadId: z.string().min(1),
  ideaId: z.string().min(1),
  userId: z.string().min(1),
  status: z.literal('ready'),
  visibleEvents: z.array(
    z.object({
      eventId: z.string().min(1),
      type: z.enum(['thread_created', 'proposal_created', 'proposal_approved', 'proposal_rejected', 'assistant_failed']),
      createdAt: z.string().min(1),
      summary: z.string().min(1),
      visibleToUser: z.literal(true),
    }),
  ),
})

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

  const payload = await response.json()

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Assistant service request failed'
    throw new Error(message)
  }

  return resolveIdeaThreadResponseSchema.parse(payload)
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

  const payload = await response.json()

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Assistant service request failed'
    throw new Error(message)
  }

  return resolveIdeaThreadResponseSchema.parse(payload)
}
