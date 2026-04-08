import { z } from 'zod'
import { taskCreateSchema, taskPrioritySchema } from './tasks'

const captureDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const captureTimeSchema = z.string().regex(/^\d{2}:\d{2}$/)

export const captureLanguageHintSchema = z.enum(['es', 'en', 'mixed'])

export const interpretCaptureInputSchema = z.object({
  rawInput: z.string().max(4000),
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  languageHint: captureLanguageHintSchema.optional(),
})

export const typedTaskDraftSchema = z
  .object({
    rawInput: z.string().min(1),
    normalizedInput: z.string().min(1),
    title: z.string().trim().min(1).max(120).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    dueDate: captureDateSchema.nullable(),
    dueTime: captureTimeSchema.nullable(),
    priority: taskPrioritySchema.nullable(),
    estimatedMinutes: z.number().int().positive().max(1440).nullable(),
    preferredStartTime: captureTimeSchema.nullable(),
    preferredEndTime: captureTimeSchema.nullable(),
    interpretationNotes: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((value, ctx) => {
    if (
      (value.preferredStartTime && !value.preferredEndTime) ||
      (!value.preferredStartTime && value.preferredEndTime)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredStartTime'],
        message: 'Preferred start and end time must be set together',
      })
    }

    if (
      value.preferredStartTime &&
      value.preferredEndTime &&
      value.preferredEndTime <= value.preferredStartTime
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredEndTime'],
        message: 'Preferred end time must be later than the start time',
      })
    }
  })

export const typedTaskDraftProviderOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    dueDate: captureDateSchema.nullable().optional(),
    dueTime: captureTimeSchema.nullable().optional(),
    priority: taskPrioritySchema.nullable().optional(),
    estimatedMinutes: z.number().int().positive().max(1440).nullable().optional(),
    preferredStartTime: captureTimeSchema.nullable().optional(),
    preferredEndTime: captureTimeSchema.nullable().optional(),
    interpretationNotes: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.preferredStartTime && !value.preferredEndTime) ||
      (!value.preferredStartTime && value.preferredEndTime)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredStartTime'],
        message: 'Preferred start and end time must be set together',
      })
    }

    if (
      value.preferredStartTime &&
      value.preferredEndTime &&
      value.preferredEndTime <= value.preferredStartTime
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredEndTime'],
        message: 'Preferred end time must be later than the start time',
      })
    }
  })

export const interpretCaptureSuccessSchema = z.object({
  ok: z.literal(true),
  draft: typedTaskDraftSchema,
})

export const interpretCaptureFailureCodeSchema = z.enum([
  'EMPTY_INPUT',
  'INTERPRETATION_FAILED',
  'INVALID_PROVIDER_OUTPUT',
])

export const interpretCaptureFailureSchema = z.object({
  ok: z.literal(false),
  code: interpretCaptureFailureCodeSchema,
  message: z.string().min(1),
  rawInput: z.string(),
})

export const confirmCapturedTaskInputSchema = z.object({
  rawInput: z.string().trim().min(1).max(4000),
  task: taskCreateSchema,
})

export type CaptureLanguageHint = z.infer<typeof captureLanguageHintSchema>
export type InterpretCaptureInput = z.infer<typeof interpretCaptureInputSchema>
export type TypedTaskDraft = z.infer<typeof typedTaskDraftSchema>
export type TypedTaskDraftProviderOutput = z.infer<typeof typedTaskDraftProviderOutputSchema>
export type InterpretCaptureSuccess = z.infer<typeof interpretCaptureSuccessSchema>
export type InterpretCaptureFailure = z.infer<typeof interpretCaptureFailureSchema>
export type ConfirmCapturedTaskInput = z.infer<typeof confirmCapturedTaskInputSchema>

function formatDateString(date: Date) {
  return [
    date.getUTCFullYear(),
    `${date.getUTCMonth() + 1}`.padStart(2, '0'),
    `${date.getUTCDate()}`.padStart(2, '0'),
  ].join('-')
}

