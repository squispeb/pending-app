import { z } from 'zod'
import { taskCreateSchema, taskPrioritySchema, taskStatusSchema, type TaskStatus } from './tasks'
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
  'archive_task',
  'edit_task',
  'unsupported_task_action',
])
export const confirmVoiceTaskActionKindSchema = z.enum([
  'complete_task',
  'reopen_task',
  'archive_task',
  'edit_task',
])
export const voiceTaskEditChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    dueDate: captureDateSchema.optional(),
    dueTime: captureTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.title && value.description === undefined && value.dueDate === undefined && value.dueTime === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one task edit is required',
      })
    }
  })
export const voiceCalendarActionKindSchema = z.enum([
  'create_calendar_event',
  'edit_calendar_event',
  'cancel_calendar_event',
  'unsupported_calendar_action',
])
export const confirmVoiceCalendarEventOperationSchema = z.enum([
  'create_calendar_event',
  'edit_calendar_event',
  'cancel_calendar_event',
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

export const visibleTaskSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  status: taskStatusSchema,
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  priority: taskPrioritySchema,
  completedAt: z.string().nullable(),
})

export const visibleTaskWindowSchema = z.array(visibleTaskSummarySchema)

export const visibleCalendarEventSummarySchema = z.object({
  calendarEventId: z.string().min(1),
  summary: z.string().trim().min(1),
  startsAt: z.string().min(1).nullable(),
  endsAt: z.string().min(1).nullable(),
  allDay: z.boolean(),
  calendarName: z.string().trim().min(1),
  primaryFlag: z.boolean(),
})

export const visibleCalendarEventWindowSchema = z.array(visibleCalendarEventSummarySchema)

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

export const confirmVoiceTaskActionInputSchema = z.object({
  taskId: z.string().trim().min(1).max(120),
  action: confirmVoiceTaskActionKindSchema,
  edits: voiceTaskEditChangesSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'edit_task' && !value.edits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['edits'],
      message: 'Task edits are required for edit confirmations',
    })
  }
})

const voiceCalendarEventDraftSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  startDate: captureDateSchema,
  startTime: captureTimeSchema.optional(),
  endDate: captureDateSchema.optional(),
  endTime: captureTimeSchema.optional(),
  location: z.string().trim().min(1).optional(),
  allDay: z.boolean().optional(),
  targetCalendarId: z.string().trim().min(1).nullable().optional(),
  targetCalendarName: z.string().trim().min(1).nullable().optional(),
})

export const confirmVoiceCalendarEventCreateInputSchema = z.object({
  draft: voiceCalendarEventDraftSchema,
  timezone: z.string().trim().min(1).max(120),
})

export const processVoiceCaptureInputSchema = transcribeAudioUploadInputSchema.extend({
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  routeIntent: captureRouteIntentSchema.optional(),
  contextTaskId: z.string().trim().min(1).max(120).optional(),
  contextIdeaId: z.string().trim().min(1).max(120).optional(),
  visibleTaskWindow: visibleTaskWindowSchema.optional(),
  visibleCalendarEventWindow: visibleCalendarEventWindowSchema.optional(),
  followUpTaskAction: confirmVoiceTaskActionKindSchema.optional(),
  taskEditSessionId: z.string().trim().min(1).max(120).optional(),
  calendarEventSessionId: z.string().trim().min(1).max(120).optional(),
})

export const processVoiceCaptureTextInputSchema = z.object({
  transcript: z.string().trim().min(1).max(4000),
  language: transcriptionDetectedLanguageSchema.default('unknown'),
  currentDate: captureDateSchema,
  timezone: z.string().trim().min(1).max(120),
  routeIntent: captureRouteIntentSchema.optional(),
  contextTaskId: z.string().trim().min(1).max(120).optional(),
  contextIdeaId: z.string().trim().min(1).max(120).optional(),
  visibleTaskWindow: visibleTaskWindowSchema.optional(),
  visibleCalendarEventWindow: visibleCalendarEventWindowSchema.optional(),
  followUpTaskAction: confirmVoiceTaskActionKindSchema.optional(),
  taskEditSessionId: z.string().trim().min(1).max(120).optional(),
  calendarEventSessionId: z.string().trim().min(1).max(120).optional(),
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

const resolvedVoiceTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  status: taskStatusSchema,
  notes: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  priority: taskPrioritySchema,
  completedAt: z.string().nullable(),
  source: z.enum(['context_task', 'context_idea', 'visible_window']),
})

