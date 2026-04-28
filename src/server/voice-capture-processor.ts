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
  type ProcessVoiceCalendarEventTarget,
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
  resolveCalendarEventCreateSession: (input: {
    sessionId?: string
    currentDate: string
    timezone: string
    draft: {
      title?: string | null
      description?: string | null
      startDate?: string | null
      startTime?: string | null
      endDate?: string | null
      endTime?: string | null
      location?: string | null
      allDay?: boolean | null
      targetCalendarId?: string | null
      targetCalendarName?: string | null
    }
    writableCalendars?: Array<{
      calendarId: string
      calendarName: string
      primaryFlag: boolean
    }>
    routeIntent?: ProcessVoiceCaptureTextInput['routeIntent']
    requestedFields?: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location'>
    activeField?: 'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | null
  }) => Promise<{ sessionId: string }>
  resolveCalendarEventEditSession: (input: {
    sessionId?: string
    currentDate: string
    timezone: string
    target: { eventId: string; summary: string; calendarName?: string | null }
    draft: {
      title?: string | null
      description?: string | null
      startDate?: string | null
      startTime?: string | null
      endDate?: string | null
      endTime?: string | null
      location?: string | null
      allDay?: boolean | null
      targetCalendarId?: string | null
      targetCalendarName?: string | null
    }
  }) => Promise<{ sessionId: string }>
  resolveCalendarEventCancelSession: (input: {
    sessionId?: string
    currentDate: string
    timezone: string
    target: { eventId: string; summary: string; calendarName?: string | null }
  }) => Promise<{ sessionId: string }>
  resolveTaskEditSession: (input: {
    sessionId?: string
    currentDate: string
    timezone: string
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
    workflow:
      | {
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
        }
      | {
          kind: 'calendar_event'
          operation: 'create' | 'edit' | 'cancel'
          phase: 'collecting' | 'ready_to_confirm' | 'completed' | 'blocked'
          target?: {
            eventId: string
            summary: string
            calendarName?: string | null
          }
          draft: {
            title?: string | null
            description?: string | null
            startDate?: string | null
            startTime?: string | null
            endDate?: string | null
            endTime?: string | null
            location?: string | null
            allDay?: boolean | null
            targetCalendarId?: string | null
            targetCalendarName?: string | null
          }
          changes: {
            title?: string
            description?: string
            startDate?: string
            startTime?: string
            endDate?: string
            endTime?: string
            location?: string
            allDay?: boolean
            targetCalendarId?: string | null
            targetCalendarName?: string | null
          }
          result: {
            outcome: 'confirmed' | 'cancelled'
            applyPayload: {
              action: 'create_calendar_event'
              operation: 'create'
              draft: {
                title?: string | null
                description?: string | null
                startDate?: string | null
                startTime?: string | null
                endDate?: string | null
                endTime?: string | null
                location?: string | null
                allDay?: boolean | null
                targetCalendarId?: string | null
                targetCalendarName?: string | null
              }
            } | null
          } | null
        }
      | null
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
    context?: {
      writableCalendars?: Array<{
        calendarId: string
        calendarName: string
        primaryFlag: boolean
      }>
      target?: {
        kind: 'calendar_event'
        id?: string
        label: string
      } | null
    }
      workflow?: {
        kind: 'calendar_event'
        operation: 'create' | 'edit' | 'cancel'
      draft?: {
        title?: string | null
        description?: string | null
        startDate?: string | null
        startTime?: string | null
        endDate?: string | null
        endTime?: string | null
        location?: string | null
        allDay?: boolean | null
        targetCalendarId?: string | null
        targetCalendarName?: string | null
      }
      changes?: {
        title?: string | null
        description?: string | null
        startDate?: string | null
        startTime?: string | null
        endDate?: string | null
        endTime?: string | null
        location?: string | null
        allDay?: boolean | null
        targetCalendarId?: string | null
        targetCalendarName?: string | null
      }
      target?: {
        eventId: string
        summary: string
        calendarName?: string | null
      }
    }
  }) => Promise<{
    turnId?: string
  } | unknown>
}

