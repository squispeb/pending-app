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
}

export function getRemoteCaptureInterpreterConfig() {
  if (!env.CAPTURE_INTERPRETATION_API_URL) {
    return null
  }

  return {
    url: env.CAPTURE_INTERPRETATION_API_URL,
    apiKey: env.CAPTURE_INTERPRETATION_API_KEY,
    model: env.CAPTURE_INTERPRETATION_MODEL,
  } satisfies RemoteCaptureInterpreterConfig
}

export function createRemoteCaptureInterpreter(
  config = getRemoteCaptureInterpreterConfig(),
): CaptureInterpreter | null {
  if (!config) {
    return null
  }

  return {
    async interpretTypedTask(input) {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey
            ? {
                Authorization: `Bearer ${config.apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          schemaVersion: 'typed-task-draft-v1',
          input,
        }),
      })

      if (!response.ok) {
        throw new CaptureInterpreterError(
          `Capture interpretation failed (${response.status}).`,
          'REQUEST',
        )
      }

      let json: unknown

      try {
        json = await response.json()
      } catch {
        throw new CaptureInterpreterError('Capture interpretation returned invalid JSON.', 'INVALID_RESPONSE')
      }

      const parsed = typedTaskDraftProviderOutputSchema.safeParse(
        typeof json === 'object' && json !== null && 'draft' in json
          ? (json as { draft: unknown }).draft
          : json,
      )

      if (!parsed.success) {
        throw new CaptureInterpreterError(
          'Capture interpretation returned an invalid task draft.',
          'INVALID_RESPONSE',
        )
      }

      return parsed.data
    },
  }
}