const processVoiceCaptureClarifyTaskActionContextSchema = z.object({
  action: confirmVoiceTaskActionKindSchema,
  task: resolvedVoiceTaskSchema,
})

const processVoiceTaskEditSessionSchema = z.object({
  sessionId: z.string().min(1),
})

const processVoiceCalendarEventTargetSchema = z.object({
  calendarEventId: z.string().min(1),
  summary: z.string().trim().min(1),
  startsAt: z.string().min(1).nullable().optional(),
  endsAt: z.string().min(1).nullable().optional(),
  allDay: z.boolean().optional(),
  calendarName: z.string().trim().min(1),
  primaryFlag: z.boolean(),
  source: z.literal('visible_window'),
})

const processVoiceCalendarEventSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  startDate: captureDateSchema.optional(),
  startTime: captureTimeSchema.optional(),
  endDate: captureDateSchema.optional(),
  endTime: captureTimeSchema.optional(),
  location: z.string().trim().min(1).optional(),
  allDay: z.boolean().optional(),
  targetCalendarId: z.string().trim().min(1).nullable().optional(),
  targetCalendarName: z.string().trim().min(1).nullable().optional(),
  operation: confirmVoiceCalendarEventOperationSchema.optional(),
  target: processVoiceCalendarEventTargetSchema.optional(),
})

const processVoiceCalendarEventSessionSchema = z.object({
  sessionId: z.string().min(1),
})

const confirmVoiceCalendarEventActionCalendarEventSchema = processVoiceCalendarEventSchema.extend({
  operation: z.enum(['edit_calendar_event', 'cancel_calendar_event']),
  target: processVoiceCalendarEventTargetSchema,
})

export const confirmVoiceCalendarEventActionInputSchema = z.object({
  calendarEvent: confirmVoiceCalendarEventActionCalendarEventSchema,
  calendarEventSession: processVoiceCalendarEventSessionSchema,
})

export const processVoiceCaptureClarifySchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('clarify'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  message: z.string().trim().min(1),
  questions: z.array(z.string().trim().min(1)).min(1),
  draft: typedTaskDraftSchema.nullable(),
  taskActionContext: processVoiceCaptureClarifyTaskActionContextSchema.optional(),
  taskEditSession: processVoiceTaskEditSessionSchema.optional(),
  calendarEvent: processVoiceCalendarEventSchema.optional(),
  calendarEventSession: processVoiceCalendarEventSessionSchema.optional(),
  calendarEventTarget: processVoiceCalendarEventTargetSchema.optional(),
  calendarEventTargetCandidates: z.array(processVoiceCalendarEventTargetSchema).optional(),
})

export const processVoiceCaptureTaskStatusSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('task_status'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  message: z.string().trim().min(1),
  task: resolvedVoiceTaskSchema,
})

export const processVoiceCaptureTaskActionConfirmationSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('task_action_confirmation'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  message: z.string().trim().min(1),
  action: confirmVoiceTaskActionKindSchema,
  task: resolvedVoiceTaskSchema,
  edits: voiceTaskEditChangesSchema.optional(),
  taskEditSession: processVoiceTaskEditSessionSchema.optional(),
  calendarEvent: processVoiceCalendarEventSchema.optional(),
  calendarEventSession: processVoiceCalendarEventSessionSchema.optional(),
  calendarEventTarget: processVoiceCalendarEventTargetSchema.optional(),
})

export const processVoiceCaptureCalendarEventConfirmationSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal('calendar_event_confirmation'),
  transcript: z.string().trim().min(1),
  language: transcriptionDetectedLanguageSchema,
  message: z.string().trim().min(1),
  calendarEvent: processVoiceCalendarEventSchema,
  calendarEventSession: processVoiceCalendarEventSessionSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.calendarEvent.operation === 'create_calendar_event' && !value.calendarEvent.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['calendarEvent', 'startDate'],
      message: 'Start date is required for calendar creation confirmations',
    })
  }

  if (value.calendarEvent.operation === 'edit_calendar_event' && !value.calendarEvent.target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['calendarEvent', 'target'],
      message: 'Target event details are required for edit confirmations',
    })
  }

  if (value.calendarEvent.operation === 'cancel_calendar_event' && !value.calendarEvent.target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['calendarEvent', 'target'],
      message: 'Target event details are required for cancel confirmations',
    })
  }
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
  processVoiceCaptureTaskStatusSchema,
  processVoiceCaptureTaskActionConfirmationSchema,
  processVoiceCaptureCalendarEventConfirmationSchema,
  processVoiceCaptureClarifySchema,
  processVoiceCaptureFailureSchema,
])

