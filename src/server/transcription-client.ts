import { env } from '../lib/env'
import {
  buildTranscriptionServiceFormData,
  transcribeAudioResponseSchema,
  type TranscribeAudioResponse,
  type TranscribeAudioUploadInput,
} from '../lib/transcription'
import { logProviderCall, logProviderError } from './provider-logging'

export interface TranscriptionClient {
  transcribeAudio(input: TranscribeAudioUploadInput): Promise<TranscribeAudioResponse>
}

export class TranscriptionClientError extends Error {
  code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE'

  constructor(message: string, code: 'CONFIG' | 'REQUEST' | 'INVALID_RESPONSE') {
    super(message)
    this.name = 'TranscriptionClientError'
    this.code = code
  }
}

type RemoteTranscriptionClientConfig = {
  url: string
  token?: string
}

function getTranscriptionEndpointUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL('transcribe', normalizedBaseUrl)
}

export function getRemoteTranscriptionClientConfig() {
  if (!env.TRANSCRIPTION_SERVICE_URL) {
    return null
  }

  return {
    url: env.TRANSCRIPTION_SERVICE_URL,
    token: env.TRANSCRIPTION_SERVICE_TOKEN,
  } satisfies RemoteTranscriptionClientConfig
}

export function createRemoteTranscriptionClient(
  config = getRemoteTranscriptionClientConfig(),
  fetchImplementation: typeof fetch = fetch,
): TranscriptionClient | null {
  if (!config) {
    return null
  }

  return {
    async transcribeAudio(input) {
      if (!config.token) {
        throw new TranscriptionClientError(
          'Transcription service token is not configured.',
          'CONFIG',
        )
      }

      let response: Response
      const endpointUrl = getTranscriptionEndpointUrl(config.url).toString()
      const requestMetadata = {
        url: endpointUrl,
        mimeType: input.audio.type || 'unknown',
        sizeBytes:
          typeof (input.audio as { size?: unknown }).size === 'number'
            ? (input.audio as { size: number }).size
            : undefined,
        languageHint: input.languageHint ?? 'auto',
        source: input.source ?? 'pending-app',
      }

      logProviderCall('transcription-service', 'request_started', requestMetadata)

      try {
        response = await fetchImplementation(endpointUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
          body: buildTranscriptionServiceFormData(input),
        })
      } catch (error) {
        logProviderError(
          'transcription-service',
          'request_failed',
          requestMetadata,
          error,
        )
        throw new TranscriptionClientError('Transcription request failed.', 'REQUEST')
      }

      const responseText = await response.text()
      let json: unknown

      try {
        json = JSON.parse(responseText)
      } catch (error) {
        logProviderError(
          'transcription-service',
          'invalid_json',
          {
            ...requestMetadata,
            status: response.status,
            bodySnippet: responseText.slice(0, 600),
          },
          error,
        )
        throw new TranscriptionClientError(
          'Transcription service returned invalid JSON.',
          'INVALID_RESPONSE',
        )
      }

      const parsed = transcribeAudioResponseSchema.safeParse(json)

      logProviderCall('transcription-service', 'http_response', {
        ...requestMetadata,
        status: response.status,
        ok: parsed.success,
      })

      if (!parsed.success) {
        logProviderError('transcription-service', 'invalid_response_body', {
          ...requestMetadata,
          status: response.status,
          bodySnippet: responseText.slice(0, 600),
        })
        throw new TranscriptionClientError(
          'Transcription service returned an invalid response body.',
          'INVALID_RESPONSE',
        )
      }

      logProviderCall('transcription-service', 'transcript_parsed', {
        ...requestMetadata,
        language: parsed.data.ok ? parsed.data.language : undefined,
        transcriptLength: parsed.data.ok ? parsed.data.transcript.length : undefined,
      })

      return parsed.data
    },
  }
}
