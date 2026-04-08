import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranscriptionBroker } from './transcription'
import { createRemoteTranscriptionClient } from './transcription-client'

const shouldRunLiveTranscriptionTest = process.env.RUN_LIVE_TRANSCRIPTION_TEST === '1'

function getRequiredAudioFilePath() {
  const audioFilePath = process.env.TRANSCRIPTION_SMOKE_AUDIO_FILE?.trim()

  if (!audioFilePath) {
    throw new Error(
      'Set TRANSCRIPTION_SMOKE_AUDIO_FILE to a real audio file path before running bun test:transcription-live.',
    )
  }

  return resolve(audioFilePath)
}

function getAudioMimeType(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case '.wav':
      return 'audio/wav'
    case '.webm':
      return 'audio/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
    case '.mp4':
      return 'audio/mp4'
    default:
      return 'application/octet-stream'
  }
}

const liveDescribe = shouldRunLiveTranscriptionTest ? describe : describe.skip

liveDescribe('live transcription smoke test', () => {
  it(
    'hits the configured transcription service through the app broker',
    async () => {
      const audioFilePath = getRequiredAudioFilePath()
      const fileContents = await readFile(audioFilePath)
      const broker = createTranscriptionBroker(createRemoteTranscriptionClient())

      const response = await broker.transcribeAudioUpload({
        audio: new File([fileContents], audioFilePath.split('/').pop() ?? 'sample.wav', {
          type: getAudioMimeType(audioFilePath),
        }),
        languageHint: 'auto',
        source: 'pending-app',
      })

      expect(response.ok).toBe(true)

      if (!response.ok) {
        throw new Error(`Expected successful transcription, received ${response.code}: ${response.message}`)
      }

      expect(response.transcript.trim().length).toBeGreaterThan(0)
      expect(['es', 'en', 'unknown']).toContain(response.language)
    },
    60000,
  )
})
