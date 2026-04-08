import { env } from '../lib/env'
import {
  buildTranscriptionServiceFormData,
  transcribeAudioResponseSchema,
  type TranscribeAudioResponse,
  type TranscribeAudioUploadInput,
} from '../lib/transcription'

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

      try {
        response = await fetchImplementation(getTranscriptionEndpointUrl(config.url), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
          body: buildTranscriptionServiceFormData(input),
        })
      } catch {
        throw new TranscriptionClientError('Transcription request failed.', 'REQUEST')
      }

      let json: unknown

      try {
        json = await response.json()
      } catch {
        throw new TranscriptionClientError(
          'Transcription service returned invalid JSON.',
          'INVALID_RESPONSE',
        )
      }

      const parsed = transcribeAudioResponseSchema.safeParse(json)

      if (!parsed.success) {
        throw new TranscriptionClientError(
          'Transcription service returned an invalid response body.',
          'INVALID_RESPONSE',
        )
      }

      return parsed.data
    },
  }
}
