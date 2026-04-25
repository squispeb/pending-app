import {
  buildVoiceTaskActionAlreadyAppliedMessage,
  buildVoiceTaskActionConfirmationMessage,
  buildVoiceClarificationMessage,
  buildVoiceClarificationQuestions,
  buildVoiceTaskStatusMessage,
  draftToHabitCreateInput,
  draftToTaskCreateInput,
  type ConfirmVoiceTaskActionKind,
  evaluateVoiceCaptureConfidence,
  type ProcessVoiceCaptureInput,
  type ProcessVoiceCaptureResponse,
} from '../lib/capture'
import { createCaptureService } from './capture-service'
import { createTranscriptionBroker } from './transcription'
import { buildVoiceActionClarification, createVoiceIntentRouter, type VoiceIntentClassifier } from './voice-intent-router'

const transcriptionBroker = createTranscriptionBroker()

type VoiceCaptureService = {
  interpretTypedTaskInput: Pick<ReturnType<typeof createCaptureService>, 'interpretTypedTaskInput'>['interpretTypedTaskInput'] extends (
    userId: string,
    input: infer T,
  ) => Promise<infer R>
    ? (input: T) => Promise<R>
    : never
  confirmCapturedTask: Pick<ReturnType<typeof createCaptureService>, 'confirmCapturedTask'>['confirmCapturedTask'] extends (
    userId: string,
    input: infer T,
  ) => Promise<infer R>
    ? (input: T) => Promise<R>
    : never
  confirmCapturedHabit: Pick<ReturnType<typeof createCaptureService>, 'confirmCapturedHabit'>['confirmCapturedHabit'] extends (
    userId: string,
    input: infer T,
  ) => Promise<infer R>
    ? (input: T) => Promise<R>
    : never
}

type VoiceTaskResolver = {
  resolveTaskTarget: (input: {
    transcript: string
    contextTaskId?: string | null
    contextIdeaId?: string | null
    visibleTaskWindow?: Array<{
      id: string
      title: string
      status: 'active' | 'completed' | 'archived'
      dueDate: string | null
      dueTime: string | null
      priority: 'low' | 'medium' | 'high'
      completedAt: string | null
    }> | null
  }) => Promise<
    | {
        kind: 'resolved'
        task: {
          id: string
          title: string
          status: 'active' | 'completed' | 'archived'
          dueDate: string | null
          dueTime: string | null
          priority: 'low' | 'medium' | 'high'
          completedAt: string | null
          source: 'context_task' | 'context_idea' | 'visible_window'
        }
      }
    | {
        kind: 'ambiguous'
        candidates: Array<{
          id: string
          title: string
          status: 'active' | 'completed' | 'archived'
          dueDate: string | null
          dueTime: string | null
          priority: 'low' | 'medium' | 'high'
          completedAt: string | null
          source: 'context_task' | 'context_idea' | 'visible_window'
        }>
      }
    | { kind: 'unresolved' }
  >
}

