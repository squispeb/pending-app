import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import {
  confirmVoiceCalendarEventCreateInputSchema,
  confirmCapturedIdeaInputSchema,
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  confirmVoiceTaskActionInputSchema,
  interpretCaptureInputSchema,
  processVoiceCaptureTextInputSchema,
  parseProcessVoiceCaptureFormData,
} from '../lib/capture'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createCaptureService } from './capture-service'
import { createAssistantSessionService } from './assistant-session-service'
import { createAssistantThreadService } from './assistant-thread-service'
import { createIdeaAndBootstrapThread } from './ideas'
import { markServerFnRawResponse } from './ideas'
import { createIdeasService } from './ideas-service'
import { createTranscriptionBroker } from './transcription'
import { createVoiceTaskResolver } from './voice-task-resolver'

const captureService = createCaptureService(db)
const assistantSessionService = createAssistantSessionService(db)
const assistantThreadService = createAssistantThreadService(db)
const ideasService = createIdeasService(db)
const transcriptionBroker = createTranscriptionBroker()
const voiceTaskResolver = createVoiceTaskResolver(db)

function addDaysToIsoDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export const interpretCaptureInput = createServerFn({ method: 'POST' })
  .inputValidator((input) => interpretCaptureInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return captureService.interpretTypedTaskInput(user.id, data)
  })

export const processVoiceCapture = createServerFn({ method: 'POST' })
  .inputValidator((input) => parseProcessVoiceCaptureFormData(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const { createVoiceCaptureProcessor } = await import('./voice-capture-processor')
    const voiceCaptureProcessor = createVoiceCaptureProcessor({
      transcriptionBroker,
      captureService: {
        interpretTypedTaskInput: (input) => captureService.interpretTypedTaskInput(user.id, input),
        confirmCapturedTask: (input) => captureService.confirmCapturedTask(user.id, input),
        confirmCapturedHabit: (input) => captureService.confirmCapturedHabit(user.id, input),
      },
      assistantSessionService: {
        resolveCalendarEventCreateSession: (input) => assistantSessionService.resolveCalendarEventCreateSession(input),
        resolveTaskEditSession: (input) => assistantSessionService.resolveTaskEditSession(input),
        getSession: (sessionId) => assistantSessionService.getSession(sessionId),
        submitSessionTurn: (input) => assistantSessionService.submitSessionTurn(input),
      },
      taskResolver: {
        resolveTaskTarget: (input) => voiceTaskResolver.resolveTaskTarget({
          userId: user.id,
          transcript: input.transcript,
          currentDate: data.currentDate,
          timezone: data.timezone,
          contextTaskId: input.contextTaskId,
          contextIdeaId: input.contextIdeaId,
          visibleTaskWindow: input.visibleTaskWindow,
        }),
      },
    })
    return voiceCaptureProcessor.processVoiceCapture(data)
  })

export const processVoiceCaptureTranscript = createServerFn({ method: 'POST' })
  .inputValidator((input) => processVoiceCaptureTextInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    const { createVoiceCaptureProcessor } = await import('./voice-capture-processor')
    const voiceCaptureProcessor = createVoiceCaptureProcessor({
      transcriptionBroker,
      captureService: {
        interpretTypedTaskInput: (input) => captureService.interpretTypedTaskInput(user.id, input),
        confirmCapturedTask: (input) => captureService.confirmCapturedTask(user.id, input),
        confirmCapturedHabit: (input) => captureService.confirmCapturedHabit(user.id, input),
      },
      assistantSessionService: {
        resolveCalendarEventCreateSession: (input) => assistantSessionService.resolveCalendarEventCreateSession(input),
        resolveTaskEditSession: (input) => assistantSessionService.resolveTaskEditSession(input),
        getSession: (sessionId) => assistantSessionService.getSession(sessionId),
        submitSessionTurn: (input) => assistantSessionService.submitSessionTurn(input),
      },
      taskResolver: {
        resolveTaskTarget: (input) => voiceTaskResolver.resolveTaskTarget({
          userId: user.id,
          transcript: input.transcript,
          currentDate: data.currentDate,
          timezone: data.timezone,
          contextTaskId: input.contextTaskId,
          contextIdeaId: input.contextIdeaId,
          visibleTaskWindow: input.visibleTaskWindow,
        }),
      },
    })

    return voiceCaptureProcessor.processVoiceTranscript(data)
  })

export const submitAssistantSessionTurn = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    sessionId: string
    message: string
    source: 'text' | 'voice'
    transcriptLanguage?: 'es' | 'en' | 'unknown' | null
  }) => input)
  .handler(async ({ data }) => {
    return assistantSessionService.submitSessionTurn(data)
  })

export const confirmVoiceCalendarEventCreate = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmVoiceCalendarEventCreateInputSchema.parse(input))
  .handler(async ({ data }) => {
    await resolveAuthenticatedPlannerUser(db)
    const calendarModule = await import('./calendar')
    const targetCalendarId = data.draft.targetCalendarId ?? 'primary'
    const isAllDay = data.draft.allDay || !data.draft.startTime
    const allDayEndDate = addDaysToIsoDate(data.draft.endDate ?? data.draft.startDate, 1)

    return calendarModule.createGoogleCalendarEvent({
      data: {
        calendarId: targetCalendarId,
        event: {
          summary: data.draft.title,
          description: data.draft.description ?? null,
          location: data.draft.location ?? null,
          start: isAllDay
            ? { date: data.draft.startDate }
            : { dateTime: `${data.draft.startDate}T${data.draft.startTime}:00`, timeZone: data.timezone },
          end: isAllDay
            ? { date: allDayEndDate }
            : {
                dateTime: `${data.draft.endDate ?? data.draft.startDate}T${data.draft.endTime ?? data.draft.startTime}:00`,
                timeZone: data.timezone,
              },
        },
      },
    })
  })

export const confirmCapturedTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmCapturedTaskInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return captureService.confirmCapturedTask(user.id, data)
  })

export const confirmCapturedHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmCapturedHabitInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return captureService.confirmCapturedHabit(user.id, data)
  })

export const confirmCapturedIdea = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmCapturedIdeaInputSchema.parse(input))
  .handler(async ({ data }) => {
    return createIdeaAndBootstrapThread(data, {
      resolveUser: async () => resolveAuthenticatedPlannerUser(db),
      createIdea: (userId, input) => captureService.confirmCapturedIdea(userId, input),
      bootstrapIdeaThread: (ideaId, options) =>
        assistantThreadService.bootstrapIdeaThread(ideaId, {
          requestHeaders: options.requestHeaders,
        }),
      seedInitialElaboration: async (ideaId, options) => {
        const { user } = await resolveAuthenticatedPlannerUser(db, {
          requestHeaders: options.requestHeaders,
        })
        const executionSummary = await ideasService.getExecutionSummary(ideaId, user.id)

        await assistantThreadService.requestIdeaThreadElaboration(ideaId, {
          ...options.input,
          executionSummary: executionSummary ?? undefined,
        }, {
          requestHeaders: options.requestHeaders,
        })
      },
    })
  })

export const confirmVoiceTaskAction = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmVoiceTaskActionInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return captureService.confirmVoiceTaskAction(user.id, data)
  })

export const streamAssistantSession = createServerFn({ method: 'GET' })
  .inputValidator((input: { sessionId: string; lastEventId?: string | null }) => input)
  .handler(async ({ data }) => {
    const response = await assistantSessionService.streamSession(data.sessionId, {
      lastEventId: data.lastEventId ?? null,
    })

    return markServerFnRawResponse(response)
  })
