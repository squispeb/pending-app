import { z } from 'zod'
import { taskCreateSchema, taskPrioritySchema } from './tasks'
import { habitCadenceSchema, habitCreateSchema, habitWeekdaySchema, type HabitWeekday } from './habits'

const captureDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const captureTimeSchema = z.string().regex(/^\d{2}:\d{2}$/)

export const captureLanguageHintSchema = z.enum(['es', 'en', 'mixed'])

export const interpretCaptureInputSchema = z.object({
  rawInput: z.string().max(4000),
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  languageHint: captureLanguageHintSchema.optional(),
})

export const candidateTypeSchema = z.enum(['task', 'habit'])

export const typedTaskDraftSchema = z
  .object({
    rawInput: z.string().min(1),
    normalizedInput: z.string().min(1),
    candidateType: candidateTypeSchema.default('task'),
    title: z.string().trim().min(1).max(120).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    dueDate: captureDateSchema.nullable(),
    dueTime: captureTimeSchema.nullable(),
    priority: taskPrioritySchema.nullable(),
    estimatedMinutes: z.number().int().positive().max(1440).nullable(),
    cadenceType: habitCadenceSchema.nullable(),
    cadenceDays: z.array(habitWeekdaySchema).default([]),
    targetCount: z.number().int().positive().max(20).nullable(),
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
    candidateType: candidateTypeSchema.optional(),
    title: z.string().trim().min(1).max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    dueDate: captureDateSchema.nullable().optional(),
    dueTime: captureTimeSchema.nullable().optional(),
    priority: taskPrioritySchema.nullable().optional(),
    estimatedMinutes: z.number().int().positive().max(1440).nullable().optional(),
    cadenceType: habitCadenceSchema.nullable().optional(),
    cadenceDays: z.array(habitWeekdaySchema).optional(),
    targetCount: z.number().int().positive().max(20).nullable().optional(),
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

export const confirmCapturedHabitInputSchema = z.object({
  rawInput: z.string().trim().min(1).max(4000),
  habit: habitCreateSchema,
})

export type CaptureLanguageHint = z.infer<typeof captureLanguageHintSchema>
export type CandidateType = z.infer<typeof candidateTypeSchema>
export type InterpretCaptureInput = z.infer<typeof interpretCaptureInputSchema>
export type TypedTaskDraft = z.infer<typeof typedTaskDraftSchema>
export type TypedTaskDraftProviderOutput = z.infer<typeof typedTaskDraftProviderOutputSchema>
export type InterpretCaptureSuccess = z.infer<typeof interpretCaptureSuccessSchema>
export type InterpretCaptureFailure = z.infer<typeof interpretCaptureFailureSchema>
export type ConfirmCapturedTaskInput = z.infer<typeof confirmCapturedTaskInputSchema>
export type ConfirmCapturedHabitInput = z.infer<typeof confirmCapturedHabitInputSchema>

const WEEKDAY_MATCHERS: Array<{ day: HabitWeekday; pattern: RegExp }> = [
  { day: 'mon', pattern: /\b(monday|mondays|lunes)\b/i },
  { day: 'tue', pattern: /\b(tuesday|tuesdays|martes)\b/i },
  { day: 'wed', pattern: /\b(wednesday|wednesdays|miercoles|miércoles)\b/i },
  { day: 'thu', pattern: /\b(thursday|thursdays|jueves)\b/i },
  { day: 'fri', pattern: /\b(friday|fridays|viernes)\b/i },
  { day: 'sat', pattern: /\b(saturday|saturdays|sabado|sábado)\b/i },
  { day: 'sun', pattern: /\b(sunday|sundays|domingo|domingos)\b/i },
] as const

type LocalDateParts = {
  year: number
  month: number
  day: number
}

function formatDateString(parts: LocalDateParts) {
  return [
    parts.year,
    `${parts.month}`.padStart(2, '0'),
    `${parts.day}`.padStart(2, '0'),
  ].join('-')
}

function validateTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`)
  }
}

function parseCurrentDateString(currentDate: string, timezone: string) {
  validateTimeZone(timezone)
  const [year, month, day] = currentDate.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid current date: ${currentDate}`)
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  } satisfies LocalDateParts
}

function toUtcDate(parts: LocalDateParts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0))
}

function addUtcDays(parts: LocalDateParts, days: number) {
  const next = toUtcDate(parts)
  next.setUTCDate(next.getUTCDate() + days)

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  } satisfies LocalDateParts
}

function getUtcWeekday(parts: LocalDateParts) {
  return toUtcDate(parts).getUTCDay()
}

