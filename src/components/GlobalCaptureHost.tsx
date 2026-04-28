import { useRef, useState, useEffect, useCallback } from 'react'
import { CalendarDays, CheckCircle, ChevronDown, Lightbulb, Mic, RotateCcw, SendHorizonal, Square, X } from 'lucide-react'
import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { CaptureContext } from '../contexts/CaptureContext'
import type { CaptureOpenOptions, VisibleTaskSummaryItem } from '../contexts/CaptureContext'
import { resolveCaptureOpenTargets } from '../contexts/CaptureContext'
import {
  habitFormSchema,
  toHabitFormValues,
  type HabitFormValues,
  type HabitWeekday,
} from '../lib/habits'
import {
  taskFormSchema,
  toTaskFormValues,
  getTodayDateString,
  type TaskFormValues,
} from '../lib/tasks'
import { formatDisplayDate, formatDisplayDateTime, formatDisplayTime } from '../lib/date-time'
import type {
  CandidateType,
  ConfirmVoiceTaskActionKind,
  ConfirmVoiceCalendarEventOperation,
  ProcessVoiceCaptureAutoSaved,
  ProcessVoiceCaptureCalendarEvent,
  ProcessVoiceCaptureCalendarEventConfirmation,
  ProcessVoiceCaptureClarify,
  ProcessVoiceCaptureTaskActionConfirmation,
  ProcessVoiceCaptureTaskStatus,
  TypedTaskDraft,
} from '../lib/capture'
import { shouldAutoCreateIdeaCapture } from '../lib/capture-flow'
import { getIdeaThreadTarget, getRouteIntent, routeContext } from '../lib/capture-routing'
import { createAssistantSessionStreamState } from '../lib/assistant-session-stream'
import { applyAssistantSessionStreamResponse } from '../lib/assistant-session-streaming'
import {
  confirmCapturedIdea as confirmCapturedIdeaFn,
  confirmCapturedHabit as confirmCapturedHabitFn,
  confirmCapturedTask as confirmCapturedTaskFn,
  confirmVoiceCalendarEventCreate as confirmVoiceCalendarEventCreateFn,
  confirmVoiceCalendarEventAction as confirmVoiceCalendarEventActionFn,
  confirmVoiceTaskAction as confirmVoiceTaskActionFn,
  interpretCaptureInput,
  processVoiceCapture,
  processVoiceCaptureTranscript,
  submitAssistantSessionTurn,
  streamAssistantSession,
} from '../server/capture'
import { submitIdeaThreadTurn } from '../server/ideas'
import { transcribeCaptureAudio } from '../server/transcription'
import { ideaFormSchema, toIdeaFormValues, type IdeaFormValues } from '../lib/ideas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type CaptureMode =
  | 'closed'
  | 'recording'
  | 'transcribing'
  | 'interpreting'
  | 'input'
  | 'review'
  | 'clarify'
  | 'task_action_confirmation'
  | 'calendar_event_confirmation'
  | 'task_status'
  | 'success'

const EMPTY_TASK_FORM = toTaskFormValues(null)
const EMPTY_HABIT_FORM = toHabitFormValues(null)
const EMPTY_IDEA_FORM = toIdeaFormValues(null)

const WEEKDAYS: Array<{ value: HabitWeekday; label: string }> = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

// ---------------------------------------------------------------------------
// SelectedTaskSummaryCard — compact task preview used in voice panels
// ---------------------------------------------------------------------------
type SelectedTaskSummaryCardProps = {
  title: string
  status: string
  notes?: string | null
  dueDate?: string | null
  dueTime?: string | null
  priority?: string | null
  source?: string | null
}

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-[var(--ink-soft)]',
}

const SOURCE_LABELS: Record<string, string> = {
  context_task: 'From context',
  context_idea: 'From idea context',
  visible_window: 'From screen',
}

