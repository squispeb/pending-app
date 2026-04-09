import { env } from '../lib/env'
import type {
  CaptureLanguageHint,
  MatchedCalendarContext,
  TypedTaskDraftProviderOutput,
} from '../lib/capture'
import { typedTaskDraftProviderOutputSchema } from '../lib/capture'
import { logProviderCall, logProviderError } from './provider-logging'

export type CaptureInterpreterRequest = {
  normalizedInput: string
  currentDate: string
  timezone: string
  languageHint?: CaptureLanguageHint
  calendarContext: Array<{
    calendarEventId: string
    summary: string
    calendarName: string
    startsAt: string
    recurring: boolean
    reason: string
  }>
}

export interface CaptureInterpreter {
  interpretTypedTask(
    input: CaptureInterpreterRequest,
  ): Promise<TypedTaskDraftProviderOutput>
}

export class CaptureInterpreterError extends Error {
  code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE'

  constructor(message: string, code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE') {
    super(message)
    this.name = 'CaptureInterpreterError'
    this.code = code
  }
}

type RemoteCaptureInterpreterConfig = {
  url: string
  apiKey?: string
  model?: string
  timeoutMs: number
}

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      refusal?: string | null
    }
  }>
  error?: {
    message?: string
  }
}

const CAPTURE_DRAFT_JSON_SCHEMA = {
  name: 'typed_task_draft',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidateType: {
        type: 'string',
        enum: ['task', 'habit'],
      },
      title: {
        type: ['string', 'null'],
      },
      notes: {
        type: ['string', 'null'],
      },
      dueDate: {
        type: ['string', 'null'],
      },
      dueTime: {
        type: ['string', 'null'],
      },
      priority: {
        type: ['string', 'null'],
        enum: ['low', 'medium', 'high', null],
      },
      estimatedMinutes: {
        type: ['integer', 'null'],
      },
      cadenceType: {
        type: ['string', 'null'],
        enum: ['daily', 'selected_days', null],
      },
      cadenceDays: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        },
      },
      targetCount: {
        type: ['integer', 'null'],
      },
      matchedCalendarContext: {
        anyOf: [
          {
            type: 'null',
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              calendarEventId: { type: 'string' },
              summary: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['calendarEventId', 'summary', 'reason'],
          },
        ],
      },
      preferredStartTime: {
        type: ['string', 'null'],
      },
      preferredEndTime: {
        type: ['string', 'null'],
      },
      interpretationNotes: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' },
          },
          { type: 'string' },
        ],
      },
    },
    required: [
      'candidateType',
      'title',
      'notes',
      'dueDate',
      'dueTime',
      'priority',
      'estimatedMinutes',
      'cadenceType',
      'cadenceDays',
      'targetCount',
      'matchedCalendarContext',
      'preferredStartTime',
      'preferredEndTime',
      'interpretationNotes',
    ],
  },
} as const

export const CAPTURE_INTERPRETATION_SYSTEM_PROMPT = [
  'You are a task-draft extraction engine for Pending App.',
  'Return only a JSON object with these keys: candidateType, title, notes, dueDate, dueTime, priority, estimatedMinutes, cadenceType, cadenceDays, targetCount, matchedCalendarContext, preferredStartTime, preferredEndTime, interpretationNotes.',
  'candidateType must be either task or habit.',
  'Support Spanish and English input.',
  'Be conservative. Use null instead of guessing.',
  'You may use the supplied calendarContext candidates to enrich the draft when they are clearly relevant.',
  'If you use calendar context, matchedCalendarContext must be an object with calendarEventId, summary, and reason.',
  'If no calendar context is clearly relevant, matchedCalendarContext must be null.',
  'Use habit when the input clearly describes a recurring routine or cadence.',
  'Use task when the input clearly describes a one-off obligation.',
  'If it is unclear whether the user means a one-off task or a recurring habit, keep the most likely candidateType but add an interpretation note that the task-vs-habit intent is unclear.',
  'If cadence is not explicit, keep cadenceType null and cadenceDays empty.',
  'If a title is uncertain, return null and add a note in interpretationNotes.',
  'If a date is ambiguous, return null unless the user text clearly supports a date; add an ambiguity note.',
  'Only infer dueTime or preferred time window when clearly stated.',
  'Keep more detail in notes, not in title.',
  'Calendar context must never override explicit user-provided details silently.',
  'For task outputs, return cadenceType null, cadenceDays empty, and targetCount null.',
  'For habit outputs, set targetCount only when a meaningful daily count is explicit; otherwise use 1.',
  'Do not include markdown, code fences, prose, or extra keys.',
].join(' ')

