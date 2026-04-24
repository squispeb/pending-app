import { z } from 'zod'
import { taskCreateSchema, taskPrioritySchema } from './tasks'
import { habitCadenceSchema, habitCreateSchema, habitWeekdaySchema, type HabitWeekday } from './habits'
import { ideaSourceTypeSchema } from './ideas'
import {
  transcriptionDetectedLanguageSchema,
  transcribeAudioUploadInputSchema,
} from './transcription'

const captureDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const captureTimeSchema = z.string().regex(/^\d{2}:\d{2}$/)

export const captureLanguageHintSchema = z.enum(['es', 'en', 'mixed'])
export const captureRouteIntentSchema = z.enum(['tasks', 'habits', 'ideas', 'auto'])
export const voiceIntentFamilySchema = z.enum([
  'creation',
  'task_action',
  'calendar_action',
  'unsupported_action',
])
export const voiceTaskActionKindSchema = z.enum([
  'task_status',
  'complete_task',
  'reopen_task',
  'edit_task',
  'unsupported_task_action',
])
export const voiceCalendarActionKindSchema = z.enum([
  'create_calendar_event',
  'edit_calendar_event',
  'cancel_calendar_event',
  'unsupported_calendar_action',
])
export const voiceIntentClassificationSchema = z.discriminatedUnion('family', [
  z.object({
    family: z.literal('creation'),
    kind: z.literal('creation'),
  }),
  z.object({
    family: z.literal('task_action'),
    kind: voiceTaskActionKindSchema,
  }),
  z.object({
    family: z.literal('calendar_action'),
    kind: voiceCalendarActionKindSchema,
  }),
  z.object({
    family: z.literal('unsupported_action'),
    kind: z.literal('unsupported_action'),
  }),
])

export const interpretCaptureInputSchema = z.object({
  rawInput: z.string().max(4000),
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  languageHint: captureLanguageHintSchema.optional(),
  routeIntent: captureRouteIntentSchema.optional(),
})

export const candidateTypeSchema = z.enum(['task', 'habit', 'idea'])

export const matchedCalendarContextSchema = z.object({
  calendarEventId: z.string().min(1),
  summary: z.string().trim().min(1),
  reason: z.string().trim().min(1),
})

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
    matchedCalendarContext: matchedCalendarContextSchema.nullable().default(null),
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
    matchedCalendarContext: matchedCalendarContextSchema.nullable().optional(),
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
  matchedCalendarContext: matchedCalendarContextSchema.nullable().optional(),
  task: taskCreateSchema,
})

export const confirmCapturedHabitInputSchema = z.object({
  rawInput: z.string().trim().min(1).max(4000),
  matchedCalendarContext: matchedCalendarContextSchema.nullable().optional(),
  habit: habitCreateSchema,
})

export const confirmCapturedIdeaInputSchema = z.object({
  rawInput: z.string().trim().min(1).max(4000),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(10000).optional().or(z.literal('')).transform((value) => value || undefined),
  sourceType: ideaSourceTypeSchema.default('typed_capture'),
  sourceInput: z.string().trim().max(4000).optional().or(z.literal('')).transform((value) => value || undefined),
})

export const processVoiceCaptureInputSchema = transcribeAudioUploadInputSchema.extend({
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  routeIntent: captureRouteIntentSchema.optional(),
})

export const processVoiceCaptureAutoSavedSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('auto_saved'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  candidateType: candidateTypeSchema,
  createdId: z.string().min(1),
  title: z.string().trim().min(1),
  matchedCalendarContext: matchedCalendarContextSchema.nullable(),
})

export const processVoiceCaptureIdeaConfirmationSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('idea_confirmation'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  draft: typedTaskDraftSchema,
})

export const processVoiceCaptureReviewSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('review'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  draft: typedTaskDraftSchema,
})

export const processVoiceCaptureClarifySchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('clarify'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  message: z.string().trim().min(1),
  questions: z.array(z.string().trim().min(1)).min(1),
  draft: typedTaskDraftSchema.nullable(),
})

export const processVoiceCaptureFailureSchema = z.object({
  ok: z.literal(false),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
})

export const processVoiceCaptureResponseSchema = z.union([
  processVoiceCaptureAutoSavedSchema,
  processVoiceCaptureIdeaConfirmationSchema,
  processVoiceCaptureReviewSchema,
  processVoiceCaptureClarifySchema,
  processVoiceCaptureFailureSchema,
])

