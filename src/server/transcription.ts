import { createServerFn } from '@tanstack/react-start'
import {
  parseTranscribeAudioFormData,
  type TranscribeAudioResponse,
  type TranscribeAudioUploadInput,
  type TranscribeAudioFailure,
} from '../lib/transcription'
import {
  TranscriptionClientError,
  type TranscriptionClient,
  createRemoteTranscriptionClient,
} from './transcription-client'

function serviceUnavailable(message = 'Voice transcription is unavailable right now.') {
  return {
    ok: false,
    code: 'SERVICE_UNAVAILABLE',
    message,
  } satisfies TranscribeAudioFailure
}

export function createTranscriptionBroker(
  transcriptionClient: TranscriptionClient | null = createRemoteTranscriptionClient(),
) {
  return {
    async transcribeAudioUpload(data: TranscribeAudioUploadInput): Promise<TranscribeAudioResponse> {
      if (!transcriptionClient) {
        return serviceUnavailable()
      }

      try {
        return await transcriptionClient.transcribeAudio(data)
      } catch (error) {
        if (error instanceof TranscriptionClientError && error.code === 'INVALID_RESPONSE') {
          return serviceUnavailable('Voice transcription returned an invalid response.')
        }

        return serviceUnavailable()
      }
    },
  }
}

const transcriptionBroker = createTranscriptionBroker()

export const transcribeCaptureAudio = createServerFn({ method: 'POST' })
  .inputValidator((input) => parseTranscribeAudioFormData(input))
  .handler(async ({ data }) => {
    return transcriptionBroker.transcribeAudioUpload(data)
  })