export function getRemoteCaptureInterpreterConfig() {
  if (!env.CAPTURE_INTERPRETATION_API_URL) {
    return null
  }

  return {
    url: env.CAPTURE_INTERPRETATION_API_URL,
    apiKey: env.CAPTURE_INTERPRETATION_API_KEY,
    model: env.CAPTURE_INTERPRETATION_MODEL,
    timeoutMs: env.CAPTURE_INTERPRETATION_TIMEOUT_MS,
  } satisfies RemoteCaptureInterpreterConfig
}

function buildOpenRouterUserPrompt(input: CaptureInterpreterRequest) {
  return JSON.stringify(
    {
      slice: 'typed-task-capture',
      schemaVersion: 'typed-task-draft-v1',
      normalizedInput: input.normalizedInput,
      currentDate: input.currentDate,
      timezone: input.timezone,
      languageHint: input.languageHint ?? 'mixed',
      calendarContext: input.calendarContext,
    },
    null,
    2,
  )
}

function extractOpenRouterMessageText(json: OpenRouterChatResponse) {
  const firstChoice = json.choices?.[0]
  const message = firstChoice?.message

  if (!message || message.refusal) {
    throw new CaptureInterpreterError('Capture interpretation returned no usable model output.', 'INVALID_RESPONSE')
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.content)) {
    const combined = message.content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim()

    if (combined) {
      return combined
    }
  }

  throw new CaptureInterpreterError('Capture interpretation returned no usable model output.', 'INVALID_RESPONSE')
}

function stripJsonCodeFences(value: string) {
  const trimmed = value.trim()

  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function normalizeInterpretationNotes(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }

  return undefined
}

function normalizePriority(value: unknown) {
  if (value === 'urgent') {
    return 'high'
  }

  return value
}

function normalizeMatchedCalendarContext(
  value: unknown,
  candidates: Array<CaptureInterpreterRequest['calendarContext'][number]>,
): MatchedCalendarContext | null | undefined {
  if (!value) {
    return undefined
  }

  if (typeof value === 'string') {
    const match = candidates.find((candidate) => candidate.calendarEventId === value)
    return match
      ? {
          calendarEventId: match.calendarEventId,
          summary: match.summary,
          reason: match.reason,
        }
      : undefined
  }

  if (typeof value === 'object' && value !== null) {
    const objectValue = value as Partial<MatchedCalendarContext>

    if (
      typeof objectValue.calendarEventId === 'string' &&
      typeof objectValue.summary === 'string' &&
      typeof objectValue.reason === 'string'
    ) {
      return {
        calendarEventId: objectValue.calendarEventId,
        summary: objectValue.summary,
        reason: objectValue.reason,
      }
    }

    if (typeof objectValue.calendarEventId === 'string') {
      const match = candidates.find((candidate) => candidate.calendarEventId === objectValue.calendarEventId)

      if (match) {
        return {
          calendarEventId: match.calendarEventId,
          summary: typeof objectValue.summary === 'string' ? objectValue.summary : match.summary,
          reason: typeof objectValue.reason === 'string' ? objectValue.reason : match.reason,
        }
      }
    }
  }

  return undefined
}

function parseOpenRouterDraft(
  json: OpenRouterChatResponse,
  input: CaptureInterpreterRequest,
) {
  const rawContent = extractOpenRouterMessageText(json)
  const normalizedContent = stripJsonCodeFences(rawContent)

  let parsed: unknown

  try {
    parsed = JSON.parse(normalizedContent)
  } catch {
    throw new CaptureInterpreterError('Capture interpretation returned invalid JSON.', 'INVALID_RESPONSE')
  }

  const normalizedParsed =
    typeof parsed === 'object' && parsed !== null
      ? {
          ...parsed,
          priority: normalizePriority((parsed as Record<string, unknown>).priority),
          interpretationNotes: normalizeInterpretationNotes(
            (parsed as Record<string, unknown>).interpretationNotes,
          ),
          matchedCalendarContext: normalizeMatchedCalendarContext(
            (parsed as Record<string, unknown>).matchedCalendarContext,
            input.calendarContext,
          ),
        }
      : parsed

  const validated = typedTaskDraftProviderOutputSchema.safeParse(normalizedParsed)

  if (!validated.success) {
    throw new CaptureInterpreterError(
      'Capture interpretation returned an invalid task draft.',
      'INVALID_RESPONSE',
    )
  }

  return validated.data
}