export type CaptureLanguageHint = z.infer<typeof captureLanguageHintSchema>
export type CaptureRouteIntent = z.infer<typeof captureRouteIntentSchema>
export type VoiceIntentFamily = z.infer<typeof voiceIntentFamilySchema>
export type VoiceTaskActionKind = z.infer<typeof voiceTaskActionKindSchema>
export type VoiceCalendarActionKind = z.infer<typeof voiceCalendarActionKindSchema>
export type VoiceIntentClassification = z.infer<typeof voiceIntentClassificationSchema>
export type CandidateType = z.infer<typeof candidateTypeSchema>
export type InterpretCaptureInput = z.infer<typeof interpretCaptureInputSchema>
export type TypedTaskDraft = z.infer<typeof typedTaskDraftSchema>
export type TypedTaskDraftProviderOutput = z.infer<typeof typedTaskDraftProviderOutputSchema>
export type InterpretCaptureSuccess = z.infer<typeof interpretCaptureSuccessSchema>
export type InterpretCaptureFailure = z.infer<typeof interpretCaptureFailureSchema>
export type ConfirmCapturedTaskInput = z.infer<typeof confirmCapturedTaskInputSchema>
export type ConfirmCapturedHabitInput = z.infer<typeof confirmCapturedHabitInputSchema>
export type ConfirmCapturedIdeaInput = z.infer<typeof confirmCapturedIdeaInputSchema>
export type MatchedCalendarContext = z.infer<typeof matchedCalendarContextSchema>
export type ProcessVoiceCaptureInput = z.infer<typeof processVoiceCaptureInputSchema>
export type ProcessVoiceCaptureAutoSaved = z.infer<typeof processVoiceCaptureAutoSavedSchema>
export type ProcessVoiceCaptureIdeaConfirmation = z.infer<typeof processVoiceCaptureIdeaConfirmationSchema>
export type ProcessVoiceCaptureReview = z.infer<typeof processVoiceCaptureReviewSchema>
export type ProcessVoiceCaptureClarify = z.infer<typeof processVoiceCaptureClarifySchema>
export type ProcessVoiceCaptureFailure = z.infer<typeof processVoiceCaptureFailureSchema>
export type ProcessVoiceCaptureResponse = z.infer<typeof processVoiceCaptureResponseSchema>

export type VoiceCaptureConfidence = 'high' | 'review' | 'clarify'

function isTaskHabitAmbiguityNote(note: string) {
  return (
    /(task|habit|one[- ]off|recurring|repeat)/i.test(note) &&
    /(ambiguous|unclear|not clear|could not determine|cannot determine|can't tell|cannot tell)/i.test(
      note,
    )
  )
}

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

export function tokenizeForCaptureMatching(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3)
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
    matchedCalendarContext: null,
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
    matchedCalendarContext: providerDraft?.matchedCalendarContext ?? heuristicDraft.matchedCalendarContext,
    preferredStartTime: providerDraft?.preferredStartTime ?? heuristicDraft.preferredStartTime,
    preferredEndTime: providerDraft?.preferredEndTime ?? heuristicDraft.preferredEndTime,
    interpretationNotes: [
      ...heuristicDraft.interpretationNotes,
      ...(providerDraft?.interpretationNotes ?? []),
    ],
  }

  return typedTaskDraftSchema.parse(merged)
}

export function draftToTaskCreateInput(draft: TypedTaskDraft) {
  return taskCreateSchema.parse({
    title: draft.title ?? '',
    notes: draft.notes ?? '',
    priority: draft.priority ?? 'medium',
    dueDate: draft.dueDate ?? '',
    dueTime: draft.dueTime ?? '',
    reminderAt: '',
    estimatedMinutes: draft.estimatedMinutes ?? undefined,
    preferredStartTime: draft.preferredStartTime ?? '',
    preferredEndTime: draft.preferredEndTime ?? '',
  })
}

export function draftToHabitCreateInput(draft: TypedTaskDraft) {
  return habitCreateSchema.parse({
    title: draft.title ?? '',
    cadenceType: draft.cadenceType ?? 'daily',
    cadenceDays: draft.cadenceDays,
    targetCount: draft.targetCount ?? 1,
    preferredStartTime: draft.preferredStartTime ?? '',
    preferredEndTime: draft.preferredEndTime ?? '',
    reminderAt: '',
  })
}

