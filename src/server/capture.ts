import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import {
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  interpretCaptureInputSchema,
  parseProcessVoiceCaptureFormData,
} from '../lib/capture'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createCaptureService } from './capture-service'

const captureService = createCaptureService(db)

export const interpretCaptureInput = createServerFn({ method: 'POST' })
  .inputValidator((input) => interpretCaptureInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return captureService.interpretTypedTaskInput(user.id, data)
  })

export const processVoiceCapture = createServerFn({ method: 'POST' })
  .inputValidator((input) => parseProcessVoiceCaptureFormData(input))
  .handler(async ({ data }) => {
    const { createVoiceCaptureProcessor } = await import('./voice-capture-processor')
    const voiceCaptureProcessor = createVoiceCaptureProcessor()
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