export function createVoiceCaptureProcessor(
  dependencies: {
    transcriptionBroker: Pick<ReturnType<typeof createTranscriptionBroker>, 'transcribeAudioUpload'>
    captureService: VoiceCaptureService
    voiceIntentClassifier?: VoiceIntentClassifier | null
    taskResolver?: VoiceTaskResolver
  },
) {
  const voiceIntentRouter = createVoiceIntentRouter({
    classifier: dependencies.voiceIntentClassifier,
  })

  function isTaskActionAlreadyApplied(
    action: ConfirmVoiceTaskActionKind,
    status: 'active' | 'completed' | 'archived',
  ) {
    return (
      (action === 'complete_task' && status === 'completed') ||
      (action === 'reopen_task' && status === 'active') ||
      (action === 'archive_task' && status === 'archived')
    )
  }

  return {
    async processVoiceCapture(data: ProcessVoiceCaptureInput): Promise<ProcessVoiceCaptureResponse> {
      const transcription = await dependencies.transcriptionBroker.transcribeAudioUpload({
        audio: data.audio,
        languageHint: data.languageHint,
        source: data.source,
      })

      if (!transcription.ok) {
        return transcription
      }

      const voiceIntent = await voiceIntentRouter.classifyVoiceIntent(transcription.transcript)

      if (voiceIntent.family === 'task_action' && voiceIntent.kind === 'unsupported_task_action') {
        const clarification = buildVoiceActionClarification(voiceIntent)

        return {
          ok: true,
          outcome: 'clarify',
          transcript: transcription.transcript,
          language: transcription.language,
          message: clarification.message,
          questions: clarification.questions,
          draft: null,
        }
      }

      if (voiceIntent.family === 'task_action' && dependencies.taskResolver) {
        const resolution = await dependencies.taskResolver.resolveTaskTarget({
          transcript: transcription.transcript,
          currentDate: data.currentDate,
          timezone: data.timezone,
          contextTaskId: data.contextTaskId,
          contextIdeaId: data.contextIdeaId,
          visibleTaskWindow: data.visibleTaskWindow,
        })

        if (resolution.kind === 'resolved') {
          if (voiceIntent.kind === 'task_status') {
            return {
              ok: true,
              outcome: 'task_status',
              transcript: transcription.transcript,
              language: transcription.language,
              message: buildVoiceTaskStatusMessage(
                {
                  title: resolution.task.title,
                  status: resolution.task.status,
                  priority: resolution.task.priority,
                  dueDate: resolution.task.dueDate,
                  dueTime: resolution.task.dueTime,
                  completedAt: resolution.task.completedAt,
                },
                transcription.language,
              ),
              task: resolution.task,
            }
          }

          if (
            voiceIntent.kind === 'complete_task' ||
            voiceIntent.kind === 'reopen_task' ||
            voiceIntent.kind === 'archive_task'
          ) {
            if (isTaskActionAlreadyApplied(voiceIntent.kind, resolution.task.status)) {
              return {
                ok: true,
                outcome: 'clarify',
                transcript: transcription.transcript,
                language: transcription.language,
                message: buildVoiceTaskActionAlreadyAppliedMessage(
                  resolution.task,
                  voiceIntent.kind,
                  transcription.language,
                ),
                questions: ['Do you want to do anything else with this task?'],
                draft: null,
              }
            }

            return {
              ok: true,
              outcome: 'task_action_confirmation',
              transcript: transcription.transcript,
              language: transcription.language,
              message: buildVoiceTaskActionConfirmationMessage(
                resolution.task,
                voiceIntent.kind,
                transcription.language,
              ),
              action: voiceIntent.kind,
              task: resolution.task,
            }
          }

          return {
            ok: true,
            outcome: 'clarify',
            transcript: transcription.transcript,
            language: transcription.language,
            message: `I understood that as a task action for \"${resolution.task.title}\", but voice task actions are not available yet.`,
            questions: ['Do you want to use this task as the target once voice task actions are enabled?'],
            draft: null,
          }
        }

        if (resolution.kind === 'ambiguous') {
          const message =
            voiceIntent.kind === 'task_status'
              ? 'I need to confirm which task you mean before I can check its status.'
              : 'I need to confirm which task you mean before I can do that.'

          return {
            ok: true,
            outcome: 'clarify',
            transcript: transcription.transcript,
            language: transcription.language,
            message,
            questions: resolution.candidates.slice(0, 3).map((candidate) => `Did you mean \"${candidate.title}\"?`),
            draft: null,
          }
        }

        if (voiceIntent.kind !== 'unsupported_task_action') {
          return {
            ok: true,
            outcome: 'clarify',
            transcript: transcription.transcript,
            language: transcription.language,
            message:
              voiceIntent.kind === 'task_status'
                ? 'I need to know which task you mean before I can check its status.'
                : 'I need to know which task you mean before I can do that.',
            questions: ['Which task do you mean?'],
            draft: null,
          }
        }
      }

      if (voiceIntent.family !== 'creation') {
        const clarification = buildVoiceActionClarification(voiceIntent)

        return {
          ok: true,
          outcome: 'clarify',
          transcript: transcription.transcript,
          language: transcription.language,
          message: clarification.message,
          questions: clarification.questions,
          draft: null,
        }
      }

      const languageHint = transcription.language === 'unknown' ? undefined : transcription.language
      const interpretation = await dependencies.captureService.interpretTypedTaskInput({
        rawInput: transcription.transcript,
        currentDate: data.currentDate,
        timezone: data.timezone,
        languageHint,
      })

      if (!interpretation.ok) {
        return interpretation
      }

      const confidence = evaluateVoiceCaptureConfidence(
        interpretation.draft,
        transcription.transcript,
      )

      if (data.routeIntent === 'ideas') {
        return {
          ok: true,
          outcome: 'idea_confirmation',
          transcript: transcription.transcript,
          language: transcription.language,
          draft: {
            ...interpretation.draft,
            candidateType: 'idea',
          },
        }
      }

      if (confidence === 'high') {
        const draftTitle = interpretation.draft.title ?? transcription.transcript

        if (interpretation.draft.candidateType === 'idea') {
          return {
            ok: true,
            outcome: 'idea_confirmation',
            transcript: transcription.transcript,
            language: transcription.language,
            draft: interpretation.draft,
          }
        }

        if (interpretation.draft.candidateType === 'habit') {
          const created = await dependencies.captureService.confirmCapturedHabit({
            rawInput: transcription.transcript,
            matchedCalendarContext: interpretation.draft.matchedCalendarContext,
            habit: draftToHabitCreateInput(interpretation.draft),
          })

          return {
            ok: true,
            outcome: 'auto_saved',
            candidateType: 'habit',
            createdId: created.id,
            title: draftTitle,
            transcript: transcription.transcript,
            language: transcription.language,
            matchedCalendarContext: interpretation.draft.matchedCalendarContext,
          }
        }

        const created = await dependencies.captureService.confirmCapturedTask({
          rawInput: transcription.transcript,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
          task: draftToTaskCreateInput(interpretation.draft),
        })

        return {
          ok: true,
          outcome: 'auto_saved',
          candidateType: 'task',
          createdId: created.id,
          title: draftTitle,
          transcript: transcription.transcript,
          language: transcription.language,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
        }
      }

      if (confidence === 'clarify') {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: transcription.transcript,
          language: transcription.language,
          message: buildVoiceClarificationMessage(
            interpretation.draft,
            transcription.transcript,
          ),
          questions: buildVoiceClarificationQuestions(
            interpretation.draft,
            transcription.transcript,
          ),
          draft: interpretation.draft,
        }
      }

      return {
        ok: true,
        outcome: 'review',
        transcript: transcription.transcript,
        language: transcription.language,
        draft: interpretation.draft,
      }
    },
  }
}