export function SelectedTaskSummaryCard({
  title,
  status,
  notes,
  dueDate,
  dueTime,
  priority,
  source,
}: SelectedTaskSummaryCardProps) {
  const isCompleted = status === 'completed'
  const dueLine = dueDate ? (dueTime ? `${dueDate} at ${dueTime}` : dueDate) : null
  const sourceLabel = source ? SOURCE_LABELS[source] : null

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
        Task
      </span>
      <p className="m-0 text-sm font-semibold leading-5 text-[var(--ink-strong)]">{title}</p>
      {notes ? (
        <p className="mt-2 m-0 text-sm leading-6 text-[var(--ink-soft)]">{notes}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Status badge */}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            isCompleted
              ? 'bg-green-500/15 text-green-400'
              : 'bg-[var(--brand)]/10 text-[var(--brand)]'
          }`}
        >
          {isCompleted ? 'Completed' : 'Active'}
        </span>

        {/* Priority */}
        {priority ? (
          <span className={`text-xs font-medium ${PRIORITY_COLORS[priority] ?? 'text-[var(--ink-soft)]'}`}>
            {PRIORITY_LABELS[priority] ?? priority} priority
          </span>
        ) : null}

        {/* Due timing */}
        {dueLine ? (
          <span className="text-xs text-[var(--ink-soft)]">Due {dueLine}</span>
        ) : null}

        {/* Resolution source — only when informative and not obvious */}
        {sourceLabel && source !== 'context_task' ? (
          <span className="text-xs text-[var(--ink-soft)]">{sourceLabel}</span>
        ) : null}
      </div>
    </div>
  )
}

type VoiceTaskClarifyPanelProps = {
  transcript: string
  message: string
  questions: string[]
  reply: string
  isSubmitting: boolean
  isRecording: boolean
  error: string | null
  streamingAssistantText?: string
  taskAction?: ConfirmVoiceTaskActionKind | null
  task?: SelectedTaskSummaryCardProps | null
  onReplyChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  onStartVoiceReply: () => void
  onEditFromScratch: () => void
  onCancel: () => void
}

export function VoiceTaskClarifyPanel({
  transcript,
  message,
  questions,
  reply,
  isSubmitting,
  isRecording,
  error,
  streamingAssistantText,
  taskAction,
  task,
  onReplyChange,
  onSubmit,
  onStartVoiceReply,
  onEditFromScratch,
  onCancel,
}: VoiceTaskClarifyPanelProps) {
  return (
    <div className="space-y-4">
      {task ? <SelectedTaskSummaryCard {...task} /> : null}

      <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
          Transcript
        </span>
        <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{transcript}</p>
      </div>

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
        <p className="m-0 text-sm font-medium text-amber-200">{message}</p>
        {streamingAssistantText ? (
          <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-amber-100">{streamingAssistantText}</p>
        ) : null}
        {questions.length > 0 ? (
          <ul className="m-0 mt-3 space-y-1 pl-4">
            {questions.map((question, index) => (
              <li key={index} className="text-sm leading-6 text-amber-100">
                {question}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Your reply</span>
          <textarea
            autoFocus
            value={reply}
            onChange={(e) => onReplyChange(e.target.value)}
            rows={3}
            placeholder={taskAction === 'edit_task' ? 'Describe the task change you want…' : 'Answer the questions above…'}
            className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit(e as unknown as React.FormEvent)
              }
            }}
          />
        </label>

        {error ? <p className="m-0 text-sm font-medium text-red-500">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || !reply.trim()}
            className="primary-pill inline-flex cursor-pointer items-center gap-1.5 border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <SendHorizonal size={14} />
            {isSubmitting ? 'Interpreting…' : 'Send reply'}
          </button>
          <button
            type="button"
            onClick={onStartVoiceReply}
            disabled={isSubmitting || isRecording}
            className="secondary-pill inline-flex cursor-pointer items-center gap-1.5 border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mic size={14} />
            {isRecording ? 'Listening…' : 'Reply with voice'}
          </button>
          <button
            type="button"
            onClick={onEditFromScratch}
            className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            <RotateCcw size={13} />
            Edit from scratch
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

type CalendarEventSummaryCardProps = {
  event: ProcessVoiceCaptureCalendarEvent
  eyebrow?: string
}

function formatCalendarEventWhen(event: ProcessVoiceCaptureCalendarEvent) {
  const startLabel = formatDisplayDate(event.startDate)
  const startText = event.allDay || !event.startTime
    ? `${startLabel} all day`
    : `${startLabel} at ${formatDisplayTime(event.startTime)}`

  if (!event.endDate) {
    return startText
  }

  if (event.endDate === event.startDate) {
    return event.endTime ? `${startText} until ${formatDisplayTime(event.endTime)}` : startText
  }

  const endLabel = formatDisplayDate(event.endDate)
  return `${startText} through ${endLabel}${event.endTime ? ` at ${formatDisplayTime(event.endTime)}` : ''}`
}

export function CalendarEventSummaryCard({ event, eyebrow = 'Calendar event' }: CalendarEventSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
        {eyebrow}
      </span>
      {event.title ? (
        <p className="m-0 text-sm font-semibold leading-5 text-[var(--ink-strong)]">{event.title}</p>
      ) : null}
      <dl className="m-0 mt-2 space-y-2">
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">When</dt>
          <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{formatCalendarEventWhen(event)}</dd>
        </div>
        {event.location ? (
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">Location</dt>
            <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{event.location}</dd>
          </div>
        ) : null}
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">Calendar</dt>
          <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{event.targetCalendarName ?? 'Primary calendar'}</dd>
        </div>
      </dl>
    </div>
  )
}

type CalendarEventTargetSummaryCardProps = {
  target: NonNullable<ProcessVoiceCaptureCalendarEvent['target']>
  eyebrow?: string
}

function formatCalendarEventTargetWhen(target: NonNullable<ProcessVoiceCaptureCalendarEvent['target']>) {
  if (!target.startsAt) {
    return target.allDay ? 'All day' : 'Time not specified'
  }

  if (target.allDay || !target.endsAt) {
    return formatDisplayDateTime(target.startsAt)
  }

  return `${formatDisplayDateTime(target.startsAt)} until ${formatDisplayDateTime(target.endsAt)}`
}

export function CalendarEventTargetSummaryCard({ target, eyebrow = 'Target event' }: CalendarEventTargetSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
        {eyebrow}
      </span>
      <p className="m-0 text-sm font-semibold leading-5 text-[var(--ink-strong)]">{target.summary}</p>
      <dl className="m-0 mt-2 space-y-2">
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">When</dt>
          <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{formatCalendarEventTargetWhen(target)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">Calendar</dt>
          <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{target.calendarName}</dd>
        </div>
      </dl>
    </div>
  )
}

type CalendarEventChangesSummaryCardProps = {
  event: ProcessVoiceCaptureCalendarEvent
  eyebrow?: string
}

function formatCalendarEventChangeLabel(field: 'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'allDay' | 'targetCalendar') {
  if (field === 'startDate') return 'Start date'
  if (field === 'startTime') return 'Start time'
  if (field === 'endDate') return 'End date'
  if (field === 'endTime') return 'End time'
  if (field === 'location') return 'Location'
  if (field === 'allDay') return 'All day'
  if (field === 'targetCalendar') return 'Calendar'
  if (field === 'description') return 'Description'
  return 'Title'
}

function formatCalendarEventChangeValue(event: ProcessVoiceCaptureCalendarEvent, field: 'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'allDay' | 'targetCalendar') {
  if (field === 'title') return event.title ?? ''
  if (field === 'description') return event.description ?? ''
  if (field === 'startDate') return formatDisplayDate(event.startDate ?? '')
  if (field === 'startTime') return event.startTime ? formatDisplayTime(event.startTime) : ''
  if (field === 'endDate') return event.endDate ? formatDisplayDate(event.endDate) : ''
  if (field === 'endTime') return event.endTime ? formatDisplayTime(event.endTime) : ''
  if (field === 'location') return event.location ?? ''
  if (field === 'allDay') return event.allDay ? 'Yes' : 'No'
  return event.targetCalendarName ?? 'Primary calendar'
}

export function CalendarEventChangesSummaryCard({ event, eyebrow = 'Proposed changes' }: CalendarEventChangesSummaryCardProps) {
  const fields: Array<'title' | 'description' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'allDay' | 'targetCalendar'> = []

  if (event.title) fields.push('title')
  if (event.description) fields.push('description')
  if (event.startDate) fields.push('startDate')
  if (event.startTime) fields.push('startTime')
  if (event.endDate) fields.push('endDate')
  if (event.endTime) fields.push('endTime')
  if (event.location) fields.push('location')
  if (typeof event.allDay === 'boolean') fields.push('allDay')
  if (event.targetCalendarId || event.targetCalendarName) fields.push('targetCalendar')

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
        {eyebrow}
      </span>
      {fields.length > 0 ? (
        <dl className="m-0 space-y-2">
          {fields.map((field) => (
            <div key={field} className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">{formatCalendarEventChangeLabel(field)}</dt>
              <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{formatCalendarEventChangeValue(event, field)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">No change details were provided.</p>
      )}
    </div>
  )
}

type VoiceCalendarEventConfirmationPanelProps = {
  transcript: string
  message: string
  confirmLabel: string
  isConfirming: boolean
  error: string | null
  event: ProcessVoiceCaptureCalendarEvent
  onConfirm: (event: React.FormEvent) => void
  onCancel: () => void
}

function getCalendarEventConfirmationActionLabel(operation?: ConfirmVoiceCalendarEventOperation) {
  if (operation === 'edit_calendar_event') {
    return 'Review these event edits'
  }

  if (operation === 'cancel_calendar_event') {
    return 'Cancel this calendar event'
  }

  return 'Create this calendar event'
}

export function VoiceCalendarEventConfirmationPanel({
  transcript: _transcript,
  message,
  confirmLabel,
  isConfirming,
  error,
  event,
  onConfirm,
  onCancel,
}: VoiceCalendarEventConfirmationPanelProps) {
  const isEdit = event.operation === 'edit_calendar_event'
  const isCancel = event.operation === 'cancel_calendar_event'

  return (
    <form className="space-y-4" onSubmit={onConfirm}>
      <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">{getCalendarEventConfirmationActionLabel(event.operation)}</p>
      {isEdit || isCancel ? <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{message}</p> : null}

      {isEdit && event.target ? (
        <div className="space-y-3">
          <CalendarEventTargetSummaryCard target={event.target} />
          <CalendarEventChangesSummaryCard event={event} />
        </div>
      ) : (
        <CalendarEventSummaryCard event={event} eyebrow={isCancel ? 'Event to cancel' : 'Event details'} />
      )}

      {isCancel ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3">
          <p className="m-0 text-sm font-medium text-red-200">
            This will permanently cancel the selected calendar event.
          </p>
        </div>
      ) : null}

      {error ? <p className="m-0 text-sm font-medium text-red-500">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isConfirming}
          className={
            isCancel
              ? 'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-red-500/40 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60'
              : 'primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

type VoiceCalendarClarifyPanelProps = {
  transcript: string
  message: string
  questions: string[]
  reply: string
  isSubmitting: boolean
  isRecording: boolean
  error: string | null
  streamingAssistantText?: string
  calendarEvent?: ProcessVoiceCaptureCalendarEvent | null
  onReplyChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  onStartVoiceReply: () => void
  onEditFromScratch: () => void
  onCancel: () => void
}

export function VoiceCalendarClarifyPanel({
  transcript,
  message,
  questions,
  reply,
  isSubmitting,
  isRecording,
  error,
  streamingAssistantText,
  calendarEvent,
  onReplyChange,
  onSubmit,
  onStartVoiceReply,
  onEditFromScratch,
  onCancel,
}: VoiceCalendarClarifyPanelProps) {
  return (
    <div className="space-y-4">
      {calendarEvent ? <CalendarEventSummaryCard event={calendarEvent} eyebrow="Event so far" /> : null}

      <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
          Transcript
        </span>
        <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{transcript}</p>
      </div>

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
        <p className="m-0 text-sm font-medium text-amber-200">{message}</p>
        {streamingAssistantText ? (
          <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-amber-100">{streamingAssistantText}</p>
        ) : null}
        {questions.length > 0 ? (
          <ul className="m-0 mt-3 space-y-1 pl-4">
            {questions.map((question, index) => (
              <li key={index} className="text-sm leading-6 text-amber-100">
                {question}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Your reply</span>
          <textarea
            autoFocus
            value={reply}
            onChange={(e) => onReplyChange(e.target.value)}
            rows={3}
            placeholder="Answer the questions above…"
            className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit(e as unknown as React.FormEvent)
              }
            }}
          />
        </label>

        {error ? <p className="m-0 text-sm font-medium text-red-500">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || !reply.trim()}
            className="primary-pill inline-flex cursor-pointer items-center gap-1.5 border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <SendHorizonal size={14} />
            {isSubmitting ? 'Interpreting…' : 'Send reply'}
          </button>
          <button
            type="button"
            onClick={onStartVoiceReply}
            disabled={isSubmitting || isRecording}
            className="secondary-pill inline-flex cursor-pointer items-center gap-1.5 border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mic size={14} />
            {isRecording ? 'Listening…' : 'Reply with voice'}
          </button>
          <button
            type="button"
            onClick={onEditFromScratch}
            className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            <RotateCcw size={13} />
            Edit from scratch
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

type VoiceTaskStatusPanelProps = {
  transcript: string
  message: string
  task?: SelectedTaskSummaryCardProps | null
  onDone: () => void
}

export function VoiceTaskStatusPanel({ transcript: _transcript, message, task, onDone }: VoiceTaskStatusPanelProps) {
  return (
    <div className="space-y-4">
      {task ? <SelectedTaskSummaryCard {...task} /> : null}

      <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{message}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onDone}
          className="primary-pill cursor-pointer border-0 text-sm font-semibold"
        >
          Done
        </button>
      </div>
    </div>
  )
}

type VoiceTaskActionConfirmationPanelProps = {
  transcript: string
  message: string
  actionLabel: string
  confirmLabel: string
  isConfirming: boolean
  error: string | null
  task?: SelectedTaskSummaryCardProps | null
  edits?: ProcessVoiceCaptureTaskActionConfirmation['edits']
  onConfirm: (event: React.FormEvent) => void
  onCancel: () => void
}

function formatTaskEditFieldLabel(field: 'title' | 'description' | 'dueDate' | 'dueTime') {
  if (field === 'dueDate') {
    return 'Due date'
  }

  if (field === 'dueTime') {
    return 'Due time'
  }

  if (field === 'description') {
    return 'Description'
  }

  return 'Title'
}

function formatTaskEditFieldValue(field: 'title' | 'description' | 'dueDate' | 'dueTime', value: string) {
  if (field === 'dueDate') {
    return formatDisplayDate(value)
  }

  if (field === 'dueTime') {
    return formatDisplayTime(value)
  }

  return value
}

export function VoiceTaskActionConfirmationPanel({
  transcript: _transcript,
  message: _message,
  actionLabel,
  confirmLabel,
  isConfirming,
  error,
  task,
  edits,
  onConfirm,
  onCancel,
}: VoiceTaskActionConfirmationPanelProps) {
  const editEntries: Array<{ field: 'title' | 'description' | 'dueDate' | 'dueTime'; value: string }> = []

  if (edits?.title) {
    editEntries.push({ field: 'title', value: edits.title })
  }

  if (edits?.description) {
    editEntries.push({ field: 'description', value: edits.description })
  }

  if (edits?.dueDate) {
    editEntries.push({
      field: 'dueDate',
      value: edits.dueTime ? `${formatDisplayDate(edits.dueDate)} at ${formatDisplayTime(edits.dueTime)}` : formatDisplayDate(edits.dueDate),
    })
  } else if (edits?.dueTime) {
    editEntries.push({ field: 'dueTime', value: formatDisplayTime(edits.dueTime) })
  }

  return (
    <form className="space-y-4" onSubmit={onConfirm}>
      {task ? <SelectedTaskSummaryCard {...task} /> : null}

      <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">{actionLabel}</p>

      {editEntries.length > 0 ? (
        <dl className="m-0 space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
          {editEntries.map(({ field, value }) => (
            <div key={field} className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">{formatTaskEditFieldLabel(field)}</dt>
              <dd className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{field === 'dueDate' && edits?.dueTime ? value : formatTaskEditFieldValue(field, value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {error ? <p className="m-0 text-sm font-medium text-red-500">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isConfirming}
          className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function draftToTaskForm(draft: TypedTaskDraft): TaskFormValues {
  return {
    title: draft.title ?? '',
    notes: draft.notes ?? '',
    priority: draft.priority ?? 'medium',
    dueDate: draft.dueDate ?? '',
    dueTime: draft.dueTime ?? '',
    reminderAt: '',
    estimatedMinutes: draft.estimatedMinutes ?? undefined,
    preferredStartTime: draft.preferredStartTime ?? '',
    preferredEndTime: draft.preferredEndTime ?? '',
  }
}

function draftToHabitForm(draft: TypedTaskDraft): HabitFormValues {
  return {
    title: draft.title ?? '',
    cadenceType: draft.cadenceType ?? 'daily',
    cadenceDays: draft.cadenceDays ?? [],
    targetCount: draft.targetCount ?? 1,
    preferredStartTime: draft.preferredStartTime ?? '',
    preferredEndTime: draft.preferredEndTime ?? '',
    reminderAt: '',
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function GlobalCaptureHost({ children }: { children?: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const ctx = routeContext(pathname)
  const routeIntent = getRouteIntent(pathname)
  const currentIdeaThreadTarget = getIdeaThreadTarget(pathname)

  // Resolve effective candidate type (auto defers to 'task' by default, override on review)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('closed')
  const [captureType, setCaptureType] = useState<CandidateType>('task')
  const [captureRawInput, setCaptureRawInput] = useState('')
  const [captureDraft, setCaptureDraft] = useState<TypedTaskDraft | null>(null)
  const [captureNotes, setCaptureNotes] = useState<string[]>([])

  // Auto-save success result
  const [captureAutoSaved, setCaptureAutoSaved] = useState<ProcessVoiceCaptureAutoSaved | null>(null)
  const [captureTaskStatus, setCaptureTaskStatus] = useState<ProcessVoiceCaptureTaskStatus | null>(null)
  const [captureTaskActionConfirmation, setCaptureTaskActionConfirmation] =
    useState<ProcessVoiceCaptureTaskActionConfirmation | null>(null)
  const [captureCalendarEventConfirmation, setCaptureCalendarEventConfirmation] =
    useState<ProcessVoiceCaptureCalendarEventConfirmation | null>(null)

  // Track which mode to return to when pressing Back from review
  const [captureReviewBackMode, setCaptureReviewBackMode] = useState<CaptureMode>('input')

  // Task review form
  const [taskForm, setTaskForm] = useState<TaskFormValues>(EMPTY_TASK_FORM)
  const [taskFieldErrors, setTaskFieldErrors] = useState<Partial<Record<keyof TaskFormValues, string>>>({})

  // Habit review form
  const [habitForm, setHabitForm] = useState<HabitFormValues>(EMPTY_HABIT_FORM)
  const [habitFieldErrors, setHabitFieldErrors] = useState<Partial<Record<keyof HabitFormValues, string>>>({})
  const [ideaForm, setIdeaForm] = useState<IdeaFormValues>(EMPTY_IDEA_FORM)
  const [ideaFieldErrors, setIdeaFieldErrors] = useState<Partial<Record<keyof IdeaFormValues, string>>>({})

  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureClarifyMessage, setCaptureClarifyMessage] = useState<string | null>(null)
  const [captureClarifyQuestions, setCaptureClarifyQuestions] = useState<string[]>([])
  const [captureClarifyReply, setCaptureClarifyReply] = useState('')
  const [captureStreamingAssistantText, setCaptureStreamingAssistantText] = useState('')
  const [captureClarifyTaskActionContext, setCaptureClarifyTaskActionContext] =
    useState<ProcessVoiceCaptureClarify['taskActionContext'] | null>(null)
  const [captureClarifyCalendarEvent, setCaptureClarifyCalendarEvent] =
    useState<ProcessVoiceCaptureCalendarEvent | null>(null)
  const [captureTaskEditSessionId, setCaptureTaskEditSessionId] = useState<string | null>(null)
  const [captureCalendarEventSessionId, setCaptureCalendarEventSessionId] = useState<string | null>(null)
  const [captureShowAdvanced, setCaptureShowAdvanced] = useState(false)
  const [captureThreadIdeaId, setCaptureThreadIdeaId] = useState<string | null>(null)
  const [captureContextIdeaId, setCaptureContextIdeaId] = useState<string | null>(null)
  const [captureContextTaskId, setCaptureContextTaskId] = useState<string | null>(null)
  const [captureVisibleTaskWindow, setCaptureVisibleTaskWindow] = useState<VisibleTaskSummaryItem[] | null>(null)
  const [registeredVisibleTaskWindow, setRegisteredVisibleTaskWindow] = useState<VisibleTaskSummaryItem[] | null>(null)
  const [isOpeningIdea, setIsOpeningIdea] = useState(false)
  const [threadReplySucceeded, setThreadReplySucceeded] = useState(false)

  // Voice
  const [isRecording, setIsRecording] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Audio level visualizer — 32 bar heights (0–1 each)
  const BAR_COUNT = 32
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(BAR_COUNT).fill(0))
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  // Sheet panel ref for focus-trap
  const sheetRef = useRef<HTMLDivElement | null>(null)

  // Refs for imperative teardown (no useEffect needed)
  const escapeHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskEditStreamSessionRef = useRef(createAssistantSessionStreamState())

  const stopVisualizer = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    setAudioLevels(Array(BAR_COUNT).fill(0))
  }, [])

  function applyVoiceProcessResult(
    result:
      | ProcessVoiceCaptureAutoSaved
      | ProcessVoiceCaptureClarify
      | ProcessVoiceCaptureTaskStatus
      | ProcessVoiceCaptureTaskActionConfirmation
      | ProcessVoiceCaptureCalendarEventConfirmation
      | { ok: true; outcome: 'idea_confirmation'; transcript: string; draft: TypedTaskDraft }
      | { ok: true; outcome: 'review'; transcript: string; draft: TypedTaskDraft },
  ) {
    if (result.outcome === 'auto_saved') {
      setCaptureAutoSaved(result)
      setCaptureClarifyTaskActionContext(null)
      setCaptureMode('success')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['habits'] })
      void queryClient.invalidateQueries({ queryKey: ['habit-completions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      autoDismissTimerRef.current = setTimeout(() => resetCapture(), 4000)
      return
    }

    if (result.outcome === 'clarify') {
      applyClarifyState(result)
      return
    }

    if (result.outcome === 'task_status') {
      applyTaskStatusState(result)
      return
    }

    if (result.outcome === 'task_action_confirmation') {
      applyTaskActionConfirmationState(result)
      return
    }

    if (result.outcome === 'calendar_event_confirmation') {
      applyCalendarEventConfirmationState(result)
      return
    }

    if (result.outcome === 'idea_confirmation') {
      applyDraftForReview(result.draft, result.transcript, 'recording')
      return
    }

    applyDraftForReview(result.draft, result.transcript, 'recording')
  }

  function buildClarifyFollowUpTranscript(reply: string) {
    const normalizedReply = reply.trim()

    if (captureTaskEditSessionId || captureCalendarEventSessionId) {
      return normalizedReply
    }

    return `${captureRawInput}\n\n${normalizedReply}`
  }

  async function submitAssistantSessionFollowUpAndStream(input: {
    transcript: string
    source: 'text' | 'voice'
    transcriptLanguage: 'es' | 'en' | 'unknown'
  }) {
    const sessionId = captureTaskEditSessionId ?? captureCalendarEventSessionId

    if (!sessionId) {
      return processVoiceCaptureTranscript({
        data: {
          transcript: input.transcript,
          language: input.transcriptLanguage,
          currentDate: getTodayDateString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          routeIntent,
          contextTaskId: captureClarifyTaskActionContext?.task.id ?? captureContextTaskId ?? undefined,
          contextIdeaId: captureContextIdeaId ?? undefined,
          visibleTaskWindow:
            captureVisibleTaskWindow && captureVisibleTaskWindow.length > 0 && !captureClarifyTaskActionContext?.task.id
              ? captureVisibleTaskWindow
              : undefined,
          followUpTaskAction: captureClarifyTaskActionContext?.action ?? undefined,
          taskEditSessionId: captureTaskEditSessionId ?? undefined,
          calendarEventSessionId: captureCalendarEventSessionId ?? undefined,
        },
      })
    }

    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()

    const acceptedTurn = await submitAssistantSessionTurn({
      data: {
        sessionId,
        message: input.transcript,
        source: input.source,
        transcriptLanguage: input.transcriptLanguage,
      },
    })

    const response = await streamAssistantSession({
      data: {
        sessionId,
        lastEventId: taskEditStreamSessionRef.current.lastStreamEventId,
      },
    })

    await applyAssistantSessionStreamResponse({
      response,
      sessionState: taskEditStreamSessionRef.current,
      onSessionState: (nextState) => {
        taskEditStreamSessionRef.current = nextState
      },
      onStreamingAssistantText: setCaptureStreamingAssistantText,
      onSessionSnapshot: () => {},
      shouldStop: (event) => (
        (event.type === 'turn_completed' || event.type === 'turn_failed')
        && event.turnId === acceptedTurn.turnId
      ),
    })

    const settledSession = taskEditStreamSessionRef.current.latestSession

    if (!settledSession) {
      throw new Error('Assistant session did not settle')
    }

    const workflow = settledSession.workflow

    const latestQuestion = settledSession.visibleEvents
      .filter((event) => event.type === 'assistant_question')
      .at(-1)?.summary
    const latestSynthesis = settledSession.visibleEvents
      .filter((event) => event.type === 'assistant_synthesis')
      .at(-1)?.summary

    if (workflow?.kind === 'task_edit' && captureClarifyTaskActionContext?.task && workflow.phase === 'ready_to_confirm') {
      return {
        ok: true as const,
        outcome: 'task_action_confirmation' as const,
        transcript: input.transcript,
        language: input.transcriptLanguage,
        message: latestQuestion ?? '',
        action: 'edit_task' as const,
        task: captureClarifyTaskActionContext.task,
        edits: workflow.changes,
        taskEditSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    if (workflow?.kind === 'task_edit' && captureClarifyTaskActionContext?.task && workflow.phase === 'collecting') {
      return {
        ok: true as const,
        outcome: 'clarify' as const,
        transcript: input.transcript,
        language: input.transcriptLanguage,
        message: latestQuestion ?? 'What should I change?',
        questions: [],
        draft: null,
        taskActionContext: {
          action: 'edit_task' as const,
          task: captureClarifyTaskActionContext.task,
        },
        taskEditSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    if (workflow?.kind === 'task_edit' && captureClarifyTaskActionContext?.task && workflow.phase === 'completed' && workflow.result?.applyPayload) {
      return {
        ok: true as const,
        outcome: 'task_action_confirmation' as const,
        transcript: input.transcript,
        language: input.transcriptLanguage,
        message: latestSynthesis ?? latestQuestion ?? '',
        action: 'edit_task' as const,
        task: captureClarifyTaskActionContext.task,
        edits: workflow.result.applyPayload.edits,
        taskEditSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    if (workflow?.kind === 'calendar_event' && workflow.operation === 'create') {
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

      if (workflow.phase === 'ready_to_confirm' || (workflow.phase === 'completed' && workflow.result?.applyPayload)) {
        return {
          ok: true as const,
          outcome: 'calendar_event_confirmation' as const,
          transcript: input.transcript,
          language: input.transcriptLanguage,
          message: latestQuestion ?? latestSynthesis ?? 'Confirm this calendar event.',
          calendarEvent,
          calendarEventSession: {
            sessionId: settledSession.sessionId,
          },
        }
      }

      return {
        ok: true as const,
        outcome: 'clarify' as const,
        transcript: input.transcript,
        language: input.transcriptLanguage,
        message: latestQuestion ?? 'What calendar event details should I use?',
        questions: [],
        draft: null,
        calendarEvent,
        calendarEventSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    if (captureCalendarEventSessionId) {
      return {
        ok: true as const,
        outcome: 'clarify' as const,
        transcript: input.transcript,
        language: input.transcriptLanguage,
        message: latestSynthesis ?? latestQuestion ?? 'I need a little more detail before I can create that event.',
        questions: latestQuestion ? [] : ['What calendar event details should I use?'],
        draft: null,
        calendarEventSession: {
          sessionId: settledSession.sessionId,
        },
      }
    }

    return {
      ok: true as const,
      outcome: 'clarify' as const,
      transcript: input.transcript,
      language: input.transcriptLanguage,
      message: latestSynthesis ?? 'I did not apply any task changes.',
      questions: [latestQuestion ?? 'Do you want to try a different task edit?'],
      draft: null,
      taskActionContext: {
        action: 'edit_task' as const,
        task: captureClarifyTaskActionContext.task,
      },
      taskEditSession: {
        sessionId: settledSession.sessionId,
      },
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopVisualizer() }
  }, [stopVisualizer])

  function startVisualizer(stream: MediaStream) {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.7
    ctx.createMediaStreamSource(stream).connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser

    const data = new Uint8Array(analyser.frequencyBinCount)
    function tick() {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(data)
      const step = Math.floor(data.length / BAR_COUNT)
      const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
        const raw = data[i * step] / 255
        // Add a small baseline so bars are always slightly visible
        return Math.max(raw, 0.06 + Math.random() * 0.04)
      })
      setAudioLevels(levels)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const interpretMutation = useMutation({
    mutationFn: async (rawInput: string) => {
      const currentDate = getTodayDateString()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return interpretCaptureInput({ data: { rawInput, currentDate, timezone, routeIntent } })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setCaptureError(result.message)
        return
      }
      applyDraftForReview(result.draft, result.draft.rawInput)
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Interpretation failed.')
    },
  })

  const confirmTaskMutation = useMutation({
    mutationFn: async () => {
      const parsed = taskFormSchema.parse(taskForm)
      const rawInput = captureDraft?.rawInput ?? captureRawInput
      return confirmCapturedTaskFn({
        data: {
          rawInput,
          matchedCalendarContext: captureDraft?.matchedCalendarContext ?? null,
          task: parsed,
        },
      })
    },
    onSuccess: async () => {
      resetCapture()
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Failed to save task.')
    },
  })

  const confirmHabitMutation = useMutation({
    mutationFn: async () => {
      const parsed = habitFormSchema.parse(habitForm)
      const rawInput = captureDraft?.rawInput ?? captureRawInput
      return confirmCapturedHabitFn({
        data: {
          rawInput,
          matchedCalendarContext: captureDraft?.matchedCalendarContext ?? null,
          habit: parsed,
        },
      })
    },
    onSuccess: async () => {
      resetCapture()
      await queryClient.invalidateQueries({ queryKey: ['habits'] })
      await queryClient.invalidateQueries({ queryKey: ['habit-completions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Failed to save habit.')
    },
  })

  const confirmIdeaMutation = useMutation({
    mutationFn: async (immediateInput?: {
      title: string
      body?: string
      rawInput: string
      sourceType: 'typed_capture' | 'voice_capture'
      sourceInput: string
    }) => {
      if (immediateInput) {
        return confirmCapturedIdeaFn({
          data: immediateInput,
        })
      }

      const parsed = ideaFormSchema.parse(ideaForm)
      const rawInput = captureDraft?.rawInput ?? captureRawInput

      return confirmCapturedIdeaFn({
        data: {
          title: parsed.title,
          body: parsed.body,
          rawInput,
          sourceType: captureReviewBackMode === 'recording' ? 'voice_capture' : 'typed_capture',
          sourceInput: rawInput,
        },
      })
    },
    onSuccess: async (createdIdea) => {
      setIsOpeningIdea(false)
      resetCapture()
      await queryClient.invalidateQueries({ queryKey: ['ideas'] })
      await navigate({
        to: '/ideas/$ideaId',
        params: { ideaId: createdIdea.id },
      })
    },
    onError: (error) => {
      setIsOpeningIdea(false)
      setCaptureError(error instanceof Error ? error.message : 'Failed to save idea.')
    },
  })

  const confirmVoiceTaskActionMutation = useMutation({
    mutationFn: async () => {
      if (!captureTaskActionConfirmation) {
        throw new Error('Task action confirmation is missing.')
      }

      return confirmVoiceTaskActionFn({
        data: {
          taskId: captureTaskActionConfirmation.task.id,
          action: captureTaskActionConfirmation.action,
          edits: captureTaskActionConfirmation.edits,
        },
      })
    },
    onSuccess: async () => {
      resetCapture()
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Failed to update task.')
    },
  })

  const confirmVoiceCalendarEventCreateMutation = useMutation({
    mutationFn: async () => {
      if (!captureCalendarEventConfirmation) {
        throw new Error('Calendar event confirmation is missing.')
      }

      const { calendarEvent, calendarEventSession } = captureCalendarEventConfirmation

      if (calendarEvent.operation === 'edit_calendar_event' || calendarEvent.operation === 'cancel_calendar_event') {
        if (!calendarEventSession) {
          throw new Error('Calendar event session is missing.')
        }

        return confirmVoiceCalendarEventActionFn({
          data: {
            calendarEvent,
            calendarEventSession,
          },
        })
      }

      return confirmVoiceCalendarEventCreateFn({
        data: {
          draft: calendarEvent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
    },
    onSuccess: async () => {
      resetCapture()
      await queryClient.invalidateQueries({ queryKey: ['calendar-view'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar-day'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar-settings'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Failed to create calendar event.')
    },
  })

  const submitThreadTurnMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!captureThreadIdeaId) {
        throw new Error('Thread target missing.')
      }

      return submitIdeaThreadTurn({
        data: {
          id: captureThreadIdeaId,
          message,
        },
      })
    },
    onSuccess: async () => {
      const ideaId = captureThreadIdeaId
      if (ideaId) {
        await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
      }
      setThreadReplySucceeded(true)
      setCaptureMode('success')
      autoDismissTimerRef.current = setTimeout(() => resetCapture(), 2500)
    },
    onError: (error) => {
      setCaptureError(error instanceof Error ? error.message : 'Failed to send thread reply.')
    },
  })

  const voiceThreadReplyMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      if (!captureThreadIdeaId) {
        throw new Error('Thread target missing.')
      }

      const audioFile = new File([audioBlob], 'thread-reply.webm', { type: audioBlob.type || 'audio/webm' })
      const formData = new FormData()
      formData.set('audio', audioFile, audioFile.name)
      formData.set('languageHint', 'auto')
      formData.set('source', 'pending-app')

      const transcription = await transcribeCaptureAudio({ data: formData })

      if (!transcription.ok) {
        throw new Error(transcription.message)
      }

      setCaptureMode('interpreting')

      await submitIdeaThreadTurn({
        data: {
          id: captureThreadIdeaId,
          message: transcription.transcript,
        },
      })

      return {
        ideaId: captureThreadIdeaId,
      }
    },
    onSuccess: async ({ ideaId }) => {
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
      setThreadReplySucceeded(true)
      setCaptureMode('success')
      autoDismissTimerRef.current = setTimeout(() => resetCapture(), 2500)
    },
    onError: (error) => {
      setTranscribeError(error instanceof Error ? error.message : 'Failed to add voice reply to the thread.')
    },
  })

  const voiceTranscriptFollowUpMutation = useMutation({
    mutationFn: async (transcript: string) => {
      if (captureTaskEditSessionId && captureClarifyTaskActionContext?.action === 'edit_task') {
        return submitAssistantSessionFollowUpAndStream({
          transcript,
          source: 'text',
          transcriptLanguage: 'unknown',
        })
      }

      if (captureCalendarEventSessionId) {
        return processVoiceCaptureTranscript({
          data: {
            transcript,
            language: 'unknown',
            currentDate: getTodayDateString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            routeIntent,
            calendarEventSessionId: captureCalendarEventSessionId,
          },
        })
      }

      return processVoiceCaptureTranscript({
        data: {
          transcript,
          language: 'unknown',
          currentDate: getTodayDateString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          routeIntent,
          contextTaskId: captureClarifyTaskActionContext?.task.id ?? captureContextTaskId ?? undefined,
          contextIdeaId: captureContextIdeaId ?? undefined,
          visibleTaskWindow:
            captureVisibleTaskWindow && captureVisibleTaskWindow.length > 0 && !captureClarifyTaskActionContext?.task.id
              ? captureVisibleTaskWindow
              : undefined,
          followUpTaskAction: captureClarifyTaskActionContext?.action ?? undefined,
          taskEditSessionId: captureTaskEditSessionId ?? undefined,
          calendarEventSessionId: captureCalendarEventSessionId ?? undefined,
        },
      })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setTranscribeError(result.message)
        return
      }

      applyVoiceProcessResult(result)
      setTranscribeError(null)
    },
    onError: (error) => {
      setTranscribeError(error instanceof Error ? error.message : 'Follow-up failed.')
    },
  })

  const voiceTaskEditFollowUpMutation = useMutation({
    mutationFn: async (input: {
      transcript: string
      transcriptLanguage: 'es' | 'en' | 'unknown'
    }) => submitAssistantSessionFollowUpAndStream({
      transcript: input.transcript,
      source: 'voice',
      transcriptLanguage: input.transcriptLanguage,
    }),
    onSuccess: (result) => {
      if (!result.ok) {
        setTranscribeError(result.message)
        return
      }

      applyVoiceProcessResult(result)
      setTranscribeError(null)
    },
    onError: (error) => {
      setTranscribeError(error instanceof Error ? error.message : 'Follow-up failed.')
    },
  })

  const voiceProcessMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const audioFile = new File([audioBlob], 'recording.webm', { type: audioBlob.type || 'audio/webm' })
      const formData = new FormData()
      formData.set('audio', audioFile, audioFile.name)
      formData.set('languageHint', 'auto')
      formData.set('source', 'pending-app')
      formData.set('currentDate', getTodayDateString())
      formData.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
      formData.set('routeIntent', routeIntent)
      if (captureContextTaskId) {
        formData.set('contextTaskId', captureContextTaskId)
      }
      if (captureContextIdeaId) {
        formData.set('contextIdeaId', captureContextIdeaId)
      }
      if (captureVisibleTaskWindow && captureVisibleTaskWindow.length > 0 && !captureContextTaskId) {
        formData.set('visibleTaskWindow', JSON.stringify(captureVisibleTaskWindow))
      }
      if (captureTaskEditSessionId) {
        formData.set('taskEditSessionId', captureTaskEditSessionId)
      }
      if (captureCalendarEventSessionId) {
        formData.set('calendarEventSessionId', captureCalendarEventSessionId)
      }
      return processVoiceCapture({ data: formData })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setTranscribeError(result.message)
        return
      }

      applyVoiceProcessResult(result)
      setTranscribeError(null)
    },
    onError: (error) => {
      setTranscribeError(error instanceof Error ? error.message : 'Transcription failed.')
    },
  })

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------
  async function startRecording(threadIdeaId: string | null = captureThreadIdeaId, options?: { asFollowUp?: boolean }) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        stopVisualizer()
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (threadIdeaId) {
          voiceThreadReplyMutation.mutate(blob)
          return
        }

        if (options?.asFollowUp) {
          const audioFile = new File([blob], 'clarify-reply.webm', { type: blob.type || 'audio/webm' })
          const formData = new FormData()
          formData.set('audio', audioFile, audioFile.name)
          formData.set('languageHint', 'auto')
          formData.set('source', 'pending-app')

          transcribeCaptureAudio({ data: formData })
            .then((transcription) => {
              if (!transcription.ok) {
                throw new Error(transcription.message)
              }

              if (captureTaskEditSessionId && captureClarifyTaskActionContext?.action === 'edit_task') {
                setCaptureMode('clarify')
                voiceTaskEditFollowUpMutation.mutate({
                  transcript: transcription.transcript,
                  transcriptLanguage: transcription.language,
                })
                return
              }

              if (captureClarifyTaskActionContext || captureClarifyCalendarEvent || captureCalendarEventSessionId) {
                setCaptureMode('clarify')
                voiceTranscriptFollowUpMutation.mutate(buildClarifyFollowUpTranscript(transcription.transcript))
                return
              }

              setCaptureMode('interpreting')

              voiceTranscriptFollowUpMutation.mutate(transcription.transcript)
            })
            .catch((error) => {
              setTranscribeError(error instanceof Error ? error.message : 'Transcription failed.')
              setCaptureMode('clarify')
            })
          return
        }

        voiceProcessMutation.mutate(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setTranscribeError(null)
      startVisualizer(stream)
    } catch {
      setTranscribeError('Microphone access denied.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setCaptureMode('transcribing')
    }
  }

  /** Stop recorder without processing audio — used when switching to typed input */
  function cancelRecording() {
    if (mediaRecorderRef.current && isRecording) {
      // Remove the onstop handler before stopping so the audio is discarded
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      stopVisualizer()
    }
  }

  function resetCapture() {
    if (mediaRecorderRef.current && isRecording) {
      // Discard audio by removing the onstop handler before stopping
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
    stopVisualizer()

    // Tear down the Escape listener registered by openCapture / openCaptureWithText
    if (escapeHandlerRef.current) {
      window.removeEventListener('keydown', escapeHandlerRef.current)
      escapeHandlerRef.current = null
    }

    // Cancel any pending auto-dismiss timer
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }

    setCaptureMode('closed')
    setCaptureRawInput('')
    setCaptureDraft(null)
    setCaptureAutoSaved(null)
    setCaptureTaskStatus(null)
    setCaptureTaskActionConfirmation(null)
    setCaptureCalendarEventConfirmation(null)
    setCaptureReviewBackMode('input')
    setTaskForm(EMPTY_TASK_FORM)
    setTaskFieldErrors({})
    setHabitForm(EMPTY_HABIT_FORM)
    setHabitFieldErrors({})
    setIdeaForm(EMPTY_IDEA_FORM)
    setIdeaFieldErrors({})
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureClarifyReply('')
    setCaptureClarifyTaskActionContext(null)
    setCaptureClarifyCalendarEvent(null)
    setCaptureTaskEditSessionId(null)
    setCaptureCalendarEventSessionId(null)
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureNotes([])
    setCaptureShowAdvanced(false)
    setCaptureThreadIdeaId(null)
    setCaptureContextIdeaId(null)
    setCaptureContextTaskId(null)
    setCaptureVisibleTaskWindow(null)
    setIsOpeningIdea(false)
    setTranscribeError(null)
    setThreadReplySucceeded(false)
  }

  function registerEscapeHandler() {
    if (escapeHandlerRef.current) return // already registered
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') resetCapture()
    }
    escapeHandlerRef.current = onKeyDown
    window.addEventListener('keydown', onKeyDown)
  }

  function openCapture(options?: CaptureOpenOptions) {
    const { captureThreadIdeaId: nextThreadIdeaId, captureContextIdeaId: nextContextIdeaId } = resolveCaptureOpenTargets(currentIdeaThreadTarget, options)
    const hasVisibleTaskWindow = options ? Object.prototype.hasOwnProperty.call(options, 'visibleTaskWindow') : false
    const visibleTaskWindow = hasVisibleTaskWindow ? options?.visibleTaskWindow ?? null : registeredVisibleTaskWindow
    setCaptureThreadIdeaId(nextThreadIdeaId)
    setCaptureContextIdeaId(nextContextIdeaId)
    setCaptureContextTaskId(options?.contextTaskId ?? null)
    setCaptureVisibleTaskWindow(visibleTaskWindow)
    const resolved: CandidateType = ctx.defaultType === 'auto' ? 'task' : ctx.defaultType
    setCaptureType(resolved)
    setCaptureMode('recording')
    registerEscapeHandler()
    // Auto-start recording when the sheet opens — no extra tap required
    void startRecording(nextThreadIdeaId)
  }

  function openCaptureWithText(text: string, options?: CaptureOpenOptions) {
    const { captureThreadIdeaId: nextThreadIdeaId, captureContextIdeaId: nextContextIdeaId } = resolveCaptureOpenTargets(currentIdeaThreadTarget, options)
    const hasVisibleTaskWindow = options ? Object.prototype.hasOwnProperty.call(options, 'visibleTaskWindow') : false
    const visibleTaskWindow = hasVisibleTaskWindow ? options?.visibleTaskWindow ?? null : registeredVisibleTaskWindow
    setCaptureThreadIdeaId(nextThreadIdeaId)
    setCaptureContextIdeaId(nextContextIdeaId)
    setCaptureContextTaskId(options?.contextTaskId ?? null)
    setCaptureVisibleTaskWindow(visibleTaskWindow)
    const resolved: CandidateType = ctx.defaultType === 'auto' ? 'task' : ctx.defaultType
    setCaptureType(resolved)
    setCaptureRawInput(text)
    setCaptureMode('input')
    registerEscapeHandler()
  }

  const registerVisibleTaskWindow = useCallback((visibleTaskWindow: VisibleTaskSummaryItem[] | null) => {
    setRegisteredVisibleTaskWindow(visibleTaskWindow)
  }, [])

  const clearVisibleTaskWindow = useCallback(() => {
    setRegisteredVisibleTaskWindow(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Task form handlers
  // ---------------------------------------------------------------------------
  function handleTaskChange<K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) {
    setTaskFieldErrors((c) => (c[key] ? { ...c, [key]: undefined } : c))
    setTaskForm((c) => ({ ...c, [key]: value }))
  }

  // ---------------------------------------------------------------------------
  // Habit form handlers
  // ---------------------------------------------------------------------------
  function handleHabitChange<K extends keyof HabitFormValues>(key: K, value: HabitFormValues[K]) {
    setHabitFieldErrors((c) => (c[key] ? { ...c, [key]: undefined } : c))
    setHabitForm((c) => ({ ...c, [key]: value }))
  }

  function handleIdeaChange<K extends keyof IdeaFormValues>(key: K, value: IdeaFormValues[K]) {
    setIdeaFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
    setIdeaForm((current) => ({ ...current, [key]: value }))
  }

  function toggleWeekday(day: HabitWeekday) {
    setHabitForm((c) => {
      const days = c.cadenceDays ?? []
      return {
        ...c,
        cadenceDays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Submit handlers
  // ---------------------------------------------------------------------------
  function handleInterpret(event: React.FormEvent) {
    event.preventDefault()
    if (!captureRawInput.trim()) return
    setCaptureError(null)

    if (captureThreadIdeaId) {
      submitThreadTurnMutation.mutate(captureRawInput.trim())
      return
    }

    interpretMutation.mutate(captureRawInput)
  }

  function createIdeaImmediately(
    draft: TypedTaskDraft,
    rawInput: string,
    sourceType: 'typed_capture' | 'voice_capture',
  ) {
    setCaptureRawInput(rawInput)
    setCaptureDraft(draft)
    setCaptureNotes(draft.interpretationNotes)
    setCaptureReviewBackMode(sourceType === 'voice_capture' ? 'recording' : 'input')
    setCaptureType('idea')
    setIdeaFieldErrors({})
    setIdeaForm({
      title: draft.title ?? rawInput,
      body: draft.notes ?? rawInput,
      sourceType: 'manual',
      sourceInput: rawInput,
    })
    setCaptureShowAdvanced(false)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureError(null)
    setIsOpeningIdea(true)
    setCaptureMode('input')
    confirmIdeaMutation.mutate({
      title: draft.title ?? rawInput,
      body: draft.notes ?? rawInput,
      rawInput,
      sourceType,
      sourceInput: rawInput,
    })
  }

  function handleConfirm(event: React.FormEvent) {
    event.preventDefault()
    setCaptureError(null)
    if (captureMode === 'task_action_confirmation') {
      confirmVoiceTaskActionMutation.mutate()
      return
    }

    if (captureMode === 'calendar_event_confirmation') {
      confirmVoiceCalendarEventCreateMutation.mutate()
      return
    }

    if (captureType === 'idea') {
      confirmIdeaMutation.mutate()
    } else if (captureType === 'habit') {
      confirmHabitMutation.mutate()
    } else {
      confirmTaskMutation.mutate()
    }
  }

  // ---------------------------------------------------------------------------
  // Voice capture helper transitions
  // ---------------------------------------------------------------------------
  function applyClarifyState(result: ProcessVoiceCaptureClarify) {
    setCaptureRawInput(result.transcript)
    setCaptureDraft(result.draft)
    setCaptureNotes(result.draft?.interpretationNotes ?? [])
    setCaptureClarifyMessage(result.message)
    setCaptureClarifyQuestions(result.questions)
    setCaptureClarifyReply('')
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureClarifyTaskActionContext(result.taskActionContext ?? null)
    setCaptureClarifyCalendarEvent(result.calendarEvent ?? null)
    setCaptureTaskEditSessionId(result.taskEditSession?.sessionId ?? null)
    setCaptureCalendarEventSessionId(result.calendarEventSession?.sessionId ?? null)
    if (result.taskActionContext?.task.id) {
      setCaptureContextTaskId(result.taskActionContext.task.id)
    }
    setCaptureError(null)
    setCaptureTaskStatus(null)
    setCaptureTaskActionConfirmation(null)
    setCaptureCalendarEventConfirmation(null)
    setCaptureMode('clarify')
  }

  function applyTaskStatusState(result: ProcessVoiceCaptureTaskStatus) {
    setCaptureRawInput(result.transcript)
    setCaptureDraft(null)
    setCaptureNotes([])
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureClarifyTaskActionContext(null)
    setCaptureClarifyCalendarEvent(null)
    setCaptureCalendarEventSessionId(null)
    setCaptureTaskActionConfirmation(null)
    setCaptureCalendarEventConfirmation(null)
    setCaptureTaskStatus(result)
    setCaptureMode('task_status')
  }

  function applyTaskActionConfirmationState(result: ProcessVoiceCaptureTaskActionConfirmation) {
    setCaptureRawInput(result.transcript)
    setCaptureDraft(null)
    setCaptureNotes([])
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureClarifyTaskActionContext(null)
    setCaptureClarifyCalendarEvent(null)
    setCaptureTaskEditSessionId(result.taskEditSession?.sessionId ?? null)
    setCaptureCalendarEventSessionId(result.calendarEventSession?.sessionId ?? null)
    setCaptureTaskStatus(null)
    setCaptureTaskActionConfirmation(result)
    setCaptureCalendarEventConfirmation(null)
    setCaptureMode('task_action_confirmation')
  }

  function applyCalendarEventConfirmationState(result: ProcessVoiceCaptureCalendarEventConfirmation) {
    setCaptureRawInput(result.transcript)
    setCaptureDraft(null)
    setCaptureNotes([])
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureClarifyReply('')
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureClarifyTaskActionContext(null)
    setCaptureClarifyCalendarEvent(null)
    setCaptureTaskEditSessionId(null)
    setCaptureCalendarEventSessionId(result.calendarEventSession.sessionId)
    setCaptureTaskStatus(null)
    setCaptureTaskActionConfirmation(null)
    setCaptureCalendarEventConfirmation(result)
    setCaptureMode('calendar_event_confirmation')
  }

  function handleClarifyReplySubmit(event: React.FormEvent) {
    event.preventDefault()
    const reply = captureClarifyReply.trim()
    if (!reply) return
    setCaptureError(null)

    if (captureClarifyTaskActionContext || captureClarifyCalendarEvent || captureCalendarEventSessionId) {
      voiceTranscriptFollowUpMutation.mutate(buildClarifyFollowUpTranscript(reply))
      return
    }

    interpretMutation.mutate(buildClarifyFollowUpTranscript(reply))
  }

  function applyDraftForReview(draft: TypedTaskDraft, rawInput: string, backTo: CaptureMode = 'input') {
    setCaptureRawInput(rawInput)
    setCaptureDraft(draft)
    setCaptureNotes(draft.interpretationNotes)
    setCaptureReviewBackMode(backTo)

    const resolvedType: CandidateType =
      ctx.defaultType === 'auto'
        ? draft.candidateType ?? 'task'
        : (ctx.defaultType as CandidateType)

    setCaptureType(resolvedType)

    if (resolvedType === 'habit') {
      setHabitForm(draftToHabitForm(draft))
      setHabitFieldErrors({})
    } else if (shouldAutoCreateIdeaCapture({ resolvedType, isThreadReplyCapture: captureThreadIdeaId !== null })) {
      createIdeaImmediately(draft, rawInput, backTo === 'recording' ? 'voice_capture' : 'typed_capture')
      return
    } else {
      setTaskForm(draftToTaskForm(draft))
      setTaskFieldErrors({})
    }

    const hasAdvanced = !!(draft.dueTime || draft.estimatedMinutes || draft.preferredStartTime)
    setCaptureShowAdvanced(hasAdvanced)
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureStreamingAssistantText('')
    taskEditStreamSessionRef.current = createAssistantSessionStreamState()
    setCaptureClarifyCalendarEvent(null)
    setCaptureTaskStatus(null)
    setCaptureTaskActionConfirmation(null)
    setCaptureCalendarEventConfirmation(null)
    setCaptureMode('review')
  }

  const isOpen = captureMode !== 'closed'
  const isConfirming =
    confirmTaskMutation.isPending ||
    confirmHabitMutation.isPending ||
    confirmIdeaMutation.isPending ||
    confirmVoiceTaskActionMutation.isPending ||
    confirmVoiceCalendarEventCreateMutation.isPending
  const isSubmittingTaskEditFollowUp = voiceTranscriptFollowUpMutation.isPending || voiceTaskEditFollowUpMutation.isPending
  const isVoiceStep = captureMode === 'recording' || captureMode === 'transcribing' || captureMode === 'interpreting'
  const isThreadReplyCapture = captureThreadIdeaId !== null
  const isSubmittingThreadReply = submitThreadTurnMutation.isPending || voiceThreadReplyMutation.isPending

  // Sheet title
  const sheetTitle =
    captureMode === 'recording' || captureMode === 'transcribing' || captureMode === 'interpreting'
      ? isThreadReplyCapture
        ? 'Voice reply'
        : 'Voice capture'
      : captureMode === 'success'
        ? threadReplySucceeded
          ? 'Reply sent'
          : captureAutoSaved?.candidateType === 'habit'
            ? 'Habit saved'
            : captureAutoSaved?.candidateType === 'idea'
              ? 'Idea saved'
              : 'Task saved'
        : captureMode === 'review'
          ? captureType === 'habit'
            ? 'Review habit'
            : captureType === 'idea'
              ? 'Start idea thread'
              : 'Review task'
          : captureMode === 'task_action_confirmation'
            ? captureTaskActionConfirmation?.action === 'reopen_task'
              ? 'Confirm task reopen'
              : captureTaskActionConfirmation?.action === 'edit_task'
                ? 'Confirm task edits'
                : 'Confirm task completion'
            : captureMode === 'calendar_event_confirmation'
              ? 'Confirm calendar event'
              : captureMode === 'task_status'
                ? 'Task status'
                : captureMode === 'clarify'
                  ? captureClarifyTaskActionContext?.action === 'edit_task'
                    ? 'Edit task'
                    : captureClarifyCalendarEvent || captureCalendarEventSessionId
                      ? 'Create calendar event'
                    : 'Need a bit more detail'
                  : isThreadReplyCapture
                    ? 'Reply to idea'
                    : isOpeningIdea
                      ? 'Opening your idea'
                      : 'What do you need?'

  // Confirm button label
  const confirmLabel = isConfirming
    ? 'Saving…'
    : captureMode === 'task_action_confirmation'
      ? captureTaskActionConfirmation?.action === 'reopen_task'
        ? 'Reopen task'
        : captureTaskActionConfirmation?.action === 'archive_task'
          ? 'Archive task'
          : captureTaskActionConfirmation?.action === 'edit_task'
            ? 'Apply edits'
            : 'Complete task'
    : captureMode === 'calendar_event_confirmation'
      ? captureCalendarEventConfirmation?.calendarEvent.operation === 'cancel_calendar_event'
        ? 'Cancel event'
        : captureCalendarEventConfirmation?.calendarEvent.operation === 'edit_calendar_event'
          ? 'Apply changes'
          : 'Create event'
    : captureType === 'idea'
      ? 'Create thread'
      : captureType === 'habit'
      ? 'Create habit'
      : 'Create task'

  const taskActionSummaryLabel = (action: ConfirmVoiceTaskActionKind) =>
    action === 'reopen_task'
      ? 'Reopen this task'
      : action === 'archive_task'
        ? 'Archive this task'
        : action === 'edit_task'
          ? 'Apply these edits'
          : 'Complete this task'

  // ---------------------------------------------------------------------------
  // Waveform bar renderer — live amplitude bars during recording
  // ---------------------------------------------------------------------------
  function WaveformBars({ levels }: { levels: number[] }) {
    return (
      <div className="flex items-center justify-center gap-[3px]" style={{ height: 56 }}>
        {levels.map((level, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="rounded-full transition-none"
            style={{
              width: 3,
              height: Math.max(8, Math.round(level * 52)),
              background: `linear-gradient(180deg, var(--brand), var(--accent))`,
              opacity: Math.max(0.35, level),
            }}
          />
        ))}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <CaptureContext.Provider value={{ openCapture, openCaptureWithText, registerVisibleTaskWindow, clearVisibleTaskWindow }}>
      {/* Backdrop */}
      <div
        onClick={resetCapture}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle}
        className={`fixed inset-x-0 bottom-0 z-50 duration-300 lg:inset-0 lg:flex lg:items-center lg:justify-center ${
          isOpen
            ? 'translate-y-0 opacity-100 transition-[transform,opacity] lg:pointer-events-auto'
            : 'translate-y-full opacity-0 transition-[transform,opacity] lg:translate-y-0 lg:pointer-events-none'
        }`}
      >
        <div className="mx-auto w-full max-w-2xl lg:px-4">
          <div
            ref={sheetRef}
            className={`panel w-full ${isVoiceStep ? 'rounded-t-[2rem] pb-0 pt-0 lg:rounded-[2rem]' : 'rounded-t-[2rem] px-6 pb-10 pt-3 lg:rounded-[2rem]'}`}
            style={{ paddingBottom: isVoiceStep ? undefined : 'max(2.5rem, env(safe-area-inset-bottom))' }}
          >

            {/* ── Voice step UI (recording / transcribing / interpreting) ── */}
            {isVoiceStep ? (
              <div className="flex flex-col" style={{ height: '52vh', minHeight: 320, maxHeight: 480 }}>
                {/* Top bar: drag handle + dismiss */}
                <div className="flex items-center justify-between px-6 pt-3 pb-0 shrink-0">
                  <div className="h-1 w-10 rounded-full bg-[var(--line)] lg:hidden" />
                  <div className="hidden lg:block" />
                  <button
                    type="button"
                    onClick={resetCapture}
                    aria-label="Close"
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink-strong)]"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Center content */}
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
                  {/* Waveform area */}
                  {captureMode === 'recording' ? (
                    <WaveformBars levels={audioLevels} />
                  ) : (
                    /* Idle/processing bars — CSS animated */
                    <div className="flex items-center justify-center gap-[3px]" style={{ height: 56 }}>
                      {Array.from({ length: BAR_COUNT }, (_, i) => (
                        <span
                          key={i}
                          aria-hidden="true"
                          className="rounded-full bar-idle"
                          style={{ width: 3, animationDelay: `${i * 55}ms` }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Status label */}
                  <div className="flex flex-col items-center gap-1">
                    <p className="m-0 text-base font-semibold text-[var(--ink-strong)]">
                      {captureMode === 'recording'
                        ? isRecording
                          ? isThreadReplyCapture ? 'Listening to your reply…' : 'Listening…'
                          : 'Starting…'
                        : captureMode === 'interpreting'
                          ? isThreadReplyCapture ? 'Adding reply to thread…' : 'Interpreting…'
                          : isThreadReplyCapture ? 'Transcribing your reply…' : 'Transcribing…'}
                    </p>
                    {captureMode === 'recording' && isRecording ? (
                      <p className="m-0 text-xs text-[var(--ink-soft)]">Tap the button to stop</p>
                    ) : null}
                  </div>

                  {/* Error */}
                  {transcribeError ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="m-0 text-center text-sm font-medium text-red-500">{transcribeError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setTranscribeError(null)
                          setCaptureMode('recording')
                          void startRecording(captureThreadIdeaId)
                        }}
                        className="cursor-pointer text-sm font-semibold text-[var(--brand)] transition hover:underline"
                      >
                        {isThreadReplyCapture ? 'Retry voice reply' : 'Try again'}
                      </button>
                      {isThreadReplyCapture ? (
                        <button
                          type="button"
                          onClick={() => { setTranscribeError(null); setCaptureMode('input') }}
                          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                        >
                          Type reply instead
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Bottom controls */}
                <div className="flex flex-col items-center gap-4 pb-8 pt-2 shrink-0">
                  {/* Mic stop button */}
                  {captureMode === 'recording' ? (
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                      className="group relative flex size-[88px] cursor-pointer items-center justify-center rounded-full focus:outline-none active:scale-95"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      {/* Ripple rings */}
                      {isRecording ? (
                        <>
                          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[var(--brand)] opacity-20" style={{ animation: 'mic-ripple 1.8s ease-out infinite' }} />
                          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[var(--brand)] opacity-15" style={{ animation: 'mic-ripple 1.8s ease-out infinite 0.5s' }} />
                          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[var(--brand)] opacity-10" style={{ animation: 'mic-ripple 1.8s ease-out infinite 1s' }} />
                        </>
                      ) : null}
                      {/* Center circle */}
                      <span className="relative flex size-[72px] items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--accent)] text-white shadow-[0_8px_24px_rgba(37,99,235,0.4)] transition-transform group-active:scale-95">
                        {isRecording ? <Square size={26} fill="white" strokeWidth={0} /> : <Mic size={26} />}
                      </span>
                    </button>
                  ) : (
                    /* Processing — non-interactive pulsing mic */
                    <div className="flex size-[72px] items-center justify-center rounded-full bg-[var(--brand)]/10">
                      <Mic size={26} className="animate-pulse text-[var(--brand)]" />
                    </div>
                  )}

                  {/* Type instead link */}
                  {captureMode === 'recording' ? (
                    <button
                      type="button"
                      onClick={() => { cancelRecording(); setCaptureMode('input') }}
                      className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                    >
                      {isThreadReplyCapture ? 'Type a reply instead' : 'Type instead'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              /* ── All other steps — standard header + scrollable content ── */
              <>
                {/* Drag handle */}
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)] lg:hidden" />

                {/* Header */}
                <div className="mb-5 flex items-center justify-between gap-4">
                  <h2 className="m-0 text-xl font-semibold text-[var(--ink-strong)]">{sheetTitle}</h2>
                  <button
                    type="button"
                    onClick={resetCapture}
                    aria-label="Close"
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink-strong)]"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="max-h-[70vh] overflow-y-auto overscroll-contain" style={{ scrollbarWidth: 'none' }}>
                  {isOpeningIdea ? (
                    <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-5">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-full bg-[var(--brand)]/10">
                          <Lightbulb size={18} className="text-[var(--brand)]" />
                        </div>
                        <div>
                          <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">Opening your idea...</p>
                          <p className="m-0 mt-1 text-sm text-[var(--ink-soft)]">
                            Creating the idea shell and loading the discovery thread.
                          </p>
                        </div>
                      </div>

                      {captureRawInput ? (
                        <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                            Captured input
                          </span>
                          <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{captureRawInput}</p>
                        </div>
                      ) : null}

                      {captureError ? (
                        <p className="m-0 text-sm font-medium text-red-500">{captureError}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── Input step ── */}
                  {captureMode === 'input' && !isOpeningIdea ? (
                    <form className="space-y-4" onSubmit={handleInterpret}>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                          {isThreadReplyCapture
                            ? 'Reply to this idea'
                            : ctx.defaultType === 'habit'
                            ? 'Describe a habit'
                            : ctx.defaultType === 'task'
                              ? 'What do you need to do?'
                              : ctx.defaultType === 'idea'
                                ? 'Describe the idea'
                                : 'What are you capturing?'}
                        </span>
                        <textarea
                          autoFocus
                          value={captureRawInput}
                          onChange={(e) => setCaptureRawInput(e.target.value)}
                          rows={4}
                          placeholder={
                            isThreadReplyCapture
                              ? 'Answer the latest assistant question or add more context to this idea.'
                              : ctx.defaultType === 'habit'
                              ? 'Exercise every morning, meditate for 10 min'
                              : ctx.defaultType === 'idea'
                                ? 'An idea for improving onboarding, a product direction to explore, a creative concept'
                                : 'Call the bank tomorrow morning, high priority, or I have an idea for a better onboarding flow'
                          }
                          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                        />
                      </label>

                      {captureError ? (
                        <p className="m-0 text-sm font-medium text-red-500">{captureError}</p>
                      ) : null}

                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={(interpretMutation.isPending || isSubmittingThreadReply) || !captureRawInput.trim()}
                          className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isThreadReplyCapture
                            ? isSubmittingThreadReply ? 'Sending…' : 'Send reply'
                            : interpretMutation.isPending ? 'Interpreting…' : 'Interpret'}
                        </button>
                        <button
                          type="button"
                          onClick={resetCapture}
                          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {/* ── Review step ── */}
                  {captureMode === 'review' && !isOpeningIdea ? (
                    <form className="space-y-4" onSubmit={handleConfirm}>
                      {/* Type switcher — only on auto routes where both types are allowed */}
                      {ctx.allowed.length > 1 ? (
                        <div className="flex gap-2">
                          {ctx.allowed.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setCaptureType(t)
                                if (t === 'habit' && captureDraft) setHabitForm(draftToHabitForm(captureDraft))
                                if (t === 'task' && captureDraft) setTaskForm(draftToTaskForm(captureDraft))
                                if (t === 'idea' && captureDraft) {
                                  setIdeaForm({
                                    title: captureDraft.title ?? captureDraft.rawInput,
                                    body: captureDraft.notes ?? captureDraft.rawInput,
                                    sourceType: 'manual',
                                    sourceInput: captureDraft.rawInput,
                                  })
                                }
                              }}
                              className={
                                captureType === t
                                  ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                                  : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                              }
                            >
                              {t === 'task' ? 'Task' : t === 'habit' ? 'Habit' : 'Idea'}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {/* Original input */}
                      <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                          Original input
                        </span>
                        <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{captureDraft?.rawInput}</p>
                      </div>

                      {captureDraft?.matchedCalendarContext ? (
                        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                          <div className="mb-2 flex items-center gap-2">
                            <CalendarDays size={15} className="text-[var(--ink-soft)]" />
                            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                              Linked calendar context
                            </span>
                          </div>
                          <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">
                            {captureDraft.matchedCalendarContext.summary}
                          </p>
                          <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                            {captureDraft.matchedCalendarContext.reason}
                          </p>
                        </div>
                      ) : null}

                      {/* Interpretation notes */}
                      {captureNotes.length > 0 ? (
                        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                            Notes
                          </span>
                          <ul className="m-0 space-y-1 pl-4">
                            {captureNotes.map((note, i) => (
                              <li key={i} className="text-xs leading-5 text-[var(--ink-soft)]">{note}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {/* ── Task review fields ── */}
                      {captureType === 'task' ? (
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Title</span>
                            <input
                              autoFocus
                              value={taskForm.title}
                              onChange={(e) => handleTaskChange('title', e.target.value)}
                              placeholder="Task title"
                              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                            />
                            {taskFieldErrors.title ? (
                              <span className="mt-2 block text-sm font-medium text-red-500">{taskFieldErrors.title}</span>
                            ) : null}
                          </label>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Due date</span>
                              <input
                                type="date"
                                value={taskForm.dueDate ?? ''}
                                onChange={(e) => handleTaskChange('dueDate', e.target.value)}
                                className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Priority</span>
                              <select
                                value={taskForm.priority}
                                onChange={(e) => handleTaskChange('priority', e.target.value as TaskFormValues['priority'])}
                                className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                            </label>
                          </div>

                          <button
                            type="button"
                            onClick={() => setCaptureShowAdvanced((v) => !v)}
                            className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                          >
                            <ChevronDown size={16} className={`transition-transform duration-200 ${captureShowAdvanced ? 'rotate-180' : ''}`} />
                            More options
                          </button>

                          {captureShowAdvanced ? (
                            <div className="space-y-4">
                              <label className="block">
                                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Notes</span>
                                <textarea
                                  value={taskForm.notes ?? ''}
                                  onChange={(e) => handleTaskChange('notes', e.target.value)}
                                  rows={3}
                                  placeholder="Add context or next steps"
                                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                />
                              </label>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                  <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Due time</span>
                                  <input
                                    type="time"
                                    value={taskForm.dueTime ?? ''}
                                    onChange={(e) => handleTaskChange('dueTime', e.target.value)}
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Est. min</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="1440"
                                    value={taskForm.estimatedMinutes ?? ''}
                                    onChange={(e) =>
                                      handleTaskChange('estimatedMinutes', e.target.value ? Number(e.target.value) : undefined)
                                    }
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                </label>
                              </div>
                              <div>
                                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Preferred window</span>
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="time"
                                    value={taskForm.preferredStartTime ?? ''}
                                    onChange={(e) => handleTaskChange('preferredStartTime', e.target.value)}
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                  <input
                                    type="time"
                                    value={taskForm.preferredEndTime ?? ''}
                                    onChange={(e) => handleTaskChange('preferredEndTime', e.target.value)}
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {/* ── Habit review fields ── */}
                      {captureType === 'habit' ? (
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Title</span>
                            <input
                              autoFocus
                              value={habitForm.title}
                              onChange={(e) => handleHabitChange('title', e.target.value)}
                              placeholder="Habit title"
                              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                            />
                            {habitFieldErrors.title ? (
                              <span className="mt-2 block text-sm font-medium text-red-500">{habitFieldErrors.title}</span>
                            ) : null}
                          </label>

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Cadence</span>
                            <div className="flex gap-2">
                              {(['daily', 'selected_days'] as const).map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => handleHabitChange('cadenceType', c)}
                                  className={
                                    habitForm.cadenceType === c
                                      ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                                      : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                                  }
                                >
                                  {c === 'daily' ? 'Daily' : 'Selected days'}
                                </button>
                              ))}
                            </div>

                            {habitForm.cadenceType === 'selected_days' ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {WEEKDAYS.map(({ value, label }) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => toggleWeekday(value)}
                                    className={
                                      habitForm.cadenceDays?.includes(value)
                                        ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1 !px-3 text-xs font-semibold'
                                        : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1 !px-3 text-xs font-semibold'
                                    }
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            {habitFieldErrors.cadenceDays ? (
                              <span className="mt-2 block text-sm font-medium text-red-500">{habitFieldErrors.cadenceDays}</span>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            onClick={() => setCaptureShowAdvanced((v) => !v)}
                            className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                          >
                            <ChevronDown size={16} className={`transition-transform duration-200 ${captureShowAdvanced ? 'rotate-180' : ''}`} />
                            More options
                          </button>

                          {captureShowAdvanced ? (
                            <div className="space-y-4">
                              <div>
                                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Preferred window</span>
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="time"
                                    value={habitForm.preferredStartTime ?? ''}
                                    onChange={(e) => handleHabitChange('preferredStartTime', e.target.value)}
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                  <input
                                    type="time"
                                    value={habitForm.preferredEndTime ?? ''}
                                    onChange={(e) => handleHabitChange('preferredEndTime', e.target.value)}
                                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                  />
                                </div>
                              </div>
                              <label className="block">
                                <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Target count / day</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="20"
                                  value={habitForm.targetCount ?? 1}
                                  onChange={(e) => handleHabitChange('targetCount', Number(e.target.value))}
                                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                />
                              </label>
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {captureType === 'idea' ? (
                        <>
                          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                              Discovery thread
                            </span>
                            <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">
                              Seed the idea with a provisional title and a little context, then continue developing it inside the dedicated discovery thread.
                            </p>
                          </div>

                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Title</span>
                            <input
                              autoFocus
                              value={ideaForm.title}
                              onChange={(e) => handleIdeaChange('title', e.target.value)}
                              placeholder="Give the idea a provisional title"
                              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                            />
                            {ideaFieldErrors.title ? (
                              <span className="mt-2 block text-sm font-medium text-red-500">{ideaFieldErrors.title}</span>
                            ) : null}
                          </label>

                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Notes</span>
                            <textarea
                              value={ideaForm.body ?? ''}
                              onChange={(e) => handleIdeaChange('body', e.target.value)}
                              rows={5}
                              placeholder="Capture the first shape of the idea, why it matters, or what should be explored first."
                              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                            />
                            {ideaFieldErrors.body ? (
                              <span className="mt-2 block text-sm font-medium text-red-500">{ideaFieldErrors.body}</span>
                            ) : null}
                          </label>

                          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                              Source input
                            </span>
                            <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{captureDraft?.rawInput ?? captureRawInput}</p>
                          </div>
                        </>
                      ) : null}

                      {captureError ? (
                        <p className="m-0 text-sm font-medium text-red-500">{captureError}</p>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          disabled={isConfirming}
                          className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {confirmLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCaptureMode(captureReviewBackMode)}
                          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={resetCapture}
                          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {captureMode === 'task_status' && captureTaskStatus ? (
                    <VoiceTaskStatusPanel
                      transcript={captureTaskStatus.transcript}
                      message={captureTaskStatus.message}
                      task={captureTaskStatus.task}
                      onDone={resetCapture}
                    />
                  ) : null}

                  {captureMode === 'task_action_confirmation' && captureTaskActionConfirmation ? (
                    <VoiceTaskActionConfirmationPanel
                      transcript={captureTaskActionConfirmation.transcript}
                      message={captureTaskActionConfirmation.message}
                      actionLabel={taskActionSummaryLabel(captureTaskActionConfirmation.action)}
                      confirmLabel={confirmLabel}
                      isConfirming={isConfirming}
                      error={captureError}
                      task={captureTaskActionConfirmation.task}
                      edits={captureTaskActionConfirmation.edits}
                      onConfirm={handleConfirm}
                      onCancel={resetCapture}
                    />
                  ) : null}

                  {captureMode === 'calendar_event_confirmation' && captureCalendarEventConfirmation ? (
                    <VoiceCalendarEventConfirmationPanel
                      transcript={captureCalendarEventConfirmation.transcript}
                      message={captureCalendarEventConfirmation.message}
                      confirmLabel={confirmLabel}
                      isConfirming={isConfirming}
                      error={captureError}
                      event={captureCalendarEventConfirmation.calendarEvent}
                      onConfirm={handleConfirm}
                      onCancel={resetCapture}
                    />
                  ) : null}

                  {captureMode === 'clarify' ? (
                    <>
                      {captureClarifyTaskActionContext ? (
                        <VoiceTaskClarifyPanel
                          transcript={captureRawInput}
                          message={captureClarifyMessage ?? ''}
                          questions={captureClarifyQuestions}
                          reply={captureClarifyReply}
                          isSubmitting={interpretMutation.isPending || isSubmittingTaskEditFollowUp}
                          isRecording={isRecording}
                          error={captureError ?? transcribeError}
                          streamingAssistantText={captureStreamingAssistantText}
                          taskAction={captureClarifyTaskActionContext?.action ?? null}
                          task={captureClarifyTaskActionContext?.task ?? null}
                          onReplyChange={setCaptureClarifyReply}
                          onSubmit={handleClarifyReplySubmit}
                          onStartVoiceReply={() => {
                            setTranscribeError(null)
                            setCaptureMode('recording')
                            void startRecording(null, { asFollowUp: true })
                          }}
                          onEditFromScratch={() => {
                            setCaptureClarifyReply('')
                            setCaptureClarifyTaskActionContext(null)
                            setCaptureClarifyCalendarEvent(null)
                            setCaptureTaskEditSessionId(null)
                            setCaptureCalendarEventSessionId(null)
                            setCaptureMode('input')
                          }}
                          onCancel={resetCapture}
                        />
                      ) : captureClarifyCalendarEvent || captureCalendarEventSessionId ? (
                        <VoiceCalendarClarifyPanel
                          transcript={captureRawInput}
                          message={captureClarifyMessage ?? ''}
                          questions={captureClarifyQuestions}
                          reply={captureClarifyReply}
                          isSubmitting={interpretMutation.isPending || isSubmittingTaskEditFollowUp}
                          isRecording={isRecording}
                          error={captureError ?? transcribeError}
                          streamingAssistantText={captureStreamingAssistantText}
                          calendarEvent={captureClarifyCalendarEvent}
                          onReplyChange={setCaptureClarifyReply}
                          onSubmit={handleClarifyReplySubmit}
                          onStartVoiceReply={() => {
                            setTranscribeError(null)
                            setCaptureMode('recording')
                            void startRecording(null, { asFollowUp: true })
                          }}
                          onEditFromScratch={() => {
                            setCaptureClarifyReply('')
                            setCaptureClarifyTaskActionContext(null)
                            setCaptureClarifyCalendarEvent(null)
                            setCaptureTaskEditSessionId(null)
                            setCaptureCalendarEventSessionId(null)
                            setCaptureMode('input')
                          }}
                          onCancel={resetCapture}
                        />
                      ) : (
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                              Transcript
                            </span>
                            <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{captureRawInput}</p>
                          </div>

                          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
                            <p className="m-0 text-sm font-medium text-amber-200">{captureClarifyMessage}</p>
                            {captureClarifyQuestions.length > 0 ? (
                              <ul className="m-0 mt-3 space-y-1 pl-4">
                                {captureClarifyQuestions.map((question, index) => (
                                  <li key={index} className="text-sm leading-6 text-amber-100">
                                    {question}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>

                          {captureDraft?.matchedCalendarContext ? (
                            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                              <div className="mb-2 flex items-center gap-2">
                                <CalendarDays size={15} className="text-[var(--ink-soft)]" />
                                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                                  Linked calendar context
                                </span>
                              </div>
                              <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">
                                {captureDraft.matchedCalendarContext.summary}
                              </p>
                              <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                                {captureDraft.matchedCalendarContext.reason}
                              </p>
                            </div>
                          ) : null}

                          <form onSubmit={handleClarifyReplySubmit} className="space-y-3">
                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">Your reply</span>
                              <textarea
                                autoFocus
                                value={captureClarifyReply}
                                onChange={(e) => setCaptureClarifyReply(e.target.value)}
                                rows={3}
                                placeholder="Answer the questions above…"
                                className="w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault()
                                    handleClarifyReplySubmit(e as unknown as React.FormEvent)
                                  }
                                }}
                              />
                            </label>

                            {captureError ? (
                              <p className="m-0 text-sm font-medium text-red-500">{captureError}</p>
                            ) : null}

                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="submit"
                                disabled={interpretMutation.isPending || !captureClarifyReply.trim()}
                                className="primary-pill inline-flex cursor-pointer items-center gap-1.5 border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <SendHorizonal size={14} />
                                {interpretMutation.isPending ? 'Interpreting…' : 'Send reply'}
                              </button>
                              {captureDraft ? (
                                <button
                                  type="button"
                                  onClick={() => applyDraftForReview(captureDraft, captureRawInput)}
                                  className="secondary-pill cursor-pointer border-0 text-sm font-semibold"
                                >
                                  Review draft anyway
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  setCaptureClarifyReply('')
                                  setCaptureRawInput(captureRawInput)
                                  setCaptureTaskEditSessionId(null)
                                  setCaptureClarifyCalendarEvent(null)
                                  setCaptureCalendarEventSessionId(null)
                                  setCaptureMode('input')
                                }}
                                className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                              >
                                <RotateCcw size={13} />
                                Edit from scratch
                              </button>
                              <button
                                type="button"
                                onClick={resetCapture}
                                className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </>
                  ) : null}

                  {captureMode === 'success' && threadReplySucceeded ? (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
                          <CheckCircle size={32} className="text-green-500" />
                        </div>
                        <p className="m-0 text-center text-base font-semibold text-[var(--ink-strong)]">
                          Reply added to thread
                        </p>
                        <p className="m-0 text-center text-sm text-[var(--ink-soft)]">
                          The thread is updating with your reply now.
                        </p>
                        {/* Auto-dismiss progress bar */}
                        <div className="h-1 w-32 overflow-hidden rounded-full bg-[var(--line)]">
                          <span
                            className="block h-full rounded-full bg-green-500"
                            style={{ animation: 'auto-dismiss-bar 2.5s linear forwards' }}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={resetCapture}
                          className="primary-pill cursor-pointer border-0 text-sm font-semibold"
                        >
                          Back to thread
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {captureMode === 'success' && captureAutoSaved ? (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
                          <CheckCircle size={32} className="text-green-500" />
                        </div>
                        <p className="m-0 text-center text-base font-semibold text-[var(--ink-strong)]">
                          {captureAutoSaved.candidateType === 'habit'
                            ? 'Habit saved'
                            : captureAutoSaved.candidateType === 'idea'
                              ? 'Idea saved'
                              : 'Task saved'}
                        </p>
                        <p className="m-0 text-center text-sm text-[var(--ink-soft)]">
                          {captureAutoSaved.title}
                        </p>
                        {/* Auto-dismiss progress bar */}
                        <div className="h-1 w-32 overflow-hidden rounded-full bg-[var(--line)]">
                          <span
                            className="block h-full rounded-full bg-green-500"
                            style={{ animation: 'auto-dismiss-bar 4s linear forwards' }}
                          />
                        </div>
                      </div>

                      <div className="rounded-2xl bg-[var(--surface-inset)] px-4 py-3">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                          Transcript
                        </span>
                        <p className="m-0 text-sm leading-6 text-[var(--ink-strong)]">{captureAutoSaved.transcript}</p>
                      </div>

                      {captureAutoSaved.matchedCalendarContext ? (
                        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3">
                          <div className="mb-2 flex items-center gap-2">
                            <CalendarDays size={15} className="text-[var(--ink-soft)]" />
                            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                              Linked calendar context
                            </span>
                          </div>
                          <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">
                            {captureAutoSaved.matchedCalendarContext.summary}
                          </p>
                          <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                            {captureAutoSaved.matchedCalendarContext.reason}
                          </p>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            void navigate({
                              to:
                                captureAutoSaved.candidateType === 'habit'
                                  ? '/habits'
                                  : captureAutoSaved.candidateType === 'idea'
                                    ? '/ideas/$ideaId'
                                    : '/tasks',
                              ...(captureAutoSaved.candidateType === 'idea'
                                ? { params: { ideaId: captureAutoSaved.createdId } }
                                : {}),
                            })
                            resetCapture()
                          }}
                          className="primary-pill cursor-pointer border-0 text-sm font-semibold"
                        >
                          View {captureAutoSaved.candidateType}
                        </button>
                        <button
                          type="button"
                          onClick={resetCapture}
                          className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {children}

      {/* Desktop FAB — hidden on mobile (bottom tab bar handles it there) */}
      {!isOpen && (
        <button
          type="button"
          onClick={openCapture}
          aria-label="Voice capture"
          className="fixed bottom-8 right-8 z-30 hidden size-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-emerald-500 shadow-[0_4px_24px_rgba(37,99,235,0.45)] transition hover:scale-105 active:scale-95 lg:flex"
        >
          <Mic size={24} className="text-white" />
        </button>
      )}
    </CaptureContext.Provider>
  )
}