type VoiceCalendarResolver = {
  resolveCalendarTarget: (input: { transcript: string }) => Promise<
    | {
        kind: 'default_primary' | 'resolved_primary'
        writableCalendars: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
      }
    | {
        kind: 'resolved_alternate'
        target: {
          calendarId: string
          calendarName: string
          primaryFlag: boolean
          isSelected: boolean
        }
        writableCalendars: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
      }
    | {
        kind: 'ambiguous'
        attemptedName: string | null
        candidates: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
          isSelected: boolean
        }>
        writableCalendars: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
      }
    | {
        kind: 'unavailable'
        attemptedName: string
        writableCalendars: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
      }
    | {
        kind: 'read_only'
        attemptedName: string
        calendar: {
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }
        writableCalendars: Array<{
          calendarId: string
          calendarName: string
          primaryFlag: boolean
        }>
      }
  >
  resolveCalendarEventTarget?: (input: {
    transcript: string
    visibleCalendarEventWindow?: Array<{
      calendarEventId: string
      summary: string
      startsAt: string | null
      endsAt: string | null
      allDay: boolean
      calendarName: string
      primaryFlag: boolean
    }> | null
  }) => Promise<CalendarEventTargetResolution>
}

function buildCalendarTargetClarification(
  resolution:
    | Awaited<ReturnType<VoiceCalendarResolver['resolveCalendarTarget']>>,
) {
  if (resolution.kind === 'ambiguous') {
    return {
      message: 'I found more than one matching writable calendar, so I need to know which one you mean.',
      questions: resolution.candidates.slice(0, 3).map((candidate) => `Did you mean the ${candidate.calendarName} calendar?`),
    }
  }

  if (resolution.kind === 'read_only') {
    const writableNames = resolution.writableCalendars.slice(0, 3).map((calendar) => calendar.calendarName)
    return {
      message: `The ${resolution.calendar.calendarName} calendar is read-only, so I can't create events there.`,
      questions: writableNames.length > 0
        ? [`Which writable calendar should I use instead? Available options: ${writableNames.join(', ')}.`]
        : ['Which writable calendar should I use instead?'],
    }
  }

  const writableNames = resolution.writableCalendars.slice(0, 3).map((calendar) => calendar.calendarName)
  return {
    message: `I couldn't find a writable calendar named ${JSON.stringify(resolution.attemptedName)}.`,
    questions: writableNames.length > 0
      ? [`Which calendar should I use instead? Available writable calendars: ${writableNames.join(', ')}.`]
      : ['Which calendar should I use instead?'],
  }
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
  visibleCalendarEventWindow?: ProcessVoiceCaptureTextInput['visibleCalendarEventWindow']
  followUpTaskAction?: ConfirmVoiceTaskActionKind
  taskEditSessionId?: string | null
  calendarEventSessionId?: string | null
}

type CalendarEventTargetResolution =
  | {
      kind: 'resolved'
      target: ProcessVoiceCalendarEventTarget
    }
  | {
      kind: 'ambiguous'
      candidates: Array<ProcessVoiceCalendarEventTarget>
    }
  | {
      kind: 'unresolved'
    }