export function evaluateVoiceCaptureConfidence(draft: TypedTaskDraft, transcript: string): VoiceCaptureConfidence {
  const normalizedTranscript = normalizeCaptureInput(transcript)
  const transcriptTokens = tokenizeForCaptureMatching(normalizedTranscript)

  if (!normalizedTranscript || normalizedTranscript.length < 4 || transcriptTokens.length === 0) {
    return 'clarify'
  }

  const hasTaskHabitAmbiguity = draft.interpretationNotes.some((note) => isTaskHabitAmbiguityNote(note))
  const hasBlockingInterpretationNote = draft.interpretationNotes.some((note) =>
    /could not infer|ambiguous|unclear|clarify/i.test(note) && !isTaskHabitAmbiguityNote(note),
  )

  const hasNoUsefulStructure = !draft.title && !draft.dueDate && draft.cadenceType === null && !draft.notes

  if (hasNoUsefulStructure || hasTaskHabitAmbiguity) {
    return 'clarify'
  }

  if (hasBlockingInterpretationNote) {
    return 'review'
  }

  try {
    if (draft.candidateType === 'habit') {
      draftToHabitCreateInput(draft)
    } else {
      draftToTaskCreateInput(draft)
    }
  } catch {
    return 'review'
  }

  return 'high'
}

export function buildVoiceClarificationQuestions(draft: TypedTaskDraft, transcript: string) {
  const normalizedTranscript = normalizeCaptureInput(transcript)
  const transcriptTokens = tokenizeForCaptureMatching(normalizedTranscript)

  if (!normalizedTranscript || normalizedTranscript.length < 4 || transcriptTokens.length === 0) {
    return ['What do you want to add?']
  }

  const questions: Array<string> = []
  const hasTaskHabitAmbiguity = draft.interpretationNotes.some((note) => isTaskHabitAmbiguityNote(note))

  if (hasTaskHabitAmbiguity) {
    questions.push('Is this a one-time task or a habit you want to repeat?')
  }

  if (!draft.title) {
    questions.push(
      hasTaskHabitAmbiguity
        ? 'What should I call it?'
        : draft.candidateType === 'habit'
          ? 'What should I call this habit?'
          : 'What should I call this task?',
    )
  }

  if (draft.candidateType === 'habit') {
    if (draft.cadenceType === null) {
      questions.push('How often should it repeat?')
    }
  } else if (!hasTaskHabitAmbiguity && !draft.dueDate && !draft.dueTime && !draft.matchedCalendarContext) {
    questions.push('When do you want to do it?')
  }

  if (questions.length === 0) {
    questions.push('What detail should I use before I save this?')
  }

  return Array.from(new Set(questions)).slice(0, 3)
}

export function buildVoiceClarificationMessage(draft: TypedTaskDraft, transcript: string) {
  const normalizedTranscript = normalizeCaptureInput(transcript)
  const questions = buildVoiceClarificationQuestions(draft, transcript)

  if (!normalizedTranscript || normalizedTranscript.length < 4) {
    return 'I need you to restate that before I can save it.'
  }

  if (questions[0] === 'Is this a one-time task or a habit you want to repeat?') {
    return 'I need to confirm whether this belongs in tasks or habits.'
  }

  return 'I need a little more detail before I can save this.'
}

export function parseProcessVoiceCaptureFormData(input: unknown): ProcessVoiceCaptureInput {
  if (!(input instanceof FormData)) {
    throw new Error('Expected FormData.')
  }

  const audio = input.get('audio')
  const languageHint = input.get('languageHint')
  const source = input.get('source')
  const currentDate = input.get('currentDate')
  const timezone = input.get('timezone')
  const routeIntent = input.get('routeIntent')

  return processVoiceCaptureInputSchema.parse({
    audio,
    languageHint: typeof languageHint === 'string' && languageHint ? languageHint : undefined,
    source: typeof source === 'string' && source ? source : undefined,
    currentDate: typeof currentDate === 'string' ? currentDate : undefined,
    timezone: typeof timezone === 'string' ? timezone : undefined,
    routeIntent: typeof routeIntent === 'string' && routeIntent ? routeIntent : undefined,
  })
}
