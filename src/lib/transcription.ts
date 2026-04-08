import { z } from 'zod'

export const transcriptionLanguageHintSchema = z.enum(['auto', 'es', 'en'])
export const transcriptionDetectedLanguageSchema = z.enum(['es', 'en', 'unknown'])
export const transcriptionSourceSchema = z.literal('pending-app')

const audioFileSchema = z.custom<File>(
  (value) => typeof File !== 'undefined' && value instanceof File,
  'Audio file is required.',
)

export const transcribeAudioUploadInputSchema = z.object({
  audio: audioFileSchema,
  languageHint: transcriptionLanguageHintSchema.default('auto'),
  source: transcriptionSourceSchema.default('pending-app'),
})

export const transcribeAudioSuccessSchema = z.object({
  ok: z.literal(true),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
})

export const transcribeAudioFailureCodeSchema = z.enum([
  'EMPTY_AUDIO',
  'UNSUPPORTED_MEDIA_TYPE',
  'FILE_TOO_LARGE',
  'UNAUTHORIZED',
  'TRANSCRIPTION_FAILED',
  'SERVICE_UNAVAILABLE',
  'INVALID_REQUEST',
])

export const transcribeAudioFailureSchema = z.object({
  ok: z.literal(false),
  code: transcribeAudioFailureCodeSchema,
  message: z.string().trim().min(1),
})

export const transcribeAudioResponseSchema = z.union([
  transcribeAudioSuccessSchema,
  transcribeAudioFailureSchema,
])

export type TranscriptionLanguageHint = z.infer<typeof transcriptionLanguageHintSchema>
export type TranscriptionDetectedLanguage = z.infer<typeof transcriptionDetectedLanguageSchema>
export type TranscribeAudioUploadInput = z.infer<typeof transcribeAudioUploadInputSchema>
export type TranscribeAudioSuccess = z.infer<typeof transcribeAudioSuccessSchema>
export type TranscribeAudioFailure = z.infer<typeof transcribeAudioFailureSchema>
export type TranscribeAudioResponse = z.infer<typeof transcribeAudioResponseSchema>

export function parseTranscribeAudioFormData(input: unknown): TranscribeAudioUploadInput {
  if (!(input instanceof FormData)) {
    throw new Error('Expected FormData.')
  }

  const audio = input.get('audio')
  const languageHint = input.get('languageHint')
  const source = input.get('source')

  return transcribeAudioUploadInputSchema.parse({
    audio,
    languageHint: typeof languageHint === 'string' && languageHint ? languageHint : undefined,
    source: typeof source === 'string' && source ? source : undefined,
  })
}

export function buildTranscriptionServiceFormData(input: TranscribeAudioUploadInput) {
  const formData = new FormData()
  formData.set('audio', input.audio, input.audio.name)
  formData.set('languageHint', input.languageHint)
  formData.set('source', input.source)
  return formData
}
