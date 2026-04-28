import { z } from 'zod'
import { env } from '../lib/env'

const assistantSessionChannelSchema = z.enum(['voice', 'text', 'mixed'])
const assistantTranscriptLanguageSchema = z.enum(['es', 'en', 'unknown'])

const assistantSessionTurnSchema = z.object({
  turnId: z.string().min(1),
  source: z.enum(['text', 'voice']),
  userMessage: z.string().min(1),
  transcriptLanguage: assistantTranscriptLanguageSchema.nullable(),
  state: z.enum(['queued', 'processing', 'streaming', 'completed', 'failed']),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
})

const assistantSessionVisibleEventBaseSchema = z.object({
  eventId: z.string().min(1),
  createdAt: z.string().min(1),
  summary: z.string().min(1),
  visibleToUser: z.literal(true),
})

const assistantSessionEventSchema = z.discriminatedUnion('type', [
  assistantSessionVisibleEventBaseSchema.extend({ type: z.literal('session_started') }),
  assistantSessionVisibleEventBaseSchema.extend({ type: z.literal('user_turn_added') }),
  assistantSessionVisibleEventBaseSchema.extend({ type: z.literal('assistant_question') }),
  assistantSessionVisibleEventBaseSchema.extend({ type: z.literal('assistant_synthesis') }),
  assistantSessionVisibleEventBaseSchema.extend({ type: z.literal('assistant_failed') }),
])

const taskEditChangesSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

const calendarEventCreateDraftSchema = z.object({
  title: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  location: z.string().min(1).nullable().optional(),
  allDay: z.boolean().nullable().optional(),
  targetCalendarId: z.string().min(1).nullable().optional(),
  targetCalendarName: z.string().min(1).nullable().optional(),
})

const assistantWritableCalendarSchema = z.object({
  calendarId: z.string().min(1),
  calendarName: z.string().min(1),
  primaryFlag: z.boolean(),
})

const calendarEventCreateWorkflowSchema = z.object({
  kind: z.literal('calendar_event'),
  operation: z.literal('create'),
  phase: z.enum(['collecting', 'ready_to_confirm', 'completed', 'blocked']),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  draft: calendarEventCreateDraftSchema,
  requestedFields: z.array(z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location'])),
  missingFields: z.array(z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location'])),
  activeField: z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location']).nullable(),
  fieldAttempts: z.object({
    title: z.number().int().nonnegative(),
    description: z.number().int().nonnegative(),
    startDate: z.number().int().nonnegative(),
    startTime: z.number().int().nonnegative(),
    endDate: z.number().int().nonnegative(),
    endTime: z.number().int().nonnegative(),
    location: z.number().int().nonnegative(),
  }),
  changes: calendarEventCreateDraftSchema,
  result: z.object({
    outcome: z.enum(['confirmed', 'cancelled']),
    completedAt: z.string().min(1),
    applyPayload: z.object({
      action: z.literal('create_calendar_event'),
      operation: z.literal('create'),
      draft: calendarEventCreateDraftSchema,
    }).nullable(),
  }).nullable(),
})

const calendarEventTargetSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1),
  calendarName: z.string().min(1).nullable().optional(),
})

