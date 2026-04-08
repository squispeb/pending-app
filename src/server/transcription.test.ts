import { describe, expect, it } from 'vitest'
import type { TranscriptionClient } from './transcription-client'
import { TranscriptionClientError } from './transcription-client'
import { createTranscriptionBroker } from './transcription'

const sampleUpload = {
  audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
  languageHint: 'auto' as const,
  source: 'pending-app' as const,
}

describe('transcription broker', () => {
  it('passes through successful transcription responses', async () => {
    const client: TranscriptionClient = {
      async transcribeAudio() {
        return {
          ok: true,
          transcript: 'Hello world',
          language: 'en',
        }
      },
    }
    const broker = createTranscriptionBroker(client)

    const response = await broker.transcribeAudioUpload(sampleUpload)

    expect(response).toEqual({
      ok: true,
      transcript: 'Hello world',
      language: 'en',
    })
  })

  it('passes through typed service failures from the remote client', async () => {
    const client: TranscriptionClient = {
      async transcribeAudio() {
        return {
          ok: false,
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded audio exceeds the configured size limit.',
        }
      },
    }
    const broker = createTranscriptionBroker(client)

    const response = await broker.transcribeAudioUpload(sampleUpload)

    expect(response).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'Uploaded audio exceeds the configured size limit.',
    })
  })

  it('returns a typed fallback when the client is unavailable', async () => {
    const broker = createTranscriptionBroker(null)

    const response = await broker.transcribeAudioUpload(sampleUpload)

    expect(response).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Voice transcription is unavailable right now.',
    })
  })

  it('maps invalid remote responses to a typed service-unavailable failure', async () => {
    const client: TranscriptionClient = {
      async transcribeAudio() {
        throw new TranscriptionClientError(
          'Transcription service returned an invalid response body.',
          'INVALID_RESPONSE',
        )
      },
    }
    const broker = createTranscriptionBroker(client)

    const response = await broker.transcribeAudioUpload(sampleUpload)

    expect(response).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Voice transcription returned an invalid response.',
    })
  })
})