function parseCurrentDateString(currentDate: string) {
  const parsed = new Date(`${currentDate}T12:00:00.000Z`)

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid current date: ${currentDate}`)
  }

  return parsed
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function getNextUtcWeekday(date: Date, targetDay: number) {
  const currentDay = date.getUTCDay()
  let delta = (targetDay - currentDay + 7) % 7

  if (delta === 0) {
    delta = 7
  }

  return addUtcDays(date, delta)
}

function cleanLeadingVerbPrefix(value: string) {
  return value
    .replace(/^(tengo que|debo|hay que|necesito|i need to|need to|have to|must)\s+/i, '')
    .trim()
}

export function normalizeCaptureInput(rawInput: string) {
  return rawInput.replace(/\s+/g, ' ').trim()
}

export function inferPriorityFromInput(normalizedInput: string) {
  if (/\b(lo antes posible|urgente|cuanto antes|as soon as possible|urgent|asap)\b/i.test(normalizedInput)) {
    return 'high' as const
  }

  if (/\b(importante|important|soon)\b/i.test(normalizedInput)) {
    return 'medium' as const
  }

  return null
}

export function inferDueDateFromInput(normalizedInput: string, currentDate: string) {
  const baseDate = parseCurrentDateString(currentDate)

  if (/\b(mañana|tomorrow)\b/i.test(normalizedInput)) {
    return formatDateString(addUtcDays(baseDate, 1))
  }

  if (/\b(domingo que viene|next sunday)\b/i.test(normalizedInput)) {
    return formatDateString(getNextUtcWeekday(baseDate, 0))
  }

  if (/\b(este viernes|this friday)\b/i.test(normalizedInput)) {
    const currentDay = baseDate.getUTCDay()
    const targetDay = 5
    const delta = currentDay <= targetDay ? targetDay - currentDay : targetDay - currentDay + 7
    return formatDateString(addUtcDays(baseDate, delta))
  }

  return null
}

export function inferTitleFromInput(normalizedInput: string) {
  const firstClause = normalizedInput.split(/[,.!?;]/, 1)[0]?.trim() ?? ''
  const cleaned = cleanLeadingVerbPrefix(firstClause)

  if (!cleaned) {
    return null
  }

  const normalizedTitle = cleaned.slice(0, 120).trim()

  return normalizedTitle || null
}

export function buildHeuristicTaskDraft(input: Pick<InterpretCaptureInput, 'rawInput' | 'currentDate'>) {
  const normalizedInput = normalizeCaptureInput(input.rawInput)
  const interpretationNotes: Array<string> = []
  const priority = inferPriorityFromInput(normalizedInput)
  const dueDate = inferDueDateFromInput(normalizedInput, input.currentDate)
  const title = inferTitleFromInput(normalizedInput)
  const notes = title && normalizedInput !== title ? normalizedInput : null

  if (/\b(domingo que viene)\b/i.test(normalizedInput) && dueDate) {
    interpretationNotes.push("Interpreted 'domingo que viene' as the next upcoming Sunday.")
  }

  if (priority === 'high' && /\b(lo antes posible)\b/i.test(normalizedInput)) {
    interpretationNotes.push("Mapped urgency phrase 'lo antes posible' to high priority.")
  }

  if (!title) {
    interpretationNotes.push('Could not infer a short task title.')
  }

  return {
    rawInput: input.rawInput,
    normalizedInput,
    title,
    notes,
    dueDate,
    dueTime: null,
    priority,
    estimatedMinutes: null,
    preferredStartTime: null,
    preferredEndTime: null,
    interpretationNotes,
  } satisfies TypedTaskDraft
}

export function mergeTypedTaskDrafts(
  heuristicDraft: TypedTaskDraft,
  providerDraft: TypedTaskDraftProviderOutput | null,
) {
  const merged: TypedTaskDraft = {
    rawInput: heuristicDraft.rawInput,
    normalizedInput: heuristicDraft.normalizedInput,
    title: providerDraft?.title ?? heuristicDraft.title,
    notes: providerDraft?.notes ?? heuristicDraft.notes,
    dueDate: providerDraft?.dueDate ?? heuristicDraft.dueDate,
    dueTime: providerDraft?.dueTime ?? heuristicDraft.dueTime,
    priority: providerDraft?.priority ?? heuristicDraft.priority,
    estimatedMinutes: providerDraft?.estimatedMinutes ?? heuristicDraft.estimatedMinutes,
    preferredStartTime: providerDraft?.preferredStartTime ?? heuristicDraft.preferredStartTime,
    preferredEndTime: providerDraft?.preferredEndTime ?? heuristicDraft.preferredEndTime,
    interpretationNotes: [
      ...heuristicDraft.interpretationNotes,
      ...(providerDraft?.interpretationNotes ?? []),
    ],
  }

  return typedTaskDraftSchema.parse(merged)
}