const calendarEventEditWorkflowSchema = z.object({
  kind: z.literal('calendar_event'),
  operation: z.literal('edit'),
  phase: z.enum(['collecting', 'ready_to_confirm', 'completed', 'blocked']),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  target: calendarEventTargetSchema,
  draft: calendarEventCreateDraftSchema,
  requestedFields: z.array(z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location'])),
  missingFields: z.array(z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location'])),
  activeField: z.enum(['title', 'description', 'startDate', 'startTime', 'endDate', 'endTime', 'location']).nullable(),
  fieldAttempts: z.object({
    title: z.number().int().nonnegative(),
    description: z.number().int().nonnegative(),
    startDate: z.number().int().nonnegative(),
    startTime: z.number().int().nonnegative(),
    endDate: z.number().int().nonnegative(),
    endTime: z.number().int().nonnegative(),
    location: z.number().int().nonnegative(),
  }),
  changes: calendarEventCreateDraftSchema,
  result: z.object({
    outcome: z.enum(['confirmed', 'cancelled']),
    completedAt: z.string().min(1),
    applyPayload: z.object({
      action: z.literal('edit_calendar_event'),
      operation: z.literal('edit'),
      eventId: z.string().min(1),
      edits: calendarEventCreateDraftSchema,
    }).nullable(),
  }).nullable(),
})

const calendarEventCancelWorkflowSchema = z.object({
  kind: z.literal('calendar_event'),
  operation: z.literal('cancel'),
  phase: z.enum(['ready_to_confirm', 'completed', 'blocked']),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  target: calendarEventTargetSchema,
  result: z.object({
    outcome: z.enum(['confirmed', 'cancelled']),
    completedAt: z.string().min(1),
    applyPayload: z.object({
      action: z.literal('cancel_calendar_event'),
      operation: z.literal('cancel'),
      eventId: z.string().min(1),
    }).nullable(),
  }).nullable(),
})

export type AssistantSessionView = z.infer<typeof assistantSessionViewSchema>
export type SubmitAssistantSessionTurnResponse = z.infer<typeof submitAssistantSessionTurnResponseSchema>

const assistantTaskEditWorkflowSchema = z.object({
  kind: z.literal('task_edit'),
  phase: z.enum(['collecting', 'ready_to_confirm', 'completed', 'blocked']),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  task: z.object({
    taskId: z.string().min(1),
    title: z.string().min(1),
    notes: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    dueTime: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  }),
  requestedFields: z.array(z.enum(['title', 'description', 'dueDate', 'dueTime'])),
  missingFields: z.array(z.enum(['title', 'description', 'dueDate', 'dueTime'])),
  activeField: z.enum(['title', 'description', 'dueDate', 'dueTime']).nullable(),
  fieldAttempts: z.object({
    title: z.number().int().nonnegative(),
    description: z.number().int().nonnegative(),
    dueDate: z.number().int().nonnegative(),
    dueTime: z.number().int().nonnegative(),
  }),
  changes: taskEditChangesSchema,
  result: z.object({
    outcome: z.enum(['confirmed', 'cancelled']),
    completedAt: z.string().min(1),
    applyPayload: z.object({
      action: z.literal('edit_task'),
      taskId: z.string().min(1),
      edits: taskEditChangesSchema,
    }).nullable(),
  }).nullable(),
})

const assistantSessionViewSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  channel: assistantSessionChannelSchema,
  status: z.enum(['idle', 'queued', 'processing', 'streaming', 'failed']),
  activeTurn: assistantSessionTurnSchema.nullable(),
  queuedTurns: z.array(assistantSessionTurnSchema),
  lastTurn: assistantSessionTurnSchema.nullable(),
  visibleEvents: z.array(assistantSessionEventSchema),
  context: z.object({
    routeIntent: z.enum(['tasks', 'habits', 'ideas', 'auto']).optional(),
    target: z.object({
      kind: z.enum(['task', 'idea', 'calendar_event', 'general']),
      id: z.string().min(1).optional(),
      label: z.string().min(1),
    }).nullable().optional(),
    writableCalendars: z.array(assistantWritableCalendarSchema).max(25).optional(),
    notes: z.array(z.string().min(1)).max(10).optional(),
  }).nullable(),
  workflow: z.union([assistantTaskEditWorkflowSchema, calendarEventCreateWorkflowSchema, calendarEventEditWorkflowSchema, calendarEventCancelWorkflowSchema]).nullable(),
})

const submitAssistantSessionTurnResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('accepted'),
  turnId: z.string().min(1),
  state: z.enum(['processing', 'queued']),
  queueDepth: z.number().int().nonnegative(),
  session: assistantSessionViewSchema,
})

const visibleThreadEventBaseSchema = z.object({
  eventId: z.string().min(1),
  createdAt: z.string().min(1),
  summary: z.string().min(1),
  visibleToUser: z.literal(true),
})