function mapCalendarCreateRequestedFields(transcript: string) {
  const normalized = transcript.toLowerCase()
  const fields: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location'> = []

  if (/\b(title|meeting|event|appointment|sync|call|reunion|reunión|evento|cita)\b/i.test(transcript)) {
    fields.push('title')
  }

  if (/\b(description|notes?|details|descripcion|descripción)\b/i.test(transcript)) {
    fields.push('description')
  }

  if (/\b(today|tomorrow|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hoy|mañana|manana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|\d{4}-\d{2}-\d{2})\b/i.test(transcript)) {
    fields.push('startDate')
  }

  if (/\b(at|am|pm|a las|\d{1,2}:\d{2})\b/i.test(normalized)) {
    fields.push('startTime')
  }

  if (/\b(location|where|room|place|ubicacion|ubicación|lugar)\b/i.test(transcript)) {
    fields.push('location')
  }

  return Array.from(new Set(fields))
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

function buildCalendarEventTargetClarification(
  intent: { kind: 'edit_calendar_event' | 'cancel_calendar_event' },
  resolution: Exclude<CalendarEventTargetResolution, { kind: 'resolved' }>,
) {
  if (resolution.kind === 'ambiguous') {
    return {
      message:
        intent.kind === 'cancel_calendar_event'
          ? 'I found more than one matching event, so I need to know which one you want to cancel.'
          : 'I found more than one matching event, so I need to know which one you want to edit.',
      questions: resolution.candidates.slice(0, 3).map((candidate) => {
        const when = candidate.startsAt ? ` at ${candidate.startsAt}` : ''
        return `Did you mean "${candidate.summary}" on ${candidate.calendarName}${when}?`
      }),
    }
  }

  return {
    message:
      intent.kind === 'cancel_calendar_event'
        ? 'I could not find a calendar event that matches that request.'
        : 'I could not find a calendar event that matches that request.',
    questions: ['Which calendar event do you mean?'],
  }
}

function toConfirmationCalendarEvent(
  target: ProcessVoiceCalendarEventTarget,
  changes?: Partial<{
    title: string | null
    description: string | null
    startDate: string | null
    startTime: string | null
    endDate: string | null
    endTime: string | null
    location: string | null
    allDay: boolean | null
    targetCalendarId: string | null
    targetCalendarName: string | null
  }>,
) {
  return {
    operation: 'edit_calendar_event' as const,
    target,
    ...(changes?.title !== undefined ? { title: changes.title } : {}),
    ...(changes?.description !== undefined ? { description: changes.description ?? undefined } : {}),
    ...(changes?.startDate !== undefined ? { startDate: changes.startDate ?? undefined } : {}),
    ...(changes?.startTime !== undefined ? { startTime: changes.startTime ?? undefined } : {}),
    ...(changes?.endDate !== undefined ? { endDate: changes.endDate ?? undefined } : {}),
    ...(changes?.endTime !== undefined ? { endTime: changes.endTime ?? undefined } : {}),
    ...(changes?.location !== undefined ? { location: changes.location ?? undefined } : {}),
    ...(changes?.allDay !== undefined ? { allDay: changes.allDay ?? undefined } : {}),
    ...(changes?.targetCalendarId !== undefined ? { targetCalendarId: changes.targetCalendarId ?? undefined } : {}),
    ...(changes?.targetCalendarName !== undefined ? { targetCalendarName: changes.targetCalendarName ?? undefined } : {}),
  }
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
    calendarResolver?: VoiceCalendarResolver
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
            currentDate: data.currentDate,
            timezone: data.timezone,
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

    if (voiceIntent.family === 'calendar_action' && voiceIntent.kind === 'create_calendar_event') {
      if (!dependencies.assistantSessionService) {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: 'I understood that as a calendar action, but voice calendar actions are not available yet.',
          questions: ['Do you want to capture this as a new task instead?'],
          draft: null,
        }
      }

      const calendarResolution = dependencies.calendarResolver
        ? await dependencies.calendarResolver.resolveCalendarTarget({ transcript: data.transcript })
        : { kind: 'default_primary' as const, writableCalendars: [] }

      if (
        calendarResolution.kind === 'ambiguous'
        || calendarResolution.kind === 'unavailable'
        || calendarResolution.kind === 'read_only'
      ) {
        const clarification = buildCalendarTargetClarification(calendarResolution)

        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: clarification.message,
          questions: clarification.questions,
          draft: null,
          calendarEvent: {
            targetCalendarId: null,
            targetCalendarName: calendarResolution.attemptedName,
          },
        }
      }

      const requestedFields = mapCalendarCreateRequestedFields(data.transcript)
      const targetDraft =
        calendarResolution.kind === 'resolved_alternate'
          ? {
              targetCalendarId: calendarResolution.target.calendarId,
              targetCalendarName: calendarResolution.target.calendarName,
            }
          : {
              targetCalendarId: null,
              targetCalendarName: null,
            }
      const session = await dependencies.assistantSessionService.resolveCalendarEventCreateSession({
        sessionId: data.calendarEventSessionId ?? undefined,
        currentDate: data.currentDate,
        timezone: data.timezone,
        draft: targetDraft,
        writableCalendars: calendarResolution.writableCalendars,
        routeIntent: data.routeIntent,
        requestedFields,
        activeField: requestedFields[0] ?? null,
      })

      const submittedTurn = await dependencies.assistantSessionService.submitSessionTurn({
        sessionId: session.sessionId,
        message: data.transcript,
        source: 'voice',
        transcriptLanguage: data.language,
        context: {
          writableCalendars: calendarResolution.writableCalendars,
          target: {
            kind: 'calendar_event',
            ...(targetDraft.targetCalendarId ? { id: targetDraft.targetCalendarId } : {}),
            label: targetDraft.targetCalendarName ?? targetDraft.title ?? 'Calendar event',
          },
        },
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

      if (!workflow || workflow.kind !== 'calendar_event' || workflow.operation !== 'create') {
        throw new Error('Calendar event session workflow missing')
      }

      const latestQuestion = getLatestAssistantSessionSummary(settledSession, 'assistant_question')
      const latestSynthesis = getLatestAssistantSessionSummary(settledSession, 'assistant_synthesis')
      const calendarEvent = {
        ...workflow.draft,
        ...workflow.changes,
        allDay:
          typeof workflow.changes.allDay === 'boolean'
            ? workflow.changes.allDay
            : typeof workflow.draft.allDay === 'boolean'
              ? workflow.draft.allDay
              : !workflow.changes.startTime && !workflow.draft.startTime,
      }

      if (workflow.phase === 'ready_to_confirm') {
        return {
          ok: true,
          outcome: 'calendar_event_confirmation',
          transcript: data.transcript,
          language: data.language,
          message: latestQuestion ?? 'Confirm this calendar event.',
          calendarEvent,
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      if (workflow.phase === 'collecting') {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: latestQuestion ?? 'What calendar event details should I use?',
          questions: [],
          draft: null,
          calendarEvent,
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      if (workflow.phase === 'completed' && workflow.result?.applyPayload) {
        return {
          ok: true,
          outcome: 'calendar_event_confirmation',
          transcript: data.transcript,
          language: data.language,
          message: latestSynthesis ?? latestQuestion ?? 'Confirm this calendar event.',
          calendarEvent,
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      return {
        ok: true,
        outcome: 'clarify',
        transcript: data.transcript,
        language: data.language,
        message: latestSynthesis ?? 'I did not apply any calendar changes.',
        questions: [latestQuestion ?? 'Do you want to try a different event request?'],
        draft: null,
        calendarEvent,
        calendarEventSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    if (
      voiceIntent.family === 'calendar_action' &&
      (voiceIntent.kind === 'edit_calendar_event' || voiceIntent.kind === 'cancel_calendar_event')
    ) {
      const calendarEventResolution = dependencies.calendarResolver?.resolveCalendarEventTarget
        ? await dependencies.calendarResolver.resolveCalendarEventTarget({
            transcript: data.transcript,
            visibleCalendarEventWindow: data.visibleCalendarEventWindow,
          })
        : { kind: 'unresolved' as const }

      if (calendarEventResolution.kind !== 'resolved') {
        const clarification = buildCalendarEventTargetClarification(voiceIntent, calendarEventResolution)

        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: clarification.message,
          questions: clarification.questions,
          draft: null,
          calendarEventTargetCandidates:
            calendarEventResolution.kind === 'ambiguous' ? calendarEventResolution.candidates : undefined,
        }
      }

      if (!dependencies.assistantSessionService) {
        return {
          ok: true,
          outcome: 'calendar_event_confirmation',
          transcript: data.transcript,
          language: data.language,
          message:
            voiceIntent.kind === 'cancel_calendar_event'
              ? `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to cancel it.`
              : `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to edit it.`,
          calendarEvent: {
            operation: voiceIntent.kind,
            target: calendarEventResolution.target,
          },
        }
      }

      const session = voiceIntent.kind === 'cancel_calendar_event'
        ? await dependencies.assistantSessionService.resolveCalendarEventCancelSession({
            sessionId: data.calendarEventSessionId ?? undefined,
            currentDate: data.currentDate,
            timezone: data.timezone,
            target: {
              eventId: calendarEventResolution.target.calendarEventId,
              summary: calendarEventResolution.target.summary,
              calendarName: calendarEventResolution.target.calendarName,
            },
          })
        : await dependencies.assistantSessionService.resolveCalendarEventEditSession({
            sessionId: data.calendarEventSessionId ?? undefined,
            currentDate: data.currentDate,
            timezone: data.timezone,
            target: {
              eventId: calendarEventResolution.target.calendarEventId,
              summary: calendarEventResolution.target.summary,
              calendarName: calendarEventResolution.target.calendarName,
            },
            draft: {},
          })

      const submittedTurn = await dependencies.assistantSessionService.submitSessionTurn({
        sessionId: session.sessionId,
        message: data.transcript,
        source: 'voice',
        transcriptLanguage: data.language,
        context: {
          target: {
            kind: 'calendar_event',
            id: calendarEventResolution.target.calendarEventId,
            label: calendarEventResolution.target.summary,
          },
        },
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
      if (!workflow || workflow.kind !== 'calendar_event' || workflow.operation !== voiceIntent.kind.split('_')[0]) {
        throw new Error('Calendar event session workflow missing')
      }

      const latestQuestion = getLatestAssistantSessionSummary(settledSession, 'assistant_question')
      const latestSynthesis = getLatestAssistantSessionSummary(settledSession, 'assistant_synthesis')

      if (workflow.phase === 'collecting') {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: data.transcript,
          language: data.language,
          message: latestQuestion ?? 'What calendar event details should I use?',
          questions: [],
          draft: null,
          calendarEvent: {
            operation: voiceIntent.kind,
            target: calendarEventResolution.target,
          },
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      if (workflow.phase === 'ready_to_confirm' || (workflow.phase === 'completed' && workflow.result?.applyPayload)) {
        return {
          ok: true,
          outcome: 'calendar_event_confirmation',
          transcript: data.transcript,
          language: data.language,
          message:
            latestQuestion
            ?? latestSynthesis
            ?? (voiceIntent.kind === 'cancel_calendar_event'
              ? `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to cancel it.`
              : `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to edit it.`),
          calendarEvent: {
            operation: voiceIntent.kind,
            target: calendarEventResolution.target,
          },
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      return {
        ok: true,
        outcome: 'calendar_event_confirmation',
        transcript: data.transcript,
        language: data.language,
        message:
          voiceIntent.kind === 'cancel_calendar_event'
            ? `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to cancel it.`
            : `I found "${calendarEventResolution.target.summary}" on ${calendarEventResolution.target.calendarName}. Confirm if you want me to edit it.`,
        calendarEvent: {
          operation: voiceIntent.kind,
          target: calendarEventResolution.target,
        },
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
        visibleCalendarEventWindow: data.visibleCalendarEventWindow,
        followUpTaskAction: data.followUpTaskAction,
        taskEditSessionId: data.taskEditSessionId,
        calendarEventSessionId: data.calendarEventSessionId,
      })
    },
    async processVoiceTranscript(data: ProcessVoiceCaptureTextInput): Promise<ProcessVoiceCaptureResponse> {
      return processTranscript(data)
    },
  }
}
