import { env } from '../lib/env'
import {
  normalizeCaptureInput,
  voiceIntentClassificationSchema,
  type VoiceIntentClassification,
} from '../lib/capture'
import { logProviderCall, logProviderError } from './provider-logging'

const TASK_REFERENCE_PATTERN = /\b(task|todo|tarea)\b/i

const TASK_STATUS_PATTERNS = [
  /\b(status|show|check)\b.*\b(task|todo|tarea)\b/i,
  /\bwhat(?:'s| is)\b.*\b(task|todo|tarea)\b/i,
  /\bhow(?:'s| is)\b.*\b(task|todo|tarea)\b/i,
  /\b(estado|muestrame|muéstrame|revisa)\b.*\b(tarea)\b/i,
  /\b(como va|cómo va)\b.*\b(tarea)\b/i,
] as const

const TASK_COMPLETE_PATTERNS = [
  /\b(mark|set)\b.*\b(task|todo|tarea)\b.*\b(done|complete(?:d)?|finish(?:ed)?)\b/i,
  /\b(done|complete(?:d)?|finish(?:ed)?)\b.*\b(task|todo|tarea)\b/i,
  /\b(marca|marcar|completa|completar|termina|terminar)\b.*\b(tarea)\b/i,
] as const

const TASK_REOPEN_PATTERNS = [
  /\b(reopen|re-open|undo)\b.*\b(task|todo|tarea)\b/i,
  /\b(reabre|reabrir|deshacer)\b.*\b(tarea)\b/i,
] as const

const TASK_EDIT_PATTERNS = [
  /\b(rename|edit|update|change)\b.*\b(task|todo|tarea)\b/i,
  /\b(renombra|renombrar|edita|editar|actualiza|actualizar|cambia|cambiar)\b.*\b(tarea)\b/i,
] as const

const TASK_UNSUPPORTED_ACTION_PATTERNS = [
  /\b(archive|delete|remove|cancel|snooze|defer)\b.*\b(task|todo|tarea)\b/i,
  /\b(archiva|archivar|elimina|eliminar|borra|borrar|cancela|cancelar|pospone|posponer|difiere|diferir)\b.*\b(tarea)\b/i,
] as const

const CALENDAR_CREATE_PATTERNS = [
  /\b(create|add|schedule|book|put)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(crea|crear|agrega|agregar|programa|programar|pon)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_EDIT_PATTERNS = [
  /\b(edit|update|change|move|reschedule|rename)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(edita|editar|actualiza|actualizar|cambia|cambiar|mueve|mover|reprograma|reprogramar|renombra|renombrar)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_CANCEL_PATTERNS = [
  /\b(cancel|delete|remove)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(cancela|cancelar|elimina|eliminar|borra|borrar|quita|quitar)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_UNSUPPORTED_ACTION_PATTERNS = [
  /\b(status|show|check|list)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(estado|muestrame|muéstrame|revisa|lista)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const UNSUPPORTED_PLANNER_ACTION_PATTERNS = [
  /\b(edit|update|change|complete|reopen|archive|delete|remove|cancel)\b.*\b(habit|idea)\b/i,
  /\b(edita|editar|actualiza|actualizar|cambia|cambiar|completa|completar|reabre|reabrir|archiva|archivar|elimina|eliminar|borra|borrar|cancela|cancelar)\b.*\b(habito|hábito|idea)\b/i,
] as const

const VOICE_INTENT_JSON_SCHEMA = {
  name: 'voice_intent_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      family: {
        type: 'string',
        enum: ['creation', 'task_action', 'calendar_action', 'unsupported_action'],
      },
      kind: {
        type: 'string',
        enum: [
          'creation',
          'task_status',
          'complete_task',
          'reopen_task',
          'edit_task',
          'unsupported_task_action',
          'create_calendar_event',
          'edit_calendar_event',
          'cancel_calendar_event',
          'unsupported_calendar_action',
          'unsupported_action',
        ],
      },
    },
    required: ['family', 'kind'],
  },
} as const

export const VOICE_INTENT_CLASSIFICATION_SYSTEM_PROMPT = [
  'You are a voice intent classification engine for Pending App.',
  'Return only a JSON object with exactly two keys: family and kind.',
  'Classify the utterance into one of these bounded intents.',
  'Use family creation with kind creation for new task, habit, or idea capture requests.',
  'Use family task_action for task status, complete, reopen, edit, and unsupported task actions.',
  'Use family calendar_action for create, edit, cancel, and unsupported calendar actions.',
  'Use family unsupported_action for planner commands that target unsupported entities such as habits or ideas.',
  'Be conservative. If the utterance is clearly a planner command but not supported, do not map it to creation.',
  'If the utterance is simply a new thing to capture, choose creation.',
  'Support Spanish and English input.',
  'Do not include prose, markdown, code fences, or extra keys.',
].join(' ')

type VoiceIntentClassifierConfig = {
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

export interface VoiceIntentClassifier {
  classify(transcript: string): Promise<VoiceIntentClassification>
}

export class VoiceIntentClassifierError extends Error {
  code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE'

  constructor(message: string, code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE') {
    super(message)
    this.name = 'VoiceIntentClassifierError'
    this.code = code
  }
}

function matchesAnyPattern(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function mentionsTask(value: string) {
  return TASK_REFERENCE_PATTERN.test(value)
}

function classifyVoiceIntentByRegex(transcript: string): VoiceIntentClassification {
  const normalizedTranscript = normalizeCaptureInput(transcript)

  if (!normalizedTranscript) {
    return voiceIntentClassificationSchema.parse({
      family: 'creation',
      kind: 'creation',
    })
  }

  if (!mentionsTask(normalizedTranscript)) {
    if (matchesAnyPattern(normalizedTranscript, CALENDAR_UNSUPPORTED_ACTION_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'unsupported_calendar_action',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_CANCEL_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'cancel_calendar_event',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_EDIT_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'edit_calendar_event',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_CREATE_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'create_calendar_event',
      })
    }
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_STATUS_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'task_status',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_REOPEN_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'reopen_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_COMPLETE_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'complete_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_EDIT_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'edit_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_UNSUPPORTED_ACTION_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'unsupported_task_action',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, UNSUPPORTED_PLANNER_ACTION_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'unsupported_action',
      kind: 'unsupported_action',
    })
  }

  return voiceIntentClassificationSchema.parse({
    family: 'creation',
    kind: 'creation',
  })
}

export function getVoiceIntentClassifierConfig() {
  if (!env.VOICE_INTENT_CLASSIFIER_API_URL) {
    return null
  }

  return {
    url: env.VOICE_INTENT_CLASSIFIER_API_URL,
    apiKey: env.VOICE_INTENT_CLASSIFIER_API_KEY,
    model: env.VOICE_INTENT_CLASSIFIER_MODEL,
    timeoutMs: env.VOICE_INTENT_CLASSIFIER_TIMEOUT_MS,
  } satisfies VoiceIntentClassifierConfig
}

function buildVoiceIntentUserPrompt(transcript: string) {
  return JSON.stringify(
    {
      slice: 'voice-action-assistant',
      schemaVersion: 'voice-intent-v1',
      transcript,
    },
    null,
    2,
  )
}

function extractOpenRouterMessageText(json: OpenRouterChatResponse) {
  const firstChoice = json.choices?.[0]
  const message = firstChoice?.message

  if (!message || message.refusal) {
    throw new VoiceIntentClassifierError(
      'Voice intent classification returned no usable model output.',
      'INVALID_RESPONSE',
    )
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

  throw new VoiceIntentClassifierError(
    'Voice intent classification returned no usable model output.',
    'INVALID_RESPONSE',
  )
}

function stripJsonCodeFences(value: string) {
  const trimmed = value.trim()

  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function parseOpenRouterVoiceIntent(json: OpenRouterChatResponse) {
  const rawContent = extractOpenRouterMessageText(json)
  const normalizedContent = stripJsonCodeFences(rawContent)

  let parsed: unknown

  try {
    parsed = JSON.parse(normalizedContent)
  } catch {
    throw new VoiceIntentClassifierError(
      'Voice intent classification returned invalid JSON.',
      'INVALID_RESPONSE',
    )
  }

  const validated = voiceIntentClassificationSchema.safeParse(parsed)

  if (!validated.success) {
    throw new VoiceIntentClassifierError(
      'Voice intent classification returned an invalid intent result.',
      'INVALID_RESPONSE',
    )
  }

  return validated.data
}

export function createRemoteVoiceIntentClassifier(
  config = getVoiceIntentClassifierConfig(),
  fetchImpl: typeof fetch = fetch,
): VoiceIntentClassifier | null {
  if (!config) {
    return null
  }

  return {
    async classify(transcript: string) {
      if (!config.apiKey) {
        throw new VoiceIntentClassifierError('Voice intent classifier API key is missing.', 'CONFIG')
      }

      if (!config.model) {
        throw new VoiceIntentClassifierError('Voice intent classifier model is missing.', 'CONFIG')
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
      const url = config.url
      const requestMetadata = {
        model: config.model,
        timeoutMs: config.timeoutMs,
        url,
        transcript: transcript.slice(0, 200),
      }

      logProviderCall('voice-intent', 'request_started', requestMetadata)

      let response: Response

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
                content: VOICE_INTENT_CLASSIFICATION_SYSTEM_PROMPT,
              },
              {
                role: 'user',
                content: buildVoiceIntentUserPrompt(transcript),
              },
            ],
            temperature: 0,
            response_format: {
              type: 'json_schema',
              json_schema: VOICE_INTENT_JSON_SCHEMA,
            },
          }),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          logProviderError('voice-intent', 'request_timeout', requestMetadata, error)
          throw new VoiceIntentClassifierError(
            `Voice intent classification timed out after ${config.timeoutMs}ms.`,
            'REQUEST',
          )
        }

        logProviderError('voice-intent', 'request_failed', requestMetadata, error)
        throw new VoiceIntentClassifierError('Voice intent classification request failed.', 'REQUEST')
      } finally {
        clearTimeout(timeout)
      }

      const responseText = await response.text()
      let json: OpenRouterChatResponse

      try {
        json = JSON.parse(responseText) as OpenRouterChatResponse
      } catch (error) {
        logProviderError(
          'voice-intent',
          'invalid_json',
          {
            ...requestMetadata,
            status: response.status,
            bodySnippet: responseText.slice(0, 600),
          },
          error,
        )
        throw new VoiceIntentClassifierError(
          'Voice intent classification returned invalid JSON.',
          'INVALID_RESPONSE',
        )
      }

      if (!response.ok) {
        const message = json.error?.message || `Voice intent classification failed (${response.status}).`
        logProviderCall('voice-intent', 'http_response', {
          ...requestMetadata,
          status: response.status,
          ok: false,
        })
        logProviderError('voice-intent', 'http_error', {
          ...requestMetadata,
          status: response.status,
          providerMessage: message,
        })
        throw new VoiceIntentClassifierError(message, 'REQUEST')
      }

      logProviderCall('voice-intent', 'http_response', {
        ...requestMetadata,
        status: response.status,
        ok: true,
      })

      try {
        const intent = parseOpenRouterVoiceIntent(json)
        logProviderCall('voice-intent', 'intent_parsed', {
          ...requestMetadata,
          family: intent.family,
          kind: intent.kind,
        })
        return intent
      } catch (error) {
        logProviderError(
          'voice-intent',
          'invalid_intent',
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

export function createVoiceIntentRouter(dependencies?: { classifier?: VoiceIntentClassifier | null }) {
  const classifier = dependencies?.classifier === undefined ? createRemoteVoiceIntentClassifier() : dependencies.classifier

  return {
    async classifyVoiceIntent(transcript: string): Promise<VoiceIntentClassification> {
      if (!classifier) {
        return classifyVoiceIntentByRegex(transcript)
      }

      try {
        return await classifier.classify(transcript)
      } catch {
        return classifyVoiceIntentByRegex(transcript)
      }
    },
  }
}

export function buildVoiceActionClarification(intent: VoiceIntentClassification) {
  if (intent.family === 'task_action') {
    return {
      message:
        intent.kind === 'task_status'
          ? 'I understood that as a task status request, but voice task actions are not available yet.'
          : intent.kind === 'unsupported_task_action'
            ? 'I understood that as a task action, but that task command is not supported yet.'
            : 'I understood that as a task action, but voice task actions are not available yet.',
      questions: ['Do you want to create a new task instead?'],
    }
  }

  if (intent.family === 'calendar_action') {
    return {
      message:
        intent.kind === 'unsupported_calendar_action'
          ? 'I understood that as a calendar action, but that calendar command is not supported yet.'
          : 'I understood that as a calendar action, but voice calendar actions are not available yet.',
      questions: ['Do you want to capture this as a new task instead?'],
    }
  }

  if (intent.family === 'unsupported_action') {
    return {
      message: 'I understood that as a planner command, but that voice action is not supported yet.',
      questions: ['Do you want to capture this as a new task instead?'],
    }
  }

  return {
    message: 'I need a little more detail before I can save this.',
    questions: ['What detail should I use before I save this?'],
  }
}
