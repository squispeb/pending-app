import { describe, expect, it, vi } from 'vitest'
import { createVoiceCaptureProcessor } from './voice-capture-processor'

const sampleUpload = {
  audio: new File([new Uint8Array([1])], 'sample.wav', { type: 'audio/wav' }),
  languageHint: 'auto' as const,
  source: 'pending-app' as const,
  currentDate: '2026-04-08',
  timezone: 'America/Lima',
}

function createTestVoiceCaptureProcessor(
  dependencies: Parameters<typeof createVoiceCaptureProcessor>[0],
) {
  return createVoiceCaptureProcessor({
    ...dependencies,
    voiceIntentClassifier: null,
  })
}

describe('voice capture processor', () => {
  it('auto-saves a high-confidence voice task result', async () => {
    const confirmCapturedTask = vi.fn(async () => ({ ok: true as const, id: 'task-1' }))
     const processor = createTestVoiceCaptureProcessor({
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

  it('auto-saves a high-confidence voice task with a broader relative due date', async () => {
    const confirmCapturedTask = vi.fn(async () => ({ ok: true as const, id: 'task-2' }))
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Planificar presupuesto next week.',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        async interpretTypedTaskInput(input) {
          expect(input.rawInput).toBe('Planificar presupuesto next week.')

          return {
            ok: true as const,
            draft: {
              rawInput: input.rawInput,
              normalizedInput: input.rawInput,
              candidateType: 'task' as const,
              title: 'Planificar presupuesto',
              notes: null,
              dueDate: '2026-04-13',
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
      createdId: 'task-2',
      title: 'Planificar presupuesto',
      transcript: 'Planificar presupuesto next week.',
      language: 'en',
      matchedCalendarContext: null,
    })
    expect(confirmCapturedTask).toHaveBeenCalledOnce()
  })

  it('returns a review draft when confidence is not high enough', async () => {
     const processor = createTestVoiceCaptureProcessor({
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
     const processor = createTestVoiceCaptureProcessor({
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

  it('requires clarification instead of auto-save when a new task has no due date', async () => {
    const confirmCapturedTask = vi.fn(async () => ({ ok: true as const, id: 'task-1' }))
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Comprar focos para la sala.',
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
              title: 'Comprar focos para la sala',
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
      outcome: 'clarify',
      transcript: 'Comprar focos para la sala.',
      language: 'es',
      message: 'I need a little more detail before I can save this.',
      questions: ['When do you want to do it?'],
      draft: {
        rawInput: 'Comprar focos para la sala.',
        normalizedInput: 'Comprar focos para la sala.',
        candidateType: 'task',
        title: 'Comprar focos para la sala',
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
        interpretationNotes: [],
      },
    })
    expect(confirmCapturedTask).not.toHaveBeenCalled()
  })

  it('routes recognized task actions into clarification instead of task creation', async () => {
    const interpretTypedTaskInput = vi.fn(async () => {
      throw new Error('Should not be called')
    })
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Mark this task as done',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        interpretTypedTaskInput,
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
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I understood that as a task action, but voice task actions are not available yet.',
      questions: ['Do you want to create a new task instead?'],
      draft: null,
    })
    expect(interpretTypedTaskInput).not.toHaveBeenCalled()
  })

  it('returns a task status response for a resolved task status request', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'What is the status of this task?',
            language: 'en' as const,
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
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-123',
              title: 'Call the bank',
              status: 'completed' as const,
              dueDate: '2026-04-09',
              dueTime: null,
              priority: 'medium' as const,
              completedAt: '2026-04-09T15:00:00.000Z',
              source: 'context_task' as const,
            },
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextTaskId: 'task-123',
    })

      expect(result).toEqual({
        ok: true,
        outcome: 'task_status',
        transcript: 'What is the status of this task?',
        language: 'en',
        message: 'The task "Call the bank" is completed. Priority: medium. It was completed on 2026-04-09 at 15:00 UTC. It is due 2026-04-09.',
        task: {
          id: 'task-123',
          title: 'Call the bank',
        status: 'completed',
        dueDate: '2026-04-09',
        dueTime: null,
        priority: 'medium',
        completedAt: '2026-04-09T15:00:00.000Z',
        source: 'context_task',
      },
    })
  })

  it('falls back to generic task-action clarification when resolver is unresolved', async () => {
    const interpretTypedTaskInput = vi.fn(async () => {
      throw new Error('Should not be called')
    })
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Mark this task as done',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        interpretTypedTaskInput,
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'unresolved' as const,
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextIdeaId: 'idea-123',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I understood that as a task action, but voice task actions are not available yet.',
      questions: ['Do you want to create a new task instead?'],
      draft: null,
    })
    expect(interpretTypedTaskInput).not.toHaveBeenCalled()
  })

  it('clarifies unresolved task status requests instead of guessing', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'What is the status of this task?',
            language: 'en' as const,
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
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'unresolved' as const,
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextIdeaId: 'idea-123',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'What is the status of this task?',
      language: 'en',
      message: 'I need to know which task you mean before I can check its status.',
      questions: ['Which task do you mean?'],
      draft: null,
    })
  })

  it('clarifies ambiguous task status resolution with candidate questions', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'What is the status of this task?',
            language: 'en' as const,
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
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'ambiguous' as const,
            candidates: [
              {
                id: 'task-1',
                title: 'Draft launch email',
                status: 'active' as const,
                dueDate: null,
                dueTime: null,
                priority: 'medium' as const,
                completedAt: null,
                source: 'context_idea' as const,
              },
              {
                id: 'task-2',
                title: 'Review launch checklist',
                status: 'active' as const,
                dueDate: null,
                dueTime: null,
                priority: 'medium' as const,
                completedAt: null,
                source: 'context_idea' as const,
              },
            ],
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextIdeaId: 'idea-123',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'What is the status of this task?',
      language: 'en',
      message: 'I need to confirm which task you mean before I can check its status.',
      questions: ['Did you mean "Draft launch email"?', 'Did you mean "Review launch checklist"?'],
      draft: null,
    })
  })

  it('uses current task context first for task-action clarification', async () => {
    const interpretTypedTaskInput = vi.fn(async () => {
      throw new Error('Should not be called')
    })
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Mark this task as done',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        interpretTypedTaskInput,
        async confirmCapturedTask() {
          throw new Error('Should not be called')
        },
        async confirmCapturedHabit() {
          throw new Error('Should not be called')
        },
      },
      taskResolver: {
        async resolveTaskTarget(input) {
          expect(input.contextTaskId).toBe('task-123')
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-123',
              title: 'Call the bank',
              status: 'active' as const,
              dueDate: null,
              dueTime: null,
              priority: 'medium' as const,
              completedAt: null,
              source: 'context_task' as const,
            },
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextTaskId: 'task-123',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I understood that as a task action for "Call the bank", but voice task actions are not available yet.',
      questions: ['Do you want to use this task as the target once voice task actions are enabled?'],
      draft: null,
    })
    expect(interpretTypedTaskInput).not.toHaveBeenCalled()
  })

  it('asks for disambiguation when idea context maps to multiple tasks', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Mark this task as done',
            language: 'en' as const,
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
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'ambiguous' as const,
            candidates: [
              {
                id: 'task-1',
                title: 'Draft launch email',
                status: 'active' as const,
                dueDate: null,
                dueTime: null,
                priority: 'medium' as const,
                completedAt: null,
                source: 'context_idea' as const,
              },
              {
                id: 'task-2',
                title: 'Review launch checklist',
                status: 'active' as const,
                dueDate: null,
                dueTime: null,
                priority: 'medium' as const,
                completedAt: null,
                source: 'context_idea' as const,
              },
            ],
          }
        },
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      contextIdeaId: 'idea-123',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I need to confirm which task you mean before I can do that.',
      questions: ['Did you mean "Draft launch email"?', 'Did you mean "Review launch checklist"?'],
      draft: null,
    })
  })

  it('routes recognized calendar actions into clarification instead of task creation', async () => {
    const interpretTypedTaskInput = vi.fn(async () => {
      throw new Error('Should not be called')
    })
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Schedule a meeting on my calendar for tomorrow',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        interpretTypedTaskInput,
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
      transcript: 'Schedule a meeting on my calendar for tomorrow',
      language: 'en',
      message: 'I understood that as a calendar action, but voice calendar actions are not available yet.',
      questions: ['Do you want to capture this as a new task instead?'],
      draft: null,
    })
    expect(interpretTypedTaskInput).not.toHaveBeenCalled()
  })

  it('routes unsupported planner commands into clarification instead of task creation', async () => {
    const interpretTypedTaskInput = vi.fn(async () => {
      throw new Error('Should not be called')
    })
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Edit this habit',
            language: 'en' as const,
          }
        },
      },
      captureService: {
        interpretTypedTaskInput,
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
      transcript: 'Edit this habit',
      language: 'en',
      message: 'I understood that as a planner command, but that voice action is not supported yet.',
      questions: ['Do you want to capture this as a new task instead?'],
      draft: null,
    })
    expect(interpretTypedTaskInput).not.toHaveBeenCalled()
  })

  it('asks whether the user means a task or a habit when intent is ambiguous', async () => {
     const processor = createTestVoiceCaptureProcessor({
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

  it('routes high-confidence idea captures into idea confirmation instead of task auto-save', async () => {
     const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'I have an idea for a better onboarding flow.',
            language: 'en' as const,
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
              candidateType: 'idea' as const,
              title: 'Better onboarding flow',
              notes: 'Explore a more guided setup for new users.',
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
              interpretationNotes: [],
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
      outcome: 'idea_confirmation',
      transcript: 'I have an idea for a better onboarding flow.',
      language: 'en',
      draft: {
        rawInput: 'I have an idea for a better onboarding flow.',
        normalizedInput: 'I have an idea for a better onboarding flow.',
        candidateType: 'idea',
        title: 'Better onboarding flow',
        notes: 'Explore a more guided setup for new users.',
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
        interpretationNotes: [],
      },
    })
  })

  it('returns transcription failures directly', async () => {
     const processor = createTestVoiceCaptureProcessor({
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
     const processor = createTestVoiceCaptureProcessor({
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