const threadEventSchema = z.discriminatedUnion('type', [
  visibleThreadEventBaseSchema.extend({ type: z.literal('thread_created') }),
  visibleThreadEventBaseSchema.extend({ type: z.literal('user_turn_added') }),
  visibleThreadEventBaseSchema.extend({ type: z.literal('assistant_question') }),
  visibleThreadEventBaseSchema.extend({ type: z.literal('assistant_synthesis') }),
  visibleThreadEventBaseSchema.extend({ type: z.literal('stage_changed') }),
  visibleThreadEventBaseSchema.extend({ type: z.literal('assistant_failed') }),
  visibleThreadEventBaseSchema.extend({
    type: z.literal('breakdown_plan_recorded'),
    stepCount: z.number().int().positive(),
    steps: z.array(z.string().min(1)).optional(),
  }),
  visibleThreadEventBaseSchema.extend({
    type: z.literal('step_status_changed'),
    stepOrder: z.number().int().positive(),
    status: z.enum(['completed', 'reopened']),
  }),
  visibleThreadEventBaseSchema.extend({
    type: z.literal('task_created'),
    taskId: z.string().min(1),
    stepOrder: z.number().int().positive().optional(),
  }),
])

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
  proposedSteps: z.array(z.string().min(1)).max(5).optional(),
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

const executionSummarySchema = z.object({
  ideaId: z.string().min(1),
  stage: z.enum(['discovery', 'framing', 'developed']),
  latestSnapshot: z
    .object({
      version: z.number().int().positive(),
      title: z.string().min(1),
      threadSummary: z.string().nullable(),
    })
    .nullable(),
  acceptedBreakdownSteps: z.array(
    z.object({
      stepOrder: z.number().int().positive(),
      stepText: z.string().min(1),
      completedAt: z.string().nullable(),
      linkedTaskId: z.string().nullable(),
    }),
  ),
  linkedTasks: z.array(
    z.object({
      taskId: z.string().min(1),
      title: z.string().min(1),
      status: z.string().min(1),
      completedAt: z.string().nullable(),
      linkReason: z.string().nullable(),
      artifactSummaries: z.array(
        z.object({
          artifactId: z.string().min(1),
          artifactType: z.string().min(1),
          source: z.string().min(1),
          summary: z.string(),
        }),
      ),
    }),
  ),
})

export type ExecutionSummary = z.infer<typeof executionSummarySchema>

function formatExecutionSummary(input: ExecutionSummary) {
  const lines: string[] = [
    `Idea ${input.ideaId} is currently in ${input.stage}.`,
  ]

  if (input.latestSnapshot) {
    lines.push(`Latest snapshot v${input.latestSnapshot.version}: ${input.latestSnapshot.title}.`)

    if (input.latestSnapshot.threadSummary) {
      lines.push(`Thread summary: ${input.latestSnapshot.threadSummary}`)
    }
  }

  if (input.acceptedBreakdownSteps.length > 0) {
    lines.push(
      `Accepted breakdown steps: ${input.acceptedBreakdownSteps
        .map((step) => `#${step.stepOrder} ${step.stepText}${step.completedAt ? ' (completed)' : ''}${step.linkedTaskId ? ` [task ${step.linkedTaskId}]` : ''}`)
        .join('; ')}.`,
    )
  }

  if (input.linkedTasks.length > 0) {
    lines.push(
      `Linked tasks: ${input.linkedTasks
        .map((task) => {
          const artifactSummary = task.artifactSummaries[0]?.summary
          return `${task.title} (${task.status}${task.completedAt ? ', completed' : ''}${artifactSummary ? `, latest artifact: ${artifactSummary}` : ''})`
        })
        .join('; ')}.`,
    )
  }

  return lines.join(' ')
}

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
    proposedSteps: z.array(z.string().min(1)).max(5).optional(),
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

const recordTaskCreatedResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('recorded'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
})

const recordProgressUpdateResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('recorded'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
})

const recordBreakdownPlanResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('recorded'),
  thread: ideaThreadViewSchema,
  threadEventId: z.string().min(1),
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
    executionSummary?: ExecutionSummary
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
        ...(input.executionSummary ? { executionSummary: formatExecutionSummary(input.executionSummary) } : {}),
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
    executionSummary?: ExecutionSummary
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
        ...(input.executionSummary ? { executionSummary: formatExecutionSummary(input.executionSummary) } : {}),
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
    executionSummary?: ExecutionSummary
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
    executionSummary?: ExecutionSummary
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
    executionSummary?: ExecutionSummary
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
        ...(input.executionSummary ? { executionSummary: formatExecutionSummary(input.executionSummary) } : {}),
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
    executionSummary?: ExecutionSummary
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
    executionSummary?: ExecutionSummary
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
      body: JSON.stringify({
        message: input.message,
        ...(input.executionSummary ? { executionSummary: formatExecutionSummary(input.executionSummary) } : {}),
      }),
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

export async function streamAssistantSession(
  input: { sessionId: string; authHeaders: HeadersInit; lastEventId?: string | null },
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

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/${input.sessionId}/stream`, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    const payload = await parseAssistantResponse(response)
    throw new Error(typeof payload === 'object' && payload && 'message' in payload ? String(payload.message) : 'Assistant session stream request failed')
  }

  if (!response.body) {
    throw new Error('Assistant session stream did not return a response body')
  }

  return response
}

