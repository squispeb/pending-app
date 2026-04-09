import { describe, expect, it, vi } from 'vitest'
import { createVoiceCaptureProcessor } from './voice-capture-processor'

const sampleUpload = {
  audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
  languageHint: 'auto' as const,
  source: 'pending-app' as const,
  currentDate: '2026-04-08',
  timezone: 'America/Lima',
}

describe('voice capture processor', () => {
  it('auto-saves a high-confidence voice task result', async () => {
    const confirmCapturedTask = vi.fn(async () => ({ ok: true as const, id: 'task-1' }))
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Comprar focos para la sala mañana.',
            language: 'es' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          expect(input.rawInput).toBe('Comprar focos para la sala mañana.')
          expect(input.languageHint).toBe('es')

          return {
            ok: true as const,
            draft: {
              rawInput: input.rawInput,
              normalizedInput: input.rawInput,
              candidateType: 'task' as const,
              title: 'Comprar focos para la sala',
              notes: null,
              dueDate: '2026-04-09',
              dueTime: null,
              priority: null,
              estimatedMinutes: null,
              cadenceType: null,
              cadenceDays: [],
              targetCount: null,
              matchedCalendarContext: null,
              preferredStartTime: null,
              preferredEndTime: null,
              interpretationNotes: [],
            },
          }
        },
        confirmCapturedTask,
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'auto_saved',
      candidateType: 'task',
      createdId: 'task-1',
      title: 'Comprar focos para la sala',
      transcript: 'Comprar focos para la sala mañana.',
      language: 'es',
      matchedCalendarContext: null,
    })
    expect(confirmCapturedTask).toHaveBeenCalledOnce()
  })

  it('returns a review draft when confidence is not high enough', async () => {
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Comprar focos para la sala mañana.',
            language: 'es' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          return {
            ok: true as const,
            draft: {
              rawInput: input.rawInput,
              normalizedInput: input.rawInput,
              candidateType: 'task' as const,
              title: null,
              notes: null,
              dueDate: '2026-04-09',
              dueTime: null,
              priority: null,
              estimatedMinutes: null,
              cadenceType: null,
              cadenceDays: [],
              targetCount: null,
              matchedCalendarContext: null,
              preferredStartTime: null,
              preferredEndTime: null,
              interpretationNotes: ['Could not infer a short task title.'],
            },
          }
        },
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'review',
      transcript: 'Comprar focos para la sala mañana.',
      language: 'es',
      draft: {
        rawInput: 'Comprar focos para la sala mañana.',
        normalizedInput: 'Comprar focos para la sala mañana.',
        candidateType: 'task',
        title: null,
        notes: null,
        dueDate: '2026-04-09',
        dueTime: null,
        priority: null,
        estimatedMinutes: null,
        cadenceType: null,
        cadenceDays: [],
        targetCount: null,
        matchedCalendarContext: null,
        preferredStartTime: null,
        preferredEndTime: null,
        interpretationNotes: ['Could not infer a short task title.'],
      },
    })
  })

  it('returns a clarification outcome for very weak voice captures', async () => {
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'ehh',
            language: 'unknown' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          return {
            ok: true as const,
            draft: {
              rawInput: input.rawInput,
              normalizedInput: input.rawInput,
              candidateType: 'task' as const,
              title: null,
              notes: null,
              dueDate: null,
              dueTime: null,
              priority: null,
              estimatedMinutes: null,
              cadenceType: null,
              cadenceDays: [],
              targetCount: null,
              matchedCalendarContext: null,
              preferredStartTime: null,
              preferredEndTime: null,
              interpretationNotes: ['Could not infer a short task title.'],
            },
          }
        },
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'ehh',
      language: 'unknown',
      message: 'I need you to restate that before I can save it.',
      questions: ['What do you want to add?'],
      draft: {
        rawInput: 'ehh',
        normalizedInput: 'ehh',
        candidateType: 'task',
        title: null,
        notes: null,
        dueDate: null,
        dueTime: null,
        priority: null,
        estimatedMinutes: null,
        cadenceType: null,
        cadenceDays: [],
        targetCount: null,
        matchedCalendarContext: null,
        preferredStartTime: null,
        preferredEndTime: null,
        interpretationNotes: ['Could not infer a short task title.'],
      },
    })
  })

  it('asks whether the user means a task or a habit when intent is ambiguous', async () => {
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Leer mas',
            language: 'es' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          return {
            ok: true as const,
            draft: {
              rawInput: input.rawInput,
              normalizedInput: input.rawInput,
              candidateType: 'task' as const,
              title: 'Leer mas',
              notes: null,
              dueDate: null,
              dueTime: null,
              priority: null,
              estimatedMinutes: null,
              cadenceType: null,
              cadenceDays: [],
              targetCount: null,
              matchedCalendarContext: null,
              preferredStartTime: null,
              preferredEndTime: null,
              interpretationNotes: ['Task-vs-habit intent is unclear from the transcript.'],
            },
          }
        },
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Leer mas',
      language: 'es',
      message: 'I need to confirm whether this belongs in tasks or habits.',
      questions: ['Is this a one-time task or a habit you want to repeat?'],
      draft: {
        rawInput: 'Leer mas',
        normalizedInput: 'Leer mas',
        candidateType: 'task',
        title: 'Leer mas',
        notes: null,
        dueDate: null,
        dueTime: null,
        priority: null,
        estimatedMinutes: null,
        cadenceType: null,
        cadenceDays: [],
        targetCount: null,
        matchedCalendarContext: null,
        preferredStartTime: null,
        preferredEndTime: null,
        interpretationNotes: ['Task-vs-habit intent is unclear from the transcript.'],
      },
    })
  })

  it('returns transcription failures directly', async () => {
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: false as const,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Voice transcription is unavailable right now.',
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput() {
          throw new Error('Should not be called')
        },
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Voice transcription is unavailable right now.',
    })
  })

  it('returns interpretation failures after successful transcription', async () => {
    const processor = createVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Comprar focos para la sala mañana.',
            language: 'es' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          return {
            ok: false as const,
            code: 'INTERPRETATION_FAILED',
            message: 'Capture interpretation request failed.',
            rawInput: input.rawInput,
          }
        },
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: false,
      code: 'INTERPRETATION_FAILED',
      message: 'Capture interpretation request failed.',
      rawInput: 'Comprar focos para la sala mañana.',
    })
  })
})