export type CaptureLanguageHint = z.infer<typeof captureLanguageHintSchema>
export type CaptureRouteIntent = z.infer<typeof captureRouteIntentSchema>
export type VoiceIntentFamily = z.infer<typeof voiceIntentFamilySchema>
export type VoiceTaskActionKind = z.infer<typeof voiceTaskActionKindSchema>
export type ConfirmVoiceTaskActionKind = z.infer<typeof confirmVoiceTaskActionKindSchema>
export type VoiceTaskEditChanges = z.infer<typeof voiceTaskEditChangesSchema>
export type VoiceCalendarActionKind = z.infer<typeof voiceCalendarActionKindSchema>
export type ConfirmVoiceCalendarEventOperation = z.infer<typeof confirmVoiceCalendarEventOperationSchema>
export type VoiceIntentClassification = z.infer<typeof voiceIntentClassificationSchema>
export type CandidateType = z.infer<typeof candidateTypeSchema>
export type VisibleTaskSummary = z.infer<typeof visibleTaskSummarySchema>
export type VisibleCalendarEventSummary = z.infer<typeof visibleCalendarEventSummarySchema>
export type VisibleCalendarEventWindow = z.infer<typeof visibleCalendarEventWindowSchema>
export type InterpretCaptureInput = z.infer<typeof interpretCaptureInputSchema>
export type TypedTaskDraft = z.infer<typeof typedTaskDraftSchema>
export type TypedTaskDraftProviderOutput = z.infer<typeof typedTaskDraftProviderOutputSchema>
export type InterpretCaptureSuccess = z.infer<typeof interpretCaptureSuccessSchema>
export type InterpretCaptureFailure = z.infer<typeof interpretCaptureFailureSchema>
export type ConfirmCapturedTaskInput = z.infer<typeof confirmCapturedTaskInputSchema>
export type ConfirmCapturedHabitInput = z.infer<typeof confirmCapturedHabitInputSchema>
export type ConfirmCapturedIdeaInput = z.infer<typeof confirmCapturedIdeaInputSchema>
export type ConfirmVoiceTaskActionInput = z.infer<typeof confirmVoiceTaskActionInputSchema>
export type ConfirmVoiceCalendarEventCreateInput = z.infer<typeof confirmVoiceCalendarEventCreateInputSchema>
export type ConfirmVoiceCalendarEventActionInput = z.infer<typeof confirmVoiceCalendarEventActionInputSchema>
export type MatchedCalendarContext = z.infer<typeof matchedCalendarContextSchema>
export type ProcessVoiceCaptureInput = z.infer<typeof processVoiceCaptureInputSchema>
export type ProcessVoiceCaptureTextInput = z.infer<typeof processVoiceCaptureTextInputSchema>
export type ProcessVoiceCaptureAutoSaved = z.infer<typeof processVoiceCaptureAutoSavedSchema>
export type ProcessVoiceCaptureIdeaConfirmation = z.infer<typeof processVoiceCaptureIdeaConfirmationSchema>
export type ProcessVoiceCaptureReview = z.infer<typeof processVoiceCaptureReviewSchema>
export type ProcessVoiceCaptureTaskStatus = z.infer<typeof processVoiceCaptureTaskStatusSchema>
export type ProcessVoiceCaptureTaskActionConfirmation = z.infer<typeof processVoiceCaptureTaskActionConfirmationSchema>
export type ProcessVoiceCaptureCalendarEventConfirmation = z.infer<typeof processVoiceCaptureCalendarEventConfirmationSchema>
export type ProcessVoiceCaptureClarify = z.infer<typeof processVoiceCaptureClarifySchema>
export type ProcessVoiceCaptureFailure = z.infer<typeof processVoiceCaptureFailureSchema>
export type ProcessVoiceCaptureResponse = z.infer<typeof processVoiceCaptureResponseSchema>
export type ProcessVoiceTaskEditSession = z.infer<typeof processVoiceTaskEditSessionSchema>
export type ProcessVoiceCalendarEvent = z.infer<typeof processVoiceCalendarEventSchema>
export type ProcessVoiceCalendarEventSession = z.infer<typeof processVoiceCalendarEventSessionSchema>
export type ProcessVoiceCalendarEventTarget = z.infer<typeof processVoiceCalendarEventTargetSchema>

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