function getNextUtcWeekday(parts: LocalDateParts, targetDay: number) {
  const currentDay = getUtcWeekday(parts)
  let delta = (targetDay - currentDay + 7) % 7

  if (delta === 0) {
    delta = 7
  }

  return addUtcDays(parts, delta)
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

export function inferCadenceFromInput(normalizedInput: string) {
  if (/\b(cada dia|cada día|todos los dias|todos los días|daily|every day)\b/i.test(normalizedInput)) {
    return {
      candidateType: 'habit' as const,
      cadenceType: 'daily' as const,
      cadenceDays: [] as Array<HabitWeekday>,
      targetCount: 1,
    }
  }

  if (/\b(every weekday|weekdays|cada dia laboral|cada día laboral|de lunes a viernes)\b/i.test(normalizedInput)) {
    return {
      candidateType: 'habit' as const,
      cadenceType: 'selected_days' as const,
      cadenceDays: ['mon', 'tue', 'wed', 'thu', 'fri'] satisfies Array<HabitWeekday>,
      targetCount: 1,
    }
  }

  const matchedDays = WEEKDAY_MATCHERS.filter(({ pattern }) => pattern.test(normalizedInput)).map(
    ({ day }) => day,
  )

  const hasRecurringCue = /\b(cada|todos los|todas las|every|each|on)\b/i.test(normalizedInput)

  if (hasRecurringCue && matchedDays.length > 0) {
    return {
      candidateType: 'habit' as const,
      cadenceType: 'selected_days' as const,
      cadenceDays: Array.from(new Set(matchedDays)),
      targetCount: 1,
    }
  }

  return {
    candidateType: 'task' as const,
    cadenceType: null,
    cadenceDays: [] as Array<HabitWeekday>,
    targetCount: null,
  }
}

export function inferDueDateFromInput(normalizedInput: string, currentDate: string, timezone: string) {
  const baseDate = parseCurrentDateString(currentDate, timezone)

  if (/\b(mañana|tomorrow)\b/i.test(normalizedInput)) {
    return formatDateString(addUtcDays(baseDate, 1))
  }

  if (/\b(domingo que viene|next sunday)\b/i.test(normalizedInput)) {
    return formatDateString(getNextUtcWeekday(baseDate, 0))
  }

  if (/\b(este viernes|this friday)\b/i.test(normalizedInput)) {
    const currentDay = getUtcWeekday(baseDate)
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

export function buildHeuristicTaskDraft(
  input: Pick<InterpretCaptureInput, 'rawInput' | 'currentDate' | 'timezone'>,
) {
  const normalizedInput = normalizeCaptureInput(input.rawInput)
  const interpretationNotes: Array<string> = []
  const priority = inferPriorityFromInput(normalizedInput)
  const dueDate = inferDueDateFromInput(normalizedInput, input.currentDate, input.timezone)
  const title = inferTitleFromInput(normalizedInput)
  const notes = title && normalizedInput !== title ? normalizedInput : null
  const cadence = inferCadenceFromInput(normalizedInput)

  if (/\b(domingo que viene)\b/i.test(normalizedInput) && dueDate) {
    interpretationNotes.push("Interpreted 'domingo que viene' as the next upcoming Sunday.")
  }

  if (priority === 'high' && /\b(lo antes posible)\b/i.test(normalizedInput)) {
    interpretationNotes.push("Mapped urgency phrase 'lo antes posible' to high priority.")
  }

  if (!title) {
    interpretationNotes.push('Could not infer a short task title.')
  }

  if (cadence.candidateType === 'habit') {
    interpretationNotes.push('Detected recurring routine; drafted as a habit candidate.')
  }

  return {
    rawInput: input.rawInput,
    normalizedInput,
    candidateType: cadence.candidateType,
    title,
    notes,
    dueDate,
    dueTime: null,
    priority,
    estimatedMinutes: null,
    cadenceType: cadence.cadenceType,
    cadenceDays: cadence.cadenceDays,
    targetCount: cadence.targetCount,
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
    candidateType: providerDraft?.candidateType ?? heuristicDraft.candidateType,
    title: providerDraft?.title ?? heuristicDraft.title,
    notes: providerDraft?.notes ?? heuristicDraft.notes,
    dueDate: providerDraft?.dueDate ?? heuristicDraft.dueDate,
    dueTime: providerDraft?.dueTime ?? heuristicDraft.dueTime,
    priority: providerDraft?.priority ?? heuristicDraft.priority,
    estimatedMinutes: providerDraft?.estimatedMinutes ?? heuristicDraft.estimatedMinutes,
    cadenceType: providerDraft?.cadenceType ?? heuristicDraft.cadenceType,
    cadenceDays: providerDraft?.cadenceDays ?? heuristicDraft.cadenceDays,
    targetCount: providerDraft?.targetCount ?? heuristicDraft.targetCount,
    preferredStartTime: providerDraft?.preferredStartTime ?? heuristicDraft.preferredStartTime,
    preferredEndTime: providerDraft?.preferredEndTime ?? heuristicDraft.preferredEndTime,
    interpretationNotes: [
      ...heuristicDraft.interpretationNotes,
      ...(providerDraft?.interpretationNotes ?? []),
    ],
  }

  return typedTaskDraftSchema.parse(merged)
}
