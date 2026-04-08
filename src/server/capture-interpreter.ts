import { env } from '../lib/env'
import type {
  CaptureLanguageHint,
  TypedTaskDraftProviderOutput,
} from '../lib/capture'
import { typedTaskDraftProviderOutputSchema } from '../lib/capture'

export type CaptureInterpreterRequest = {
  normalizedInput: string
  currentDate: string
  timezone: string
  languageHint?: CaptureLanguageHint
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

export const CAPTURE_INTERPRETATION_SYSTEM_PROMPT = [
  'You are a task-draft extraction engine for Pending App.',
  'Return only a JSON object with these keys: candidateType, title, notes, dueDate, dueTime, priority, estimatedMinutes, cadenceType, cadenceDays, targetCount, preferredStartTime, preferredEndTime, interpretationNotes.',
  'candidateType must be either task or habit.',
  'Support Spanish and English input.',
  'Be conservative. Use null instead of guessing.',
  'Use habit when the input clearly describes a recurring routine or cadence.',
  'Use task when the input clearly describes a one-off obligation.',
  'If cadence is not explicit, keep cadenceType null and cadenceDays empty.',
  'If a title is uncertain, return null and add a note in interpretationNotes.',
  'If a date is ambiguous, return null unless the user text clearly supports a date; add an ambiguity note.',
  'Only infer dueTime or preferred time window when clearly stated.',
  'Keep more detail in notes, not in title.',
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

function parseOpenRouterDraft(json: OpenRouterChatResponse) {
  const rawContent = extractOpenRouterMessageText(json)
  const normalizedContent = stripJsonCodeFences(rawContent)

  let parsed: unknown

  try {
    parsed = JSON.parse(normalizedContent)
  } catch {
    throw new CaptureInterpreterError('Capture interpretation returned invalid JSON.', 'INVALID_RESPONSE')
  }

  const validated = typedTaskDraftProviderOutputSchema.safeParse(parsed)

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

      try {
        response = await fetchImpl(config.url, {
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
          }),
          signal: controller.signal,
        })
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          throw new CaptureInterpreterError(
            `Capture interpretation timed out after ${config.timeoutMs}ms.`,
            'REQUEST',
          )
        }

        throw new CaptureInterpreterError('Capture interpretation request failed.', 'REQUEST')
      } finally {
        clearTimeout(timeout)
      }

      let json: OpenRouterChatResponse

      try {
        json = (await response.json()) as OpenRouterChatResponse
      } catch {
        throw new CaptureInterpreterError('Capture interpretation returned invalid JSON.', 'INVALID_RESPONSE')
      }

      if (!response.ok) {
        const message = json.error?.message || `Capture interpretation failed (${response.status}).`
        throw new CaptureInterpreterError(
          message,
          'REQUEST',
        )
      }

      return parseOpenRouterDraft(json)
    },
  }
}
