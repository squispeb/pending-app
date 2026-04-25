import {
  buildVoiceTaskActionAlreadyAppliedMessage,
  buildVoiceTaskActionConfirmationMessage,
  buildVoiceTaskEditConfirmationMessage,
  buildVoiceClarificationMessage,
  buildVoiceClarificationQuestions,
  inferVoiceTaskEditChanges,
  buildVoiceTaskStatusMessage,
  draftToHabitCreateInput,
  draftToTaskCreateInput,
  type ConfirmVoiceTaskActionKind,
  evaluateVoiceCaptureConfidence,
  type ProcessVoiceCaptureInput,
  type ProcessVoiceCaptureResponse,
  type ProcessVoiceCaptureTextInput,
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

type AssistantSessionService = {
  resolveTaskEditSession: (input: {
    sessionId?: string
    task: {
      taskId: string
      title: string
      notes?: string | null
      dueDate?: string | null
      dueTime?: string | null
      priority?: 'low' | 'medium' | 'high' | null
    }
    routeIntent?: ProcessVoiceCaptureTextInput['routeIntent']
    requestedFields?: Array<'title' | 'description' | 'dueDate' | 'dueTime'>
    activeField?: 'title' | 'description' | 'dueDate' | 'dueTime' | null
  }) => Promise<{
    sessionId: string
  }>
  getSession: (sessionId: string) => Promise<{
    sessionId: string
    workflow: {
      kind: 'task_edit'
      phase: 'collecting' | 'ready_to_confirm' | 'completed' | 'blocked'
      activeField: 'title' | 'description' | 'dueDate' | 'dueTime' | null
      changes: {
        title?: string
        description?: string
        dueDate?: string
        dueTime?: string
      }
      result: {
        outcome: 'confirmed' | 'cancelled'
        applyPayload: {
          action: 'edit_task'
          taskId: string
          edits: {
            title?: string
            description?: string
            dueDate?: string
            dueTime?: string
          }
        } | null
      } | null
    } | null
    visibleEvents: Array<{
      type: 'session_started' | 'user_turn_added' | 'assistant_question' | 'assistant_synthesis' | 'assistant_failed'
      summary: string
    }>
  }>
  submitSessionTurn: (input: {
    sessionId: string
    message: string
    source: 'text' | 'voice'
    transcriptLanguage?: 'es' | 'en' | 'unknown' | null
  }) => Promise<{
    turnId?: string
  } | unknown>
}

type ResolvedTask = {
  id: string
  title: string
  status: 'active' | 'completed' | 'archived'
  notes?: string | null
  dueDate: string | null
  dueTime: string | null
  priority: 'low' | 'medium' | 'high'
  completedAt: string | null
  source: 'context_task' | 'context_idea' | 'visible_window'
}

type VoiceTaskResolver = {
  resolveTaskTarget: (input: {
    transcript: string
    currentDate?: string
    timezone?: string
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
        task: ResolvedTask
      }
    | {
        kind: 'ambiguous'
        candidates: Array<ResolvedTask>
      }
    | { kind: 'unresolved' }
  >
}

type TaskActionTranscriptInput = {
  transcript: string
  language: ProcessVoiceCaptureTextInput['language']
  currentDate: string
  timezone: string
  routeIntent?: ProcessVoiceCaptureTextInput['routeIntent']
  contextTaskId?: string | null
  contextIdeaId?: string | null
  visibleTaskWindow?: ProcessVoiceCaptureTextInput['visibleTaskWindow']
  followUpTaskAction?: ConfirmVoiceTaskActionKind
  taskEditSessionId?: string | null
}

function mapTaskEditRequestedFields(changes: ReturnType<typeof inferVoiceTaskEditChanges>) {
  if (!changes) {
    return []
  }

  const fields: Array<'title' | 'description' | 'dueDate' | 'dueTime'> = []

  if (changes.title) {
    fields.push('title')
  }

  if (changes.description !== undefined) {
    fields.push('description')
  }

  if (changes.dueDate !== undefined) {
    fields.push('dueDate')
  }

  if (changes.dueTime !== undefined) {
    fields.push('dueTime')
  }

  return fields
}

function getLatestAssistantSessionSummary(
  session: Awaited<ReturnType<AssistantSessionService['getSession']>>,
  type: 'assistant_question' | 'assistant_synthesis' | 'assistant_failed',
) {
  return session.visibleEvents
    .filter((event) => event.type === type)
    .at(-1)?.summary ?? null
}

async function waitForAssistantSessionTurnSettlement(args: {
  assistantSessionService: AssistantSessionService
  sessionId: string
  submittedTurnId?: string | null
}) {
  const maxAttempts = 40

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const session = await args.assistantSessionService.getSession(args.sessionId)
    const lastTurn = session.lastTurn
    const turnMatches = args.submittedTurnId ? lastTurn?.turnId === args.submittedTurnId : true
    const isSettled = !session.activeTurn && turnMatches && !!lastTurn && (lastTurn.state === 'completed' || lastTurn.state === 'failed')

    if (isSettled) {
      return session
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return args.assistantSessionService.getSession(args.sessionId)
}

export function createVoiceCaptureProcessor(
  dependencies: {
    transcriptionBroker: Pick<ReturnType<typeof createTranscriptionBroker>, 'transcribeAudioUpload'>
    captureService: VoiceCaptureService
    assistantSessionService?: AssistantSessionService
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

  async function processTranscript(data: TaskActionTranscriptInput): Promise<ProcessVoiceCaptureResponse> {
    const voiceIntent =
      data.followUpTaskAction
        ? {
            family: 'task_action' as const,
            kind: data.followUpTaskAction,
          }
        : await voiceIntentRouter.classifyVoiceIntent(data.transcript)

    if (voiceIntent.family === 'task_action' && voiceIntent.kind === 'unsupported_task_action') {
      const clarification = buildVoiceActionClarification(voiceIntent)

      return {
        ok: true,
        outcome: 'clarify',
        transcript: data.transcript,
        language: data.language,
        message: clarification.message,
        questions: clarification.questions,
        draft: null,
      }
    }

    if (voiceIntent.family === 'task_action' && dependencies.taskResolver) {
      const taskEditChanges =
        voiceIntent.kind === 'edit_task'
          ? inferVoiceTaskEditChanges({
              rawInput: data.transcript,
              currentDate: data.currentDate,
              timezone: data.timezone,
            })
          : null

      const resolution = await dependencies.taskResolver.resolveTaskTarget({
        transcript: data.transcript,
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
            transcript: data.transcript,
            language: data.language,
            message: buildVoiceTaskStatusMessage(
              {
                title: resolution.task.title,
                status: resolution.task.status,
                priority: resolution.task.priority,
                dueDate: resolution.task.dueDate,
                dueTime: resolution.task.dueTime,
                completedAt: resolution.task.completedAt,
              },
              data.language,
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
              transcript: data.transcript,
              language: data.language,
              message: buildVoiceTaskActionAlreadyAppliedMessage(
                resolution.task,
                voiceIntent.kind,
                data.language,
              ),
              questions: ['Do you want to do anything else with this task?'],
              draft: null,
              taskActionContext: {
                action: voiceIntent.kind,
                task: resolution.task,
              },
            }
          }

          return {
            ok: true,
            outcome: 'task_action_confirmation',
            transcript: data.transcript,
            language: data.language,
            message: buildVoiceTaskActionConfirmationMessage(
              resolution.task,
              voiceIntent.kind,
              data.language,
            ),
            action: voiceIntent.kind,
            task: resolution.task,
          }
        }

        if (voiceIntent.kind === 'edit_task') {
          if (!dependencies.assistantSessionService) {
            if (!taskEditChanges) {
              return {
                ok: true,
                outcome: 'clarify',
                transcript: data.transcript,
                language: data.language,
                message: 'I need a little more detail before I can edit this task.',
                questions: ['What should I change?'],
                draft: null,
                taskActionContext: {
                  action: 'edit_task',
                  task: resolution.task,
                },
              }
            }

            return {
              ok: true,
              outcome: 'task_action_confirmation',
              transcript: data.transcript,
              language: data.language,
              message: buildVoiceTaskEditConfirmationMessage(
                resolution.task,
                taskEditChanges,
                data.language,
              ),
              action: 'edit_task',
              task: resolution.task,
              edits: taskEditChanges,
            }
          }

          const requestedFields = mapTaskEditRequestedFields(taskEditChanges)
          const session = await dependencies.assistantSessionService.resolveTaskEditSession({
            sessionId: data.taskEditSessionId ?? undefined,
            task: {
              taskId: resolution.task.id,
              title: resolution.task.title,
              notes: resolution.task.notes ?? null,
              dueDate: resolution.task.dueDate,
              dueTime: resolution.task.dueTime,
              priority: resolution.task.priority,
            },
            routeIntent: data.routeIntent,
            requestedFields,
            activeField: requestedFields[0] ?? null,
          })

          const submittedTurn = await dependencies.assistantSessionService.submitSessionTurn({
            sessionId: session.sessionId,
            message: data.transcript,
            source: data.followUpTaskAction ? 'text' : 'voice',
            transcriptLanguage: data.language,
          })

          const settledSession = await waitForAssistantSessionTurnSettlement({
            assistantSessionService: dependencies.assistantSessionService,
            sessionId: session.sessionId,
            submittedTurnId:
              submittedTurn && typeof submittedTurn === 'object' && submittedTurn && 'turnId' in submittedTurn && typeof submittedTurn.turnId === 'string'
                ? submittedTurn.turnId
                : null,
          })
          const workflow = settledSession.workflow

          if (!workflow || workflow.kind !== 'task_edit') {
            throw new Error('Task edit session workflow missing')
          }

          if (workflow.phase === 'ready_to_confirm') {
            return {
              ok: true,
              outcome: 'task_action_confirmation',
              transcript: data.transcript,
              language: data.language,
              message:
                getLatestAssistantSessionSummary(settledSession, 'assistant_question')
                ?? buildVoiceTaskEditConfirmationMessage(resolution.task, workflow.changes, data.language),
              action: 'edit_task',
              task: resolution.task,
              edits: workflow.changes,
              taskEditSession: {
                sessionId: settledSession.sessionId,
              },
            }
          }

          if (workflow.phase === 'collecting') {
            const assistantQuestion = getLatestAssistantSessionSummary(settledSession, 'assistant_question')

            return {
              ok: true,
              outcome: 'clarify',
              transcript: data.transcript,
              language: data.language,
              message: assistantQuestion ?? 'What should I change?',
              questions: [],
              draft: null,
              taskActionContext: {
                action: 'edit_task',
                task: resolution.task,
              },
              taskEditSession: {
                sessionId: settledSession.sessionId,
              },
            }
          }

          if (workflow.phase === 'completed' && workflow.result?.applyPayload) {
            return {
              ok: true,
              outcome: 'task_action_confirmation',
              transcript: data.transcript,
              language: data.language,
              message: getLatestAssistantSessionSummary(settledSession, 'assistant_synthesis')
                ?? buildVoiceTaskEditConfirmationMessage(resolution.task, workflow.result.applyPayload.edits, data.language),
              action: 'edit_task',
              task: resolution.task,
              edits: workflow.result.applyPayload.edits,
              taskEditSession: {
                sessionId: settledSession.sessionId,
              },
            }
          }

          return {
            ok: true,
            outcome: 'clarify',
            transcript: data.transcript,
            language: data.language,
            message: getLatestAssistantSessionSummary(settledSession, 'assistant_synthesis')
              ?? 'I did not apply any task changes.',
            questions: ['Do you want to try a different task edit?'],
            draft: null,
            taskActionContext: {
              action: 'edit_task',
              task: resolution.task,
            },
            taskEditSession: {
              sessionId: settledSession.sessionId,
            },
          }
        }

        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: `I understood that as a task action for "${resolution.task.title}", but voice task actions are not available yet.`,
          questions: ['Do you want to use this task as the target once voice task actions are enabled?'],
          draft: null,
          taskActionContext: {
            action: 'edit_task',
            task: resolution.task,
          },
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
          transcript: data.transcript,
          language: data.language,
          message,
          questions: resolution.candidates.slice(0, 3).map((candidate) => `Did you mean "${candidate.title}"?`),
          draft: null,
        }
      }

      if (voiceIntent.kind !== 'unsupported_task_action') {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
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
        transcript: data.transcript,
        language: data.language,
        message: clarification.message,
        questions: clarification.questions,
        draft: null,
      }
    }

    const languageHint = data.language === 'unknown' ? undefined : data.language
    const interpretation = await dependencies.captureService.interpretTypedTaskInput({
      rawInput: data.transcript,
      currentDate: data.currentDate,
      timezone: data.timezone,
      languageHint,
    })

    if (!interpretation.ok) {
      return interpretation
    }

    const confidence = evaluateVoiceCaptureConfidence(
      interpretation.draft,
      data.transcript,
    )

    if (data.routeIntent === 'ideas') {
      return {
        ok: true,
        outcome: 'idea_confirmation',
        transcript: data.transcript,
        language: data.language,
        draft: {
          ...interpretation.draft,
          candidateType: 'idea',
        },
      }
    }

    if (confidence === 'high') {
      const draftTitle = interpretation.draft.title ?? data.transcript

      if (interpretation.draft.candidateType === 'idea') {
        return {
          ok: true,
          outcome: 'idea_confirmation',
          transcript: data.transcript,
          language: data.language,
          draft: interpretation.draft,
        }
      }

      if (interpretation.draft.candidateType === 'habit') {
        const created = await dependencies.captureService.confirmCapturedHabit({
          rawInput: data.transcript,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
          habit: draftToHabitCreateInput(interpretation.draft),
        })

        return {
          ok: true,
          outcome: 'auto_saved',
          candidateType: 'habit',
          createdId: created.id,
          title: draftTitle,
          transcript: data.transcript,
          language: data.language,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
        }
      }

      const created = await dependencies.captureService.confirmCapturedTask({
        rawInput: data.transcript,
        matchedCalendarContext: interpretation.draft.matchedCalendarContext,
        task: draftToTaskCreateInput(interpretation.draft),
      })

      return {
        ok: true,
        outcome: 'auto_saved',
        candidateType: 'task',
        createdId: created.id,
        title: draftTitle,
        transcript: data.transcript,
        language: data.language,
        matchedCalendarContext: interpretation.draft.matchedCalendarContext,
      }
    }

    if (confidence === 'clarify') {
      return {
        ok: true,
        outcome: 'clarify',
        transcript: data.transcript,
        language: data.language,
        message: buildVoiceClarificationMessage(
          interpretation.draft,
          data.transcript,
        ),
        questions: buildVoiceClarificationQuestions(
          interpretation.draft,
          data.transcript,
        ),
        draft: interpretation.draft,
      }
    }

    return {
      ok: true,
      outcome: 'review',
      transcript: data.transcript,
      language: data.language,
      draft: interpretation.draft,
    }
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

      return processTranscript({
        transcript: transcription.transcript,
        language: transcription.language,
        currentDate: data.currentDate,
        timezone: data.timezone,
        routeIntent: data.routeIntent,
        contextTaskId: data.contextTaskId,
        contextIdeaId: data.contextIdeaId,
        visibleTaskWindow: data.visibleTaskWindow,
        followUpTaskAction: data.followUpTaskAction,
        taskEditSessionId: data.taskEditSessionId,
      })
    },
    async processVoiceTranscript(data: ProcessVoiceCaptureTextInput): Promise<ProcessVoiceCaptureResponse> {
      return processTranscript(data)
    },
  }
}
