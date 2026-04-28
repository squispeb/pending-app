import { describe, expect, it, vi } from 'vitest'
import type { VoiceIntentClassifier } from './voice-intent-router'
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

function createProcessorWithIntentClassifier(
  dependencies: Parameters<typeof createVoiceCaptureProcessor>[0],
  voiceIntentClassifier: VoiceIntentClassifier,
) {
  return createVoiceCaptureProcessor({
    ...dependencies,
    voiceIntentClassifier,
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
        async confirmVoiceTaskAction() {
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
    const processor = createProcessorWithIntentClassifier({
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

  it('returns a task action confirmation for resolved completion requests', async () => {
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
        async confirmVoiceTaskAction() {
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
              status: 'active' as const,
              dueDate: '2026-04-09',
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
      outcome: 'task_action_confirmation',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I understood that as completing the task "Call the bank". Confirm if you want me to mark it as completed.',
      action: 'complete_task',
      task: {
        id: 'task-123',
        title: 'Call the bank',
        status: 'active',
        dueDate: '2026-04-09',
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_task',
      },
    })
  })

  it('returns a task edit confirmation with prepared task field changes', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Rename this task to Draft launch email, update the description to include the Q2 launch checklist, and move it to tomorrow',
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
      assistantSessionService: {
        async resolveTaskEditSession() {
          return {
            sessionId: 'session-edit-1',
          }
        },
        async submitSessionTurn() {
          return undefined
        },
        async getSession() {
          return {
            sessionId: 'session-edit-1',
            workflow: {
              kind: 'task_edit' as const,
              phase: 'ready_to_confirm' as const,
              activeField: null,
              changes: {
                title: 'Draft launch email',
                description: 'include the Q2 launch checklist',
                dueDate: '2026-04-09',
                dueTime: '18:00',
              },
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'I understood that as editing "Draft launch note" to set title to "Draft launch email", description and due date to 2026-04-09 at 18:00. Confirm if you want me to apply those changes.',
              },
            ],
          }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-123',
              title: 'Draft launch note',
              status: 'active' as const,
              dueDate: '2026-04-09',
              dueTime: null,
              priority: 'medium' as const,
              completedAt: null,
              source: 'context_task' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'task_action',
          kind: 'edit_task',
        }
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'Rename this task to Draft launch email, update the description to include the Q2 launch checklist, and move it to tomorrow',
      language: 'en',
      message: 'I understood that as editing "Draft launch note" to set title to "Draft launch email", description and due date to 2026-04-09 at 18:00. Confirm if you want me to apply those changes.',
      action: 'edit_task',
      task: {
        id: 'task-123',
        title: 'Draft launch note',
        status: 'active',
        dueDate: '2026-04-09',
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_task',
      },
      edits: {
        title: 'Draft launch email',
        description: 'include the Q2 launch checklist',
        dueDate: '2026-04-09',
        dueTime: '18:00',
      },
      taskEditSession: {
        sessionId: 'session-edit-1',
      },
    })
  })

  it('keeps resolved task context when an edit request needs more detail', async () => {
    let readCount = 0

    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'I want us to edit the Run Quick Discovery task.',
            language: 'unknown' as const,
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
      assistantSessionService: {
        async resolveTaskEditSession() {
          return {
            sessionId: 'session-edit-2',
          }
        },
        async submitSessionTurn() {
          return {
            turnId: 'turn-edit-2',
          }
        },
        async getSession() {
          readCount += 1

          if (readCount === 1) {
            return {
              sessionId: 'session-edit-2',
              activeTurn: {
                turnId: 'turn-edit-2',
                state: 'processing' as const,
              },
              lastTurn: null,
              workflow: {
                kind: 'task_edit' as const,
                phase: 'collecting' as const,
                activeField: null,
                changes: {},
                result: null,
              },
              visibleEvents: [],
            }
          }

          return {
            sessionId: 'session-edit-2',
            activeTurn: null,
            lastTurn: {
              turnId: 'turn-edit-2',
              state: 'completed' as const,
            },
            workflow: {
              kind: 'task_edit' as const,
              phase: 'collecting' as const,
              activeField: 'dueDate' as const,
              changes: {},
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'What due date would you like to set for "Run Quick Discovery"?',
              },
            ],
          }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-quick-discovery',
              title: 'Run Quick Discovery',
              status: 'active' as const,
              notes: 'Capture risks, constraints, and candidate customer calls.',
              dueDate: '2026-04-10',
              dueTime: null,
              priority: 'high' as const,
              completedAt: null,
              source: 'context_task' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'task_action',
          kind: 'edit_task',
        }
      },
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'I want us to edit the Run Quick Discovery task.',
      language: 'unknown',
      message: 'What due date would you like to set for "Run Quick Discovery"?',
      questions: [],
      draft: null,
      taskActionContext: {
        action: 'edit_task',
        task: {
          id: 'task-quick-discovery',
          title: 'Run Quick Discovery',
          status: 'active',
          notes: 'Capture risks, constraints, and candidate customer calls.',
          dueDate: '2026-04-10',
          dueTime: null,
          priority: 'high',
          completedAt: null,
          source: 'context_task',
        },
      },
      taskEditSession: {
        sessionId: 'session-edit-2',
      },
    })

    expect(readCount).toBeGreaterThan(1)
  })

  it('processes typed follow-up edit replies against the same task context', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveTaskEditSession(input) {
          expect(input.sessionId).toBe('session-edit-3')
          return {
            sessionId: 'session-edit-3',
          }
        },
        async submitSessionTurn(input) {
          expect(input.message).toBe('change the due date to tomorrow')
          expect(input.sessionId).toBe('session-edit-3')
          return undefined
        },
        async getSession() {
          return {
            sessionId: 'session-edit-3',
            workflow: {
              kind: 'task_edit' as const,
              phase: 'ready_to_confirm' as const,
              activeField: null,
              changes: {
                dueDate: '2026-04-09',
              },
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'I understood that as editing "Run Quick Discovery" to set due date to 2026-04-09. Confirm if you want me to apply those changes.',
              },
            ],
          }
        },
      },
      taskResolver: {
        async resolveTaskTarget(input) {
          expect(input.contextTaskId).toBe('task-quick-discovery')

          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-quick-discovery',
              title: 'Run Quick Discovery',
              status: 'active' as const,
              notes: 'Capture risks, constraints, and candidate customer calls.',
              dueDate: '2026-04-10',
              dueTime: null,
              priority: 'high' as const,
              completedAt: null,
              source: 'context_task' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        throw new Error('Should not be called')
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'change the due date to tomorrow',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      contextTaskId: 'task-quick-discovery',
      followUpTaskAction: 'edit_task',
      taskEditSessionId: 'session-edit-3',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'change the due date to tomorrow',
      language: 'en',
      message: 'I understood that as editing "Run Quick Discovery" to set due date to 2026-04-09. Confirm if you want me to apply those changes.',
      action: 'edit_task',
      task: {
        id: 'task-quick-discovery',
        title: 'Run Quick Discovery',
        status: 'active',
        notes: 'Capture risks, constraints, and candidate customer calls.',
        dueDate: '2026-04-10',
        dueTime: null,
        priority: 'high',
        completedAt: null,
        source: 'context_task',
      },
      edits: {
        dueDate: '2026-04-09',
      },
      taskEditSession: {
        sessionId: 'session-edit-3',
      },
    })
  })

  it('returns a time-aware task edit confirmation for follow-up session replies', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveTaskEditSession(input) {
          expect(input.sessionId).toBe('session-edit-6')
          return {
            sessionId: 'session-edit-6',
          }
        },
        async submitSessionTurn() {
          return {
            turnId: 'turn-edit-6',
          }
        },
        async getSession() {
          return {
            sessionId: 'session-edit-6',
            activeTurn: null,
            lastTurn: {
              turnId: 'turn-edit-6',
              state: 'completed' as const,
            },
            workflow: {
              kind: 'task_edit' as const,
              phase: 'ready_to_confirm' as const,
              activeField: null,
              changes: {
                dueDate: '2026-05-02',
                dueTime: '18:00',
              },
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'I understood that as editing "Run Quick Discovery" to set due date to 2026-05-02 at 18:00. Confirm if you want me to apply those changes.',
              },
            ],
          }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-quick-discovery',
              title: 'Run Quick Discovery',
              status: 'active' as const,
              notes: 'Capture risks, constraints, and candidate customer calls.',
              dueDate: '2026-04-10',
              dueTime: null,
              priority: 'high' as const,
              completedAt: null,
              source: 'context_task' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        throw new Error('Should not be called')
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'next Saturday at six p.m.',
      language: 'en',
      currentDate: '2026-04-25',
      timezone: 'America/Lima',
      contextTaskId: 'task-quick-discovery',
      followUpTaskAction: 'edit_task',
      taskEditSessionId: 'session-edit-6',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'next Saturday at six p.m.',
      language: 'en',
      message: 'I understood that as editing "Run Quick Discovery" to set due date to 2026-05-02 at 18:00. Confirm if you want me to apply those changes.',
      action: 'edit_task',
      task: {
        id: 'task-quick-discovery',
        title: 'Run Quick Discovery',
        status: 'active',
        notes: 'Capture risks, constraints, and candidate customer calls.',
        dueDate: '2026-04-10',
        dueTime: null,
        priority: 'high',
        completedAt: null,
        source: 'context_task',
      },
      edits: {
        dueDate: '2026-05-02',
        dueTime: '18:00',
      },
      taskEditSession: {
        sessionId: 'session-edit-6',
      },
    })
  })

  it('uses visible task window timing cues to prepare a completion confirmation', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Quiero que cierres la tarea pendiente que estaba para el día sábado a las seis de la tarde.',
            language: 'es' as const,
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
        async resolveTaskTarget(input) {
          expect(input.currentDate).toBe('2026-04-08')
          expect(input.timezone).toBe('America/Lima')
          expect(input.visibleTaskWindow).toEqual([
            {
              id: 'task-1',
              title: 'Call the bank',
              status: 'active',
              dueDate: '2026-04-11',
              dueTime: '18:00',
              priority: 'medium',
              completedAt: null,
            },
          ])

          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-1',
              title: 'Call the bank',
              status: 'active' as const,
              dueDate: '2026-04-11',
              dueTime: '18:00',
              priority: 'medium' as const,
              completedAt: null,
              source: 'visible_window' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'task_action',
          kind: 'complete_task',
        }
      },
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Call the bank',
          status: 'active',
          dueDate: '2026-04-11',
          dueTime: '18:00',
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'Quiero que cierres la tarea pendiente que estaba para el día sábado a las seis de la tarde.',
      language: 'es',
      message: 'Entendí eso como completar la tarea "Call the bank". Confirma si quieres que la marque como completada.',
      action: 'complete_task',
      task: {
        id: 'task-1',
        title: 'Call the bank',
        status: 'active',
        dueDate: '2026-04-11',
        dueTime: '18:00',
        priority: 'medium',
        completedAt: null,
        source: 'visible_window',
      },
    })
  })

  it('returns a task action confirmation for resolved reopen requests', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Reopen this task',
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
        async confirmVoiceTaskAction() {
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
      outcome: 'task_action_confirmation',
      transcript: 'Reopen this task',
      language: 'en',
      message: 'I understood that as reopening the task "Call the bank". Confirm if you want me to move it back to active.',
      action: 'reopen_task',
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

  it('clarifies when a completion request targets an already completed task', async () => {
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
        async confirmVoiceTaskAction() {
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
              dueDate: null,
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
      outcome: 'clarify',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'The task "Call the bank" is already completed.',
      questions: ['Do you want to do anything else with this task?'],
      draft: null,
      taskActionContext: {
        action: 'complete_task',
        task: {
          id: 'task-123',
          title: 'Call the bank',
          status: 'completed',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: '2026-04-09T15:00:00.000Z',
          source: 'context_task',
        },
      },
    })
  })

  it('clarifies when a reopen request targets an already active task', async () => {
    const processor = createTestVoiceCaptureProcessor({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Reopen this task',
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
        async confirmVoiceTaskAction() {
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
      transcript: 'Reopen this task',
      language: 'en',
      message: 'The task "Call the bank" is already active.',
      questions: ['Do you want to do anything else with this task?'],
      draft: null,
      taskActionContext: {
        action: 'reopen_task',
        task: {
          id: 'task-123',
          title: 'Call the bank',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'context_task',
        },
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
      message: 'I need to know which task you mean before I can do that.',
      questions: ['Which task do you mean?'],
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
      outcome: 'task_action_confirmation',
      transcript: 'Mark this task as done',
      language: 'en',
      message: 'I understood that as completing the task "Call the bank". Confirm if you want me to mark it as completed.',
      action: 'complete_task',
      task: {
        id: 'task-123',
        title: 'Call the bank',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'context_task',
      },
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

  it('uses the visible task window when no explicit context is provided', async () => {
    const processor = createVoiceCaptureProcessor({
      voiceIntentClassifier: {
        async classify() {
          return { family: 'task_action' as const, kind: 'complete_task' as const }
        },
      },
      taskResolver: {
        async resolveTaskTarget(input) {
          expect(input.visibleTaskWindow).toEqual([
            {
              id: 'task-1',
              title: 'Review launch checklist',
              status: 'active',
              dueDate: null,
              dueTime: null,
              priority: 'medium',
              completedAt: null,
            },
          ])

          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-1',
              title: 'Review launch checklist',
              status: 'active' as const,
              dueDate: null,
              dueTime: null,
              priority: 'medium' as const,
              completedAt: null,
              source: 'visible_window' as const,
            },
          }
        },
      },
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Mark review launch checklist as done',
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
    })

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Review launch checklist',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'Mark review launch checklist as done',
      language: 'en',
      message: 'I understood that as completing the task "Review launch checklist". Confirm if you want me to mark it as completed.',
      action: 'complete_task',
      task: {
        id: 'task-1',
        title: 'Review launch checklist',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'visible_window',
      },
    })
  })

  it('clarifies instead of guessing when the visible task window has no meaningful match', async () => {
    const processor = createVoiceCaptureProcessor({
      voiceIntentClassifier: {
        async classify() {
          return { family: 'task_action' as const, kind: 'complete_task' as const }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'unresolved' as const,
          }
        },
      },
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Quiero que completemos la tarea relacionada a las tobilleras para el buen treno de básquetbol.',
            language: 'es' as const,
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

    const result = await processor.processVoiceCapture({
      ...sampleUpload,
      visibleTaskWindow: [
        {
          id: 'task-1',
          title: 'Tarea pendiente para el día sábado a las seis de la tarde',
          status: 'active',
          dueDate: '2026-04-11',
          dueTime: '18:00',
          priority: 'medium',
          completedAt: null,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Quiero que completemos la tarea relacionada a las tobilleras para el buen treno de básquetbol.',
      language: 'es',
      message: 'I need to know which task you mean before I can do that.',
      questions: ['Which task do you mean?'],
      draft: null,
    })
  })

  it('returns a task action confirmation for resolved archive requests', async () => {
    const processor = createVoiceCaptureProcessor({
      voiceIntentClassifier: {
        async classify() {
          return { family: 'task_action' as const, kind: 'archive_task' as const }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-123',
              title: 'Better onboarding',
              status: 'active' as const,
              dueDate: null,
              dueTime: null,
              priority: 'medium' as const,
              completedAt: null,
              source: 'visible_window' as const,
            },
          }
        },
      },
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'I want us to close the better on boarding as archived.',
            language: 'unknown' as const,
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
      ok: true,
      outcome: 'task_action_confirmation',
      transcript: 'I want us to close the better on boarding as archived.',
      language: 'unknown',
      message: 'I understood that as archiving the task "Better onboarding". Confirm if you want me to archive it.',
      action: 'archive_task',
      task: {
        id: 'task-123',
        title: 'Better onboarding',
        status: 'active',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
        completedAt: null,
        source: 'visible_window',
      },
    })
  })

  it('clarifies when an archive request targets an already archived task', async () => {
    const processor = createVoiceCaptureProcessor({
      voiceIntentClassifier: {
        async classify() {
          return { family: 'task_action' as const, kind: 'archive_task' as const }
        },
      },
      taskResolver: {
        async resolveTaskTarget() {
          return {
            kind: 'resolved' as const,
            task: {
              id: 'task-123',
              title: 'Better onboarding',
              status: 'archived' as const,
              dueDate: null,
              dueTime: null,
              priority: 'medium' as const,
              completedAt: null,
              source: 'visible_window' as const,
            },
          }
        },
      },
      transcriptionBroker: {
        async transcribeAudioUpload() {
          return {
            ok: true as const,
            transcript: 'Archive this task',
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
    })

    const result = await processor.processVoiceCapture(sampleUpload)

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Archive this task',
      language: 'en',
      message: 'The task "Better onboarding" is already archived.',
      questions: ['Do you want to do anything else with this task?'],
      draft: null,
      taskActionContext: {
        action: 'archive_task',
        task: {
          id: 'task-123',
          title: 'Better onboarding',
          status: 'archived',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          completedAt: null,
          source: 'visible_window',
        },
      },
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

  it('boots calendar create sessions with a validated writable alternate calendar target', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveCalendarEventCreateSession(input) {
          expect(input.draft).toEqual({
            targetCalendarId: 'side-projects',
            targetCalendarName: 'Side Projects',
          })
          expect(input.writableCalendars).toEqual([
            {
              calendarId: 'primary',
              calendarName: 'Primary',
              primaryFlag: true,
            },
            {
              calendarId: 'side-projects',
              calendarName: 'Side Projects',
              primaryFlag: false,
            },
          ])
          return {
            sessionId: 'session-calendar-1',
          }
        },
        async submitSessionTurn(input) {
          expect(input.context).toEqual({
            target: {
              kind: 'calendar_event',
              id: 'side-projects',
              label: 'Side Projects',
            },
            writableCalendars: [
              {
                calendarId: 'primary',
                calendarName: 'Primary',
                primaryFlag: true,
              },
              {
                calendarId: 'side-projects',
                calendarName: 'Side Projects',
                primaryFlag: false,
              },
            ],
          })
          expect(input.workflow).toBeUndefined()
          return {
            turnId: 'turn-calendar-1',
          }
        },
        async getSession() {
          return {
            sessionId: 'session-calendar-1',
            activeTurn: null,
            lastTurn: {
              turnId: 'turn-calendar-1',
              state: 'completed' as const,
            },
            workflow: {
              kind: 'calendar_event' as const,
              operation: 'create' as const,
              phase: 'ready_to_confirm' as const,
              draft: {
                title: 'Team sync',
                startDate: '2026-04-09',
                targetCalendarId: 'side-projects',
                targetCalendarName: 'Side Projects',
              },
              changes: {
                title: 'Team sync',
                startDate: '2026-04-09',
                targetCalendarId: 'side-projects',
                targetCalendarName: 'Side Projects',
              },
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'I understood that as creating a calendar event with title "Team sync", date 2026-04-09 all day, calendar Side Projects. Confirm if you want me to apply those changes.',
              },
            ],
          }
        },
      },
      calendarResolver: {
        async resolveCalendarTarget() {
          return {
            kind: 'resolved_alternate' as const,
            target: {
              calendarId: 'side-projects',
              calendarName: 'Side Projects',
              primaryFlag: false,
              isSelected: false,
            },
            writableCalendars: [
              {
                calendarId: 'primary',
                calendarName: 'Primary',
                primaryFlag: true,
              },
              {
                calendarId: 'side-projects',
                calendarName: 'Side Projects',
                primaryFlag: false,
              },
            ],
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'create_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Schedule team sync tomorrow on the Side Projects calendar',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'calendar_event_confirmation',
      transcript: 'Schedule team sync tomorrow on the Side Projects calendar',
      language: 'en',
      message: 'I understood that as creating a calendar event with title "Team sync", date 2026-04-09 all day, calendar Side Projects. Confirm if you want me to apply those changes.',
      calendarEvent: {
        title: 'Team sync',
        startDate: '2026-04-09',
        targetCalendarId: 'side-projects',
        targetCalendarName: 'Side Projects',
        allDay: true,
      },
      calendarEventSession: {
        sessionId: 'session-calendar-1',
      },
    })
  })

  it('clarifies when an explicitly named alternate calendar is unavailable', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveCalendarEventCreateSession() {
          throw new Error('Should not be called')
        },
        async submitSessionTurn() {
          throw new Error('Should not be called')
        },
        async getSession() {
          throw new Error('Should not be called')
        },
      },
      calendarResolver: {
        async resolveCalendarTarget() {
          return {
            kind: 'unavailable' as const,
            attemptedName: 'marketing',
            writableCalendars: [
              {
                calendarId: 'primary',
                calendarName: 'Primary',
                primaryFlag: true,
              },
            ],
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'create_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Schedule team sync tomorrow on the Marketing calendar',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Schedule team sync tomorrow on the Marketing calendar',
      language: 'en',
      message: 'I couldn\'t find a writable calendar named "marketing".',
      questions: ['Which calendar should I use instead? Available writable calendars: Primary.'],
      draft: null,
      calendarEvent: {
        targetCalendarId: null,
        targetCalendarName: 'marketing',
      },
    })
  })

  it('clarifies when an explicitly named alternate calendar is ambiguous', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveCalendarEventCreateSession() {
          throw new Error('Should not be called')
        },
        async submitSessionTurn() {
          throw new Error('Should not be called')
        },
        async getSession() {
          throw new Error('Should not be called')
        },
      },
      calendarResolver: {
        async resolveCalendarTarget() {
          return {
            kind: 'ambiguous' as const,
            attemptedName: 'team',
            candidates: [
              {
                calendarId: 'team-a',
                calendarName: 'Team',
                primaryFlag: false,
                isSelected: true,
              },
              {
                calendarId: 'team-b',
                calendarName: 'Team',
                primaryFlag: false,
                isSelected: false,
              },
            ],
            writableCalendars: [
              {
                calendarId: 'primary',
                calendarName: 'Primary',
                primaryFlag: true,
              },
              {
                calendarId: 'team-a',
                calendarName: 'Team',
                primaryFlag: false,
              },
              {
                calendarId: 'team-b',
                calendarName: 'Team',
                primaryFlag: false,
              },
            ],
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'create_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Schedule team sync tomorrow on the Team calendar',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Schedule team sync tomorrow on the Team calendar',
      language: 'en',
      message: 'I found more than one matching writable calendar, so I need to know which one you mean.',
      questions: ['Did you mean the Team calendar?', 'Did you mean the Team calendar?'],
      draft: null,
      calendarEvent: {
        targetCalendarId: null,
        targetCalendarName: 'team',
      },
    })
  })

  it('clarifies when an explicitly named alternate calendar is read-only', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveCalendarEventCreateSession() {
          throw new Error('Should not be called')
        },
        async submitSessionTurn() {
          throw new Error('Should not be called')
        },
        async getSession() {
          throw new Error('Should not be called')
        },
      },
      calendarResolver: {
        async resolveCalendarTarget() {
          return {
            kind: 'read_only' as const,
            attemptedName: 'Finance',
            calendar: {
              calendarId: 'finance',
              calendarName: 'Finance',
              primaryFlag: false,
            },
            writableCalendars: [
              {
                calendarId: 'primary',
                calendarName: 'Primary',
                primaryFlag: true,
              },
              {
                calendarId: 'side-projects',
                calendarName: 'Side Projects',
                primaryFlag: false,
              },
            ],
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'create_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Schedule team sync tomorrow on the Finance calendar',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Schedule team sync tomorrow on the Finance calendar',
      language: 'en',
      message: "The Finance calendar is read-only, so I can't create events there.",
      questions: ['Which writable calendar should I use instead? Available options: Primary, Side Projects.'],
      draft: null,
      calendarEvent: {
        targetCalendarId: null,
        targetCalendarName: 'Finance',
      },
    })
  })

  it('resolves a visible calendar event target for edit and keeps the flow in clarification for now', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      calendarResolver: {
        async resolveCalendarEventTarget() {
          return {
            kind: 'resolved' as const,
            target: {
              calendarEventId: 'evt-team-sync',
              summary: 'Team sync',
              startsAt: '2026-04-08T15:00:00.000Z',
              endsAt: '2026-04-08T15:30:00.000Z',
              allDay: false,
              calendarName: 'Side Projects',
              primaryFlag: false,
              source: 'visible_window' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'edit_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Edit the team sync on Side Projects',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-team-sync',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'calendar_event_confirmation',
      transcript: 'Edit the team sync on Side Projects',
      language: 'en',
      message: 'I found "Team sync" on Side Projects. Confirm if you want me to edit it.',
      calendarEvent: {
        operation: 'edit_calendar_event',
        target: {
          calendarEventId: 'evt-team-sync',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
          source: 'visible_window',
        },
      },
    })
  })

  it('routes a resolved visible calendar event edit request through assistant session resolution', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      assistantSessionService: {
        async resolveCalendarEventCreateSession() {
          throw new Error('Should not be called')
        },
        async resolveCalendarEventEditSession(input) {
          expect(input).toEqual({
            currentDate: '2026-04-08',
            timezone: 'America/Lima',
            target: {
              eventId: 'evt-team-sync',
              summary: 'Team sync',
              calendarName: 'Side Projects',
            },
            draft: {},
          })
          return { sessionId: 'session-calendar-edit-1' }
        },
        async resolveCalendarEventCancelSession() {
          throw new Error('Should not be called')
        },
        async submitSessionTurn(input) {
          expect(input.sessionId).toBe('session-calendar-edit-1')
          expect(input.context).toEqual({
            target: {
              kind: 'calendar_event',
              id: 'evt-team-sync',
              label: 'Team sync',
            },
          })
          return { turnId: 'turn-calendar-edit-1' }
        },
        async getSession() {
          return {
            sessionId: 'session-calendar-edit-1',
            activeTurn: null,
            lastTurn: {
              turnId: 'turn-calendar-edit-1',
              state: 'completed' as const,
            },
            workflow: {
              kind: 'calendar_event' as const,
              operation: 'edit' as const,
              phase: 'ready_to_confirm' as const,
              currentDate: '2026-04-08',
              timezone: 'America/Lima',
              target: {
                eventId: 'evt-team-sync',
                summary: 'Team sync',
                calendarName: 'Side Projects',
              },
              draft: {},
              requestedFields: [],
              missingFields: [],
              activeField: null,
              fieldAttempts: { title: 0, description: 0, startDate: 0, startTime: 0, endDate: 0, endTime: 0, location: 0 },
              changes: {},
              result: null,
            },
            visibleEvents: [
              {
                type: 'assistant_question' as const,
                summary: 'I found "Team sync" on Side Projects. Confirm if you want me to edit it.',
              },
            ],
          }
        },
      },
      calendarResolver: {
        async resolveCalendarEventTarget() {
          return {
            kind: 'resolved' as const,
            target: {
              calendarEventId: 'evt-team-sync',
              summary: 'Team sync',
              startsAt: '2026-04-08T15:00:00.000Z',
              endsAt: '2026-04-08T15:30:00.000Z',
              allDay: false,
              calendarName: 'Side Projects',
              primaryFlag: false,
              source: 'visible_window' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'edit_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Edit the team sync on Side Projects',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-team-sync',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'calendar_event_confirmation',
      transcript: 'Edit the team sync on Side Projects',
      language: 'en',
      message: 'I found "Team sync" on Side Projects. Confirm if you want me to edit it.',
      calendarEvent: {
        operation: 'edit_calendar_event',
        target: {
          calendarEventId: 'evt-team-sync',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
          source: 'visible_window',
        },
      },
      calendarEventSession: {
        sessionId: 'session-calendar-edit-1',
      },
    })
  })

  it('clarifies when a visible calendar event target is ambiguous', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      calendarResolver: {
        async resolveCalendarEventTarget() {
          return {
            kind: 'ambiguous' as const,
            candidates: [
              {
                calendarEventId: 'evt-team-sync-a',
                summary: 'Team sync',
                startsAt: '2026-04-08T15:00:00.000Z',
                endsAt: '2026-04-08T15:30:00.000Z',
                allDay: false,
                calendarName: 'Primary',
                primaryFlag: true,
                source: 'visible_window' as const,
              },
              {
                calendarEventId: 'evt-team-sync-b',
                summary: 'Team sync',
                startsAt: '2026-04-08T17:00:00.000Z',
                endsAt: '2026-04-08T17:30:00.000Z',
                allDay: false,
                calendarName: 'Side Projects',
                primaryFlag: false,
                source: 'visible_window' as const,
              },
            ],
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'cancel_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Cancel the team sync',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-team-sync-a',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
        },
        {
          calendarEventId: 'evt-team-sync-b',
          summary: 'Team sync',
          startsAt: '2026-04-08T17:00:00.000Z',
          endsAt: '2026-04-08T17:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'clarify',
      transcript: 'Cancel the team sync',
      language: 'en',
      message: 'I found more than one matching event, so I need to know which one you want to cancel.',
      questions: [
        'Did you mean "Team sync" on Primary at 2026-04-08T15:00:00.000Z?',
        'Did you mean "Team sync" on Side Projects at 2026-04-08T17:00:00.000Z?',
      ],
      draft: null,
      calendarEventTargetCandidates: [
        {
          calendarEventId: 'evt-team-sync-a',
          summary: 'Team sync',
          startsAt: '2026-04-08T15:00:00.000Z',
          endsAt: '2026-04-08T15:30:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
          source: 'visible_window',
        },
        {
          calendarEventId: 'evt-team-sync-b',
          summary: 'Team sync',
          startsAt: '2026-04-08T17:00:00.000Z',
          endsAt: '2026-04-08T17:30:00.000Z',
          allDay: false,
          calendarName: 'Side Projects',
          primaryFlag: false,
          source: 'visible_window',
        },
      ],
    })
  })

  it('returns a confirmation payload for a visible calendar event cancel request', async () => {
    const processor = createProcessorWithIntentClassifier({
      transcriptionBroker: {
        async transcribeAudioUpload() {
          throw new Error('Should not be called')
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
      calendarResolver: {
        async resolveCalendarEventTarget() {
          return {
            kind: 'resolved' as const,
            target: {
              calendarEventId: 'evt-retro',
              summary: 'Retro',
              startsAt: '2026-04-08T20:00:00.000Z',
              endsAt: '2026-04-08T21:00:00.000Z',
              allDay: false,
              calendarName: 'Primary',
              primaryFlag: true,
              source: 'visible_window' as const,
            },
          }
        },
      },
    }, {
      async classify() {
        return {
          family: 'calendar_action',
          kind: 'cancel_calendar_event',
        }
      },
    })

    const result = await processor.processVoiceTranscript({
      transcript: 'Cancel the retro',
      language: 'en',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      visibleCalendarEventWindow: [
        {
          calendarEventId: 'evt-retro',
          summary: 'Retro',
          startsAt: '2026-04-08T20:00:00.000Z',
          endsAt: '2026-04-08T21:00:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
        },
      ],
    })

    expect(result).toEqual({
      ok: true,
      outcome: 'calendar_event_confirmation',
      transcript: 'Cancel the retro',
      language: 'en',
      message: 'I found "Retro" on Primary. Confirm if you want me to cancel it.',
      calendarEvent: {
        operation: 'cancel_calendar_event',
        target: {
          calendarEventId: 'evt-retro',
          summary: 'Retro',
          startsAt: '2026-04-08T20:00:00.000Z',
          endsAt: '2026-04-08T21:00:00.000Z',
          allDay: false,
          calendarName: 'Primary',
          primaryFlag: true,
          source: 'visible_window',
        },
      },
    })
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