export function createRemoteCaptureInterpreter(
  config = getRemoteCaptureInterpreterConfig(),
  fetchImpl: typeof fetch = fetch,
): CaptureInterpreter | null {
  if (!config) {
    return null
  }

  return {
    async interpretTypedTask(input) {
      if (!config.apiKey) {
        throw new CaptureInterpreterError('Capture interpretation API key is missing.', 'CONFIG')
      }

      if (!config.model) {
        throw new CaptureInterpreterError('Capture interpretation model is missing.', 'CONFIG')
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
      let response: Response
      const url = config.url
      const requestMetadata = {
        model: config.model,
        timeoutMs: config.timeoutMs,
        url,
        normalizedInput: input.normalizedInput.slice(0, 200),
        languageHint: input.languageHint ?? 'mixed',
        calendarContextCount: input.calendarContext.length,
      }

      logProviderCall('openrouter', 'request_started', requestMetadata)

      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            'X-Title': env.VITE_APP_NAME,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: 'system',
                content: CAPTURE_INTERPRETATION_SYSTEM_PROMPT,
              },
              {
                role: 'user',
                content: buildOpenRouterUserPrompt(input),
              },
            ],
            temperature: 0,
            response_format: {
              type: 'json_schema',
              json_schema: CAPTURE_DRAFT_JSON_SCHEMA,
            },
          }),
          signal: controller.signal,
        })
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          logProviderError(
            'openrouter',
            'request_timeout',
            requestMetadata,
            error,
          )
          throw new CaptureInterpreterError(
            `Capture interpretation timed out after ${config.timeoutMs}ms.`,
            'REQUEST',
          )
        }

        logProviderError(
          'openrouter',
          'request_failed',
          requestMetadata,
          error,
        )
        throw new CaptureInterpreterError('Capture interpretation request failed.', 'REQUEST')
      } finally {
        clearTimeout(timeout)
      }

      let json: OpenRouterChatResponse
      const responseText = await response.text()

      try {
        json = JSON.parse(responseText) as OpenRouterChatResponse
      } catch (error) {
        logProviderError(
          'openrouter',
          'invalid_json',
          {
            ...requestMetadata,
            status: response.status,
            bodySnippet: responseText.slice(0, 600),
          },
          error,
        )
        throw new CaptureInterpreterError('Capture interpretation returned invalid JSON.', 'INVALID_RESPONSE')
      }

      if (!response.ok) {
        const message = json.error?.message || `Capture interpretation failed (${response.status}).`
        logProviderCall('openrouter', 'http_response', {
          ...requestMetadata,
          status: response.status,
          ok: false,
        })
        logProviderError('openrouter', 'http_error', {
          ...requestMetadata,
          status: response.status,
          providerMessage: message,
        })
        throw new CaptureInterpreterError(
          message,
          'REQUEST',
        )
      }

      logProviderCall('openrouter', 'http_response', {
        ...requestMetadata,
        status: response.status,
        ok: true,
      })

      try {
        const draft = parseOpenRouterDraft(json, input)
        logProviderCall('openrouter', 'draft_parsed', {
          ...requestMetadata,
          candidateType: draft.candidateType,
          matchedCalendarContext: draft.matchedCalendarContext?.summary ?? null,
          interpretationNotesCount: draft.interpretationNotes?.length ?? 0,
        })
        return draft
      } catch (error) {
        logProviderError(
          'openrouter',
          'invalid_draft',
          {
            ...requestMetadata,
            status: response.status,
            bodySnippet: responseText.slice(0, 600),
          },
          error,
        )
        throw error
      }
    },
  }
}