export async function resolveAssistantTaskEditSession(
  input: {
    sessionId?: string
    authHeaders: HeadersInit
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
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      channel: 'mixed',
      context: {
        ...(input.routeIntent ? { routeIntent: input.routeIntent } : {}),
        target: {
          kind: 'task',
          id: input.task.taskId,
          label: input.task.title,
        },
      },
      workflow: {
        kind: 'task_edit',
        phase: 'collecting',
        currentDate: input.currentDate,
        timezone: input.timezone,
        task: input.task,
        requestedFields: input.requestedFields ?? [],
        missingFields: input.requestedFields ?? [],
        activeField: input.activeField ?? null,
        fieldAttempts: {
          title: 0,
          description: 0,
          dueDate: 0,
          dueTime: 0,
        },
        changes: {},
        result: null,
      },
    }),
  })

  const payload = await parseAssistantResponse(response)
  return assistantSessionViewSchema.parse(payload)
}

export async function resolveAssistantCalendarEventCreateSession(
  input: {
    sessionId?: string
    authHeaders: HeadersInit
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
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      channel: 'mixed',
      context: {
        ...(input.routeIntent ? { routeIntent: input.routeIntent } : {}),
        ...(input.writableCalendars?.length ? { writableCalendars: input.writableCalendars } : {}),
        target: {
          kind: 'calendar_event',
          ...(input.draft.targetCalendarId ? { id: input.draft.targetCalendarId } : {}),
          label: input.draft.targetCalendarName ?? input.draft.title ?? 'Calendar event',
        },
      },
      workflow: {
        kind: 'calendar_event',
        operation: 'create',
        phase: 'collecting',
        currentDate: input.currentDate,
        timezone: input.timezone,
        draft: input.draft,
        requestedFields: input.requestedFields ?? [],
        missingFields: input.requestedFields ?? [],
        activeField: input.activeField ?? null,
        fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
        changes: {},
        result: null,
      },
    }),
  })

  const payload = await parseAssistantResponse(response)
  return assistantSessionViewSchema.parse(payload)
}

export async function resolveAssistantCalendarEventEditSession(
  input: {
    sessionId?: string
    authHeaders: HeadersInit
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
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL
  if (!baseUrl) throw new Error('ASSISTANT_SERVICE_URL is not configured')
  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')
  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      channel: 'mixed',
      context: { target: { kind: 'calendar_event', id: input.target.eventId, label: input.target.summary } },
      workflow: {
        kind: 'calendar_event',
        operation: 'edit',
        phase: 'collecting',
        currentDate: input.currentDate,
        timezone: input.timezone,
        target: { eventId: input.target.eventId, summary: input.target.summary, calendarName: input.target.calendarName ?? null },
        draft: input.draft,
        requestedFields: [],
        missingFields: [],
        activeField: null,
        fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
        changes: {},
        result: null,
      },
    }),
  })
  const payload = await parseAssistantResponse(response)
  return assistantSessionViewSchema.parse(payload)
}

