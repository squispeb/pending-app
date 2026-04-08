import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import {
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  interpretCaptureInputSchema,
} from '../lib/capture'
import { createCaptureService } from './capture-service'

const captureService = createCaptureService(db)

export const interpretCaptureInput = createServerFn({ method: 'POST' })
  .inputValidator((input) => interpretCaptureInputSchema.parse(input))
  .handler(async ({ data }) => {
    return captureService.interpretTypedTaskInput(data)
  })

export const confirmCapturedTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmCapturedTaskInputSchema.parse(input))
  .handler(async ({ data }) => {
    return captureService.confirmCapturedTask(data)
  })

export const confirmCapturedHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => confirmCapturedHabitInputSchema.parse(input))
  .handler(async ({ data }) => {
    return captureService.confirmCapturedHabit(data)
  })
