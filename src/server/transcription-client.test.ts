import { describe, expect, it, vi } from 'vitest'
import {
  TranscriptionClientError,
  createRemoteTranscriptionClient,
} from './transcription-client'

describe('transcription client', () => {
  it('returns a typed success response from the remote service', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, transcript: 'Hola mundo', language: 'es' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
    const client = createRemoteTranscriptionClient(
      { url: 'http://127.0.0.1:5555', token: 'secret-token' },
      fetchMock,
    )

    const response = await client?.transcribeAudio({
      audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
      languageHint: 'auto',
      source: 'pending-app',
    })

    expect(response).toEqual({
      ok: true,
      transcript: 'Hola mundo',
      language: 'es',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('http://127.0.0.1:5555/transcribe')
    expect(init?.headers).toEqual({
      Authorization: 'Bearer secret-token',
    })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('languageHint')).toBe('auto')
    expect((init?.body as FormData).get('source')).toBe('pending-app')
  })

  it('returns a typed failure response from the remote service', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Transcription service is temporarily unavailable.',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )
    const client = createRemoteTranscriptionClient(
      { url: 'http://127.0.0.1:5555', token: 'secret-token' },
      fetchMock,
    )

    const response = await client?.transcribeAudio({
      audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
      languageHint: 'en',
      source: 'pending-app',
    })

    expect(response).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Transcription service is temporarily unavailable.',
    })
  })

  it('throws a config error when the service token is missing', async () => {
    const client = createRemoteTranscriptionClient(
      { url: 'http://127.0.0.1:5555' },
      vi.fn<typeof fetch>(),
    )

    await expect(
      client?.transcribeAudio({
        audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
        languageHint: 'auto',
        source: 'pending-app',
      }),
    ).rejects.toMatchObject({
      name: 'TranscriptionClientError',
      code: 'CONFIG',
    } satisfies Partial<TranscriptionClientError>)
  })

  it('throws an invalid response error when the service returns malformed JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ transcript: 'missing ok flag' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
    const client = createRemoteTranscriptionClient(
      { url: 'http://127.0.0.1:5555', token: 'secret-token' },
      fetchMock,
    )

    await expect(
      client?.transcribeAudio({
        audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
        languageHint: 'auto',
        source: 'pending-app',
      }),
    ).rejects.toMatchObject({
      name: 'TranscriptionClientError',
      code: 'INVALID_RESPONSE',
    } satisfies Partial<TranscriptionClientError>)
  })
})