function getUtcWeekStart(parts: LocalDateParts) {
  const currentDay = getUtcWeekday(parts)
  const daysFromMonday = (currentDay + 6) % 7
  return addUtcDays(parts, -daysFromMonday)
}

function normalizeExplicitDateYear(year: number) {
  if (year >= 1000) {
    return year
  }

  return 2000 + year
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function getDaysInMonth(year: number, month: number) {
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return monthLengths[month - 1] ?? 0
}

function tryBuildExplicitDate(year: number, month: number, day: number) {
  const normalizedYear = normalizeExplicitDateYear(year)
  const daysInMonth = getDaysInMonth(normalizedYear, month)

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null
  }

  return formatDateString({
    year: normalizedYear,
    month,
    day,
  })
}

function cleanLeadingVerbPrefix(value: string) {
  return value
    .replace(
      /^(tengo que|debo|hay que|necesito|quiero|voy a|vamos a|i need to|need to|have to|must|should|ought to|going to|gotta|gonna)\s+/i,
      '',
    )
    .trim()
}

function stripTitleDatePhrases(value: string) {
  return value
    .replace(/\b(para\s+)?(mañana|tomorrow)\b/gi, '')
    .replace(/\b(para\s+)?(next week|la proxima semana|proxima semana)\b/gi, '')
    .replace(/\b(para\s+)?(el\s+)?(domingo que viene|next sunday|este viernes|this friday)\b/gi, '')
    .replace(/\b(para\s+)?\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\b(para\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
    .trim()
}

export function normalizeCaptureInput(rawInput: string) {
  return rawInput.replace(/\s+/g, ' ').trim()
}

export function normalizeCaptureNotes(rawInput: string) {
  return rawInput
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
  const normalizedForDates = normalizedInput
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (/\b(mañana|tomorrow)\b/i.test(normalizedInput)) {
    return formatDateString(addUtcDays(baseDate, 1))
  }

  if (/\b(next week|la proxima semana|proxima semana)\b/i.test(normalizedForDates)) {
    return formatDateString(addUtcDays(getUtcWeekStart(baseDate), 7))
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

  const isoDateMatch = normalizedForDates.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)

  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch
    return tryBuildExplicitDate(Number(year), Number(month), Number(day))
  }

  const slashDateMatch = normalizedForDates.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)

  if (slashDateMatch) {
    const [, month, day, year = `${baseDate.year}`] = slashDateMatch
    return tryBuildExplicitDate(Number(year), Number(month), Number(day))
  }

  return null
}

export function inferTitleFromInput(normalizedInput: string) {
  const firstClause = normalizedInput.split(/[,.!?;]/, 1)[0]?.trim() ?? ''
  const cleaned = stripTitleDatePhrases(cleanLeadingVerbPrefix(firstClause))

  if (!cleaned) {
    return null
  }

  const normalizedTitle = cleaned.slice(0, 120).trim()

  return normalizedTitle || null
}

function chooseDraftNotes(
  heuristicNotes: string | null,
  providerNotes: string | null | undefined,
) {
  if (providerNotes === undefined || providerNotes === null) {
    return heuristicNotes
  }

  if (!heuristicNotes) {
    return normalizeCaptureNotes(providerNotes)
  }

  const normalizedHeuristicNotes = normalizeCaptureNotes(heuristicNotes)
  const normalizedProviderNotes = normalizeCaptureNotes(providerNotes)

  if (!normalizedProviderNotes) {
    return normalizedHeuristicNotes || null
  }

  if (normalizedHeuristicNotes === normalizedProviderNotes) {
    return normalizedProviderNotes
  }

  const heuristicHasExplicitStructure = normalizedHeuristicNotes.includes('\n')
  const providerHasExplicitStructure = normalizedProviderNotes.includes('\n')

  if (heuristicHasExplicitStructure && !providerHasExplicitStructure) {
    return normalizedHeuristicNotes
  }

  if (normalizedHeuristicNotes.length >= normalizedProviderNotes.length + 24) {
    return normalizedHeuristicNotes
  }

  return normalizedProviderNotes
}

