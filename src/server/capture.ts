import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import {
  confirmCapturedIdeaInputSchema,
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  confirmVoiceTaskActionInputSchema,
  interpretCaptureInputSchema,
  parseProcessVoiceCaptureFormData,
} from '../lib/capture'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createCaptureService } from './capture-service'
import { createAssistantThreadService } from './assistant-thread-service'
import { createIdeaAndBootstrapThread } from './ideas'
import { createIdeasService } from './ideas-service'
import { createTranscriptionBroker } from './transcription'
import { createVoiceTaskResolver } from './voice-task-resolver'

const captureService = createCaptureService(db)
const assistantThreadService = createAssistantThreadService(db)
const ideasService = createIdeasService(db)
const transcriptionBroker = createTranscriptionBroker()
const voiceTaskResolver = createVoiceTaskResolver(db)

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
