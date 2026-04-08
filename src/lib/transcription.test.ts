import { describe, expect, it } from 'vitest'
import {
  buildTranscriptionServiceFormData,
  parseTranscribeAudioFormData,
  transcribeAudioResponseSchema,
} from './transcription'

describe('transcription helpers', () => {
  it('parses multipart form data with defaults', () => {
    const formData = new FormData()
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'sample.wav', { type: 'audio/wav' }),
    )

    const parsed = parseTranscribeAudioFormData(formData)

    expect(parsed.audio.name).toBe('sample.wav')
    expect(parsed.languageHint).toBe('auto')
    expect(parsed.source).toBe('pending-app')
  })

  it('rejects multipart form data without an audio file', () => {
    const formData = new FormData()

    expect(() => parseTranscribeAudioFormData(formData)).toThrow('Audio file is required.')
  })

  it('builds multipart form data for the transcription service contract', () => {
    const formData = buildTranscriptionServiceFormData({
      audio: new File([new Uint8Array([1])], 'note.webm', { type: 'audio/webm' }),
      languageHint: 'es',
      source: 'pending-app',
    })

    expect(formData.get('languageHint')).toBe('es')
    expect(formData.get('source')).toBe('pending-app')
    expect(formData.get('audio')).toBeInstanceOf(File)
  })

  it('parses the typed transcription response contract', () => {
    expect(
      transcribeAudioResponseSchema.parse({
        ok: true,
        transcript: 'Hola mundo',
        language: 'es',
      }),
    ).toEqual({
      ok: true,
      transcript: 'Hola mundo',
      language: 'es',
    })
  })
})