export function buildHeuristicTaskDraft(
  input: Pick<InterpretCaptureInput, 'rawInput' | 'currentDate' | 'timezone'>,
) {
  const normalizedInput = normalizeCaptureInput(input.rawInput)
  const normalizedNotes = normalizeCaptureNotes(input.rawInput)
  const titleInput = normalizeCaptureInput(input.rawInput.split(/\r?\n/, 1)[0] ?? input.rawInput)
  const interpretationNotes: Array<string> = []
  const priority = inferPriorityFromInput(normalizedInput)
  const dueDate = inferDueDateFromInput(normalizedInput, input.currentDate, input.timezone)
  const title = inferTitleFromInput(titleInput)
  const notes = title && normalizedNotes.length > title.length + 5 ? normalizedNotes : null
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
    notes: chooseDraftNotes(heuristicDraft.notes, providerDraft?.notes),
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

  if (draft.candidateType === 'task' && !draft.dueDate) {
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

function formatCompletedAt(value: string, language: z.infer<typeof transcriptionDetectedLanguageSchema>) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  const datePart = parsed.toISOString().slice(0, 10)
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(parsed)

  return language === 'es' ? `${datePart} a las ${timePart} UTC` : `${datePart} at ${timePart} UTC`
}

export function buildVoiceTaskStatusMessage(
  task: {
    title: string
    status: TaskStatus
    priority?: 'low' | 'medium' | 'high' | null
    dueDate: string | null
    dueTime: string | null
    completedAt: string | null
  },
  language: z.infer<typeof transcriptionDetectedLanguageSchema>,
) {
  const priorityText = task.priority
    ? language === 'es'
      ? ` Prioridad: ${task.priority === 'low' ? 'baja' : task.priority === 'medium' ? 'media' : 'alta'}.`
      : ` Priority: ${task.priority}.`
    : ''
  const dueText = task.dueDate
    ? language === 'es'
      ? ` Vence el ${task.dueDate}${task.dueTime ? ` a las ${task.dueTime}` : ''}.`
      : ` It is due ${task.dueDate}${task.dueTime ? ` at ${task.dueTime}` : ''}.`
    : ''
  const completedText =
    task.status === 'completed' && task.completedAt
      ? language === 'es'
        ? ` Se completó el ${formatCompletedAt(task.completedAt, language)}.`
        : ` It was completed on ${formatCompletedAt(task.completedAt, language)}.`
      : ''

  if (language === 'es') {
    return task.status === 'completed'
      ? `La tarea "${task.title}" está completada.${priorityText}${completedText}${dueText}`
      : `La tarea "${task.title}" está activa.${priorityText}${dueText}`
  }

  return task.status === 'completed'
    ? `The task "${task.title}" is completed.${priorityText}${completedText}${dueText}`
    : `The task "${task.title}" is active.${priorityText}${dueText}`
}

export function buildVoiceTaskActionConfirmationMessage(
  task: { title: string },
  action: ConfirmVoiceTaskActionKind,
  language: z.infer<typeof transcriptionDetectedLanguageSchema>,
) {
  if (language === 'es') {
    if (action === 'complete_task') {
      return `Entendí eso como completar la tarea "${task.title}". Confirma si quieres que la marque como completada.`
    }

    if (action === 'archive_task') {
      return `Entendí eso como archivar la tarea "${task.title}". Confirma si quieres que la archive.`
    }

    return `Entendí eso como reabrir la tarea "${task.title}". Confirma si quieres que la vuelva a marcar como activa.`
  }

  if (action === 'complete_task') {
    return `I understood that as completing the task "${task.title}". Confirm if you want me to mark it as completed.`
  }

  if (action === 'archive_task') {
    return `I understood that as archiving the task "${task.title}". Confirm if you want me to archive it.`
  }

  return `I understood that as reopening the task "${task.title}". Confirm if you want me to move it back to active.`
}

export function buildVoiceTaskEditConfirmationMessage(
  task: { title: string },
  edits: VoiceTaskEditChanges,
  language: z.infer<typeof transcriptionDetectedLanguageSchema>,
) {
  const changeParts: Array<string> = []

  if (edits.title) {
    changeParts.push(language === 'es' ? `título \"${edits.title}\"` : `title "${edits.title}"`)
  }

  if (edits.description !== undefined) {
    changeParts.push(language === 'es' ? 'descripción actualizada' : 'description updated')
  }

  if (edits.dueDate !== undefined) {
    changeParts.push(language === 'es' ? `fecha de vencimiento \"${edits.dueDate}\"` : `due date "${edits.dueDate}"`)
  }

  if (edits.dueTime !== undefined) {
    changeParts.push(language === 'es' ? `hora de vencimiento \"${edits.dueTime}\"` : `due time "${edits.dueTime}"`)
  }

  if (language === 'es') {
    return `Entendí eso como editar la tarea "${task.title}" para ${changeParts.join(', ')}. Confirma si quieres que aplique esos cambios.`
  }

  return `I understood that as editing the task "${task.title}" to ${changeParts.join(', ')}. Confirm if you want me to apply those changes.`
}

function extractVoiceTaskEditFieldValue(value: string, cues: Array<RegExp>) {
  for (const cue of cues) {
    const match = value.match(cue)

    if (match?.[1]) {
      return match[1].replace(/^[\s:,-]+|[\s:,-]+$/g, '').trim() || null
    }
  }

  return null
}

function splitVoiceTaskEditClauses(value: string) {
  return value
    .split(/\s*(?:,|;|\band\b|\by\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeVoiceTaskEditClause(value: string) {
  return value
    .replace(/^update\s+(?:the\s+)?description\s+to\s+/i, 'description ')
    .replace(/^change\s+(?:the\s+)?description\s+to\s+/i, 'description ')
    .replace(/^set\s+(?:the\s+)?description\s+to\s+/i, 'description ')
    .replace(/^update\s+(?:the\s+)?notes?\s+to\s+/i, 'notes ')
    .replace(/^change\s+(?:the\s+)?notes?\s+to\s+/i, 'notes ')
    .replace(/^set\s+(?:the\s+)?notes?\s+to\s+/i, 'notes ')
    .trim()
}

export function inferVoiceTaskEditChanges(
  input: Pick<InterpretCaptureInput, 'rawInput' | 'currentDate' | 'timezone'>,
) {
  const normalizedInput = normalizeCaptureInput(input.rawInput)

  if (!normalizedInput) {
    return null
  }

  const clauses = splitVoiceTaskEditClauses(normalizedInput)
  let title: string | undefined
  let description: string | undefined
  let dueDate: string | undefined
  let dueTime: string | undefined

  const explicitTimeRegex = /\b(?:at|a las)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i
  const spokenTimeRegex = /\b(?:at|a las)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b(?:\s+(in the morning|in the afternoon|in the evening|at night|de la manana|de la mañana|de la tarde|de la noche))?/i

  const spokenHours: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  }

  function inferDueTimeFromClause(value: string) {
    const explicitTime = value.match(explicitTimeRegex)

    if (explicitTime) {
      let hour = Number(explicitTime[1])
      const minute = Number(explicitTime[2] ?? '0')
      const meridiem = explicitTime[3]?.replace(/\./g, '').toLowerCase()

      if (!Number.isNaN(hour) && !Number.isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        if (meridiem === 'pm' && hour < 12) {
          hour += 12
        }

        if (meridiem === 'am' && hour === 12) {
          hour = 0
        }

        return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`
      }
    }

    const spokenTime = value.match(spokenTimeRegex)

    if (!spokenTime) {
      return null
    }

    let hour = spokenHours[spokenTime[1].toLowerCase()]

    if (!hour) {
      return null
    }

    const timeQualifier = spokenTime[2]?.toLowerCase() ?? ''

    if (/afternoon|evening|night|de la tarde|de la noche/.test(timeQualifier) && hour < 12) {
      hour += 12
    }

    if (/morning|de la manana|de la mañana/.test(timeQualifier) && hour === 12) {
      hour = 0
    }

    return `${`${hour}`.padStart(2, '0')}:00`
  }

  for (const clause of clauses) {
    const normalizedClause = normalizeVoiceTaskEditClause(clause)

    if (!title) {
      title = extractVoiceTaskEditFieldValue(normalizedClause, [
        /\b(?:rename|renombra(?:r)?|retitle|set title|change title)\s+(?:this\s+task\s+)?(?:to|as|a|al)?\s+(.+)$/i,
        /\b(?:title)\s*(?:to|as|:)?\s+(.+)$/i,
      ]) ?? undefined
    }

    if (!description) {
      description = extractVoiceTaskEditFieldValue(normalizedClause, [
        /\b(?:description|descripci[oó]n|notes?|nota(?:s)?)\s*(?:to|as|:)?\s+(.+)$/i,
      ]) ?? undefined
    }

    if (!dueDate) {
      const inferredDueDate = inferDueDateFromInput(clause, input.currentDate, input.timezone)
      if (inferredDueDate) {
        dueDate = inferredDueDate
      }
    }

    if (!dueTime) {
      const inferredDueTime = inferDueTimeFromClause(clause)
      if (inferredDueTime) {
        dueTime = inferredDueTime
      }
    }
  }

  if (!title && !description && !dueDate && !dueTime) {
    return null
  }

  return voiceTaskEditChangesSchema.parse({
    title,
    description,
    dueDate,
    dueTime,
  })
}

export function buildVoiceTaskActionAlreadyAppliedMessage(
  task: { title: string },
  action: ConfirmVoiceTaskActionKind,
  language: z.infer<typeof transcriptionDetectedLanguageSchema>,
) {
  if (language === 'es') {
    if (action === 'complete_task') {
      return `La tarea "${task.title}" ya está completada.`
    }

    if (action === 'archive_task') {
      return `La tarea "${task.title}" ya está archivada.`
    }

    return `La tarea "${task.title}" ya está activa.`
  }

  if (action === 'complete_task') {
    return `The task "${task.title}" is already completed.`
  }

  if (action === 'archive_task') {
    return `The task "${task.title}" is already archived.`
  }

  return `The task "${task.title}" is already active.`
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
  const contextTaskId = input.get('contextTaskId')
  const contextIdeaId = input.get('contextIdeaId')
  const visibleTaskWindow = input.get('visibleTaskWindow')
  const visibleCalendarEventWindow = input.get('visibleCalendarEventWindow')
  const followUpTaskAction = input.get('followUpTaskAction')
  const taskEditSessionId = input.get('taskEditSessionId')
  const calendarEventSessionId = input.get('calendarEventSessionId')

  let parsedVisibleTaskWindow: unknown = undefined
  let parsedVisibleCalendarEventWindow: unknown = undefined

  if (typeof visibleTaskWindow === 'string' && visibleTaskWindow) {
    try {
      parsedVisibleTaskWindow = JSON.parse(visibleTaskWindow)
    } catch {
      throw new Error('Invalid visibleTaskWindow JSON.')
    }
  }

  if (typeof visibleCalendarEventWindow === 'string' && visibleCalendarEventWindow) {
    try {
      parsedVisibleCalendarEventWindow = JSON.parse(visibleCalendarEventWindow)
    } catch {
      throw new Error('Invalid visibleCalendarEventWindow JSON.')
    }
  }

  return processVoiceCaptureInputSchema.parse({
    audio,
    languageHint: typeof languageHint === 'string' && languageHint ? languageHint : undefined,
    source: typeof source === 'string' && source ? source : undefined,
    currentDate: typeof currentDate === 'string' ? currentDate : undefined,
    timezone: typeof timezone === 'string' ? timezone : undefined,
    routeIntent: typeof routeIntent === 'string' && routeIntent ? routeIntent : undefined,
    contextTaskId: typeof contextTaskId === 'string' && contextTaskId ? contextTaskId : undefined,
    contextIdeaId: typeof contextIdeaId === 'string' && contextIdeaId ? contextIdeaId : undefined,
    visibleTaskWindow: parsedVisibleTaskWindow,
    visibleCalendarEventWindow: parsedVisibleCalendarEventWindow,
    followUpTaskAction:
      typeof followUpTaskAction === 'string' && followUpTaskAction ? followUpTaskAction : undefined,
    taskEditSessionId:
      typeof taskEditSessionId === 'string' && taskEditSessionId ? taskEditSessionId : undefined,
    calendarEventSessionId:
      typeof calendarEventSessionId === 'string' && calendarEventSessionId ? calendarEventSessionId : undefined,
  })
}