export async function resolveAssistantCalendarEventCancelSession(
  input: {
    sessionId?: string
    authHeaders: HeadersInit
    currentDate: string
    timezone: string
    target: { eventId: string; summary: string; calendarName?: string | null }
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL
  if (!baseUrl) throw new Error('ASSISTANT_SERVICE_URL is not configured')
  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')
  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      channel: 'mixed',
      context: { target: { kind: 'calendar_event', id: input.target.eventId, label: input.target.summary } },
      workflow: {
        kind: 'calendar_event',
        operation: 'cancel',
        phase: 'ready_to_confirm',
        currentDate: input.currentDate,
        timezone: input.timezone,
        target: { eventId: input.target.eventId, summary: input.target.summary, calendarName: input.target.calendarName ?? null },
        result: null,
      },
    }),
  })
  const payload = await parseAssistantResponse(response)
  return assistantSessionViewSchema.parse(payload)
}

export async function getAssistantSession(
  input: { sessionId: string; authHeaders: HeadersInit },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/${input.sessionId}`, {
    method: 'GET',
    headers,
  })

  const payload = await parseAssistantResponse(response)
  return assistantSessionViewSchema.parse(payload)
}

export async function submitAssistantSessionTurn(
  input: {
    sessionId: string
    authHeaders: HeadersInit
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
      operation: 'create' | 'edit' | 'cancel'
      phase?: 'collecting' | 'ready_to_confirm' | 'completed' | 'blocked'
      currentDate?: string
      timezone?: string
      target?: { eventId: string; summary: string; calendarName?: string | null }
      draft?: {
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
      result?: null
    }
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/sessions/${input.sessionId}/turns`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: input.message,
      source: input.source,
      ...(input.transcriptLanguage !== undefined ? { transcriptLanguage: input.transcriptLanguage } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.workflow ? { workflow: input.workflow } : {}),
    }),
  })

  const payload = await parseAssistantResponse(response)
  return submitAssistantSessionTurnResponseSchema.parse(payload)
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

export async function recordTaskCreatedForIdeaThread(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    taskId: string
    summary: string
    stepOrder?: number
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/record-task-created`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskId: input.taskId, summary: input.summary, ...(input.stepOrder ? { stepOrder: input.stepOrder } : {}) }),
  })
  const payload = await parseAssistantResponse(response)

  return recordTaskCreatedResponseSchema.parse(payload)
}

export async function recordProgressUpdateForIdeaThread(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    summary: string
    stepOrder?: number
    status?: 'completed' | 'reopened'
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/record-progress-update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      summary: input.summary,
      ...(input.stepOrder ? { stepOrder: input.stepOrder } : {}),
      ...(input.status ? { status: input.status } : {}),
    }),
  })
  const payload = await parseAssistantResponse(response)

  return recordProgressUpdateResponseSchema.parse(payload)
}

export async function recordBreakdownPlanForIdeaThread(
  input: {
    ideaId: string
    authHeaders: HeadersInit
    summary: string
    stepCount: number
    steps?: string[]
  },
  options?: { fetchImpl?: typeof fetch; baseUrl?: string },
) {
  const baseUrl = options?.baseUrl ?? env.ASSISTANT_SERVICE_URL

  if (!baseUrl) {
    throw new Error('ASSISTANT_SERVICE_URL is not configured')
  }

  const headers = new Headers(input.authHeaders)
  headers.set('content-type', 'application/json')

  const response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/threads/${input.ideaId}/actions/record-breakdown-plan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      summary: input.summary,
      stepCount: input.stepCount,
      ...(input.steps && input.steps.length > 0 ? { steps: input.steps } : {}),
    }),
  })
  const payload = await parseAssistantResponse(response)

  return recordBreakdownPlanResponseSchema.parse(payload)
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
export type GetIdeaThreadResponse = z.infer<typeof getIdeaThreadResponseSchema>
