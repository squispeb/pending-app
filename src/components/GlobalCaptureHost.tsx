import { useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Mic, Square, X } from 'lucide-react'
import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
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
import type { CandidateType, TypedTaskDraft } from '../lib/capture'
import {
  confirmCapturedHabit as confirmCapturedHabitFn,
  confirmCapturedTask as confirmCapturedTaskFn,
  interpretCaptureInput,
} from '../server/capture'
import { transcribeCaptureAudio } from '../server/transcription'

// ---------------------------------------------------------------------------
// Route → context mapping
// ---------------------------------------------------------------------------
type RouteContext = {
  defaultType: CandidateType | 'auto'
  allowed: Array<CandidateType>
}

function routeContext(pathname: string): RouteContext {
  if (pathname === '/tasks') return { defaultType: 'task', allowed: ['task'] }
  if (pathname === '/habits') return { defaultType: 'habit', allowed: ['habit'] }
  if (pathname === '/') return { defaultType: 'auto', allowed: ['task', 'habit'] }
  return { defaultType: 'task', allowed: ['task'] }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type CaptureMode = 'closed' | 'recording' | 'input' | 'review'

const EMPTY_TASK_FORM = toTaskFormValues(null)
const EMPTY_HABIT_FORM = toHabitFormValues(null)

const WEEKDAYS: Array<{ value: HabitWeekday; label: string }> = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

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
    cadenceType: 'daily',
    cadenceDays: [],
    targetCount: 1,
    preferredStartTime: draft.preferredStartTime ?? '',
    preferredEndTime: draft.preferredEndTime ?? '',
    reminderAt: '',
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function GlobalCaptureHost() {
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const ctx = routeContext(pathname)

  // Resolve effective candidate type (auto defers to 'task' by default, override on review)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('closed')
  const [captureType, setCaptureType] = useState<CandidateType>('task')
  const [captureRawInput, setCaptureRawInput] = useState('')
  const [captureDraft, setCaptureDraft] = useState<TypedTaskDraft | null>(null)
  const [captureNotes, setCaptureNotes] = useState<string[]>([])

  // Task review form
  const [taskForm, setTaskForm] = useState<TaskFormValues>(EMPTY_TASK_FORM)
  const [taskFieldErrors, setTaskFieldErrors] = useState<Partial<Record<keyof TaskFormValues, string>>>({})

  // Habit review form
  const [habitForm, setHabitForm] = useState<HabitFormValues>(EMPTY_HABIT_FORM)
  const [habitFieldErrors, setHabitFieldErrors] = useState<Partial<Record<keyof HabitFormValues, string>>>({})

  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureShowAdvanced, setCaptureShowAdvanced] = useState(false)

  // Voice
  const [isRecording, setIsRecording] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const interpretMutation = useMutation({
    mutationFn: async (rawInput: string) => {
      const currentDate = getTodayDateString()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return interpretCaptureInput({ data: { rawInput, currentDate, timezone } })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setCaptureError(result.message)
        return
      }
      const draft = result.draft
      setCaptureDraft(draft)
      setCaptureNotes(draft.interpretationNotes)

      // Determine candidate type: auto → use what the LLM returned, else use ctx default
      const resolvedType: CandidateType =
        ctx.defaultType === 'auto'
          ? draft.candidateType ?? 'task'
          : (ctx.defaultType as CandidateType)

      setCaptureType(resolvedType)

      if (resolvedType === 'habit') {
        setHabitForm(draftToHabitForm(draft))
        setHabitFieldErrors({})
      } else {
        setTaskForm(draftToTaskForm(draft))
        setTaskFieldErrors({})
      }

      const hasAdvanced = !!(draft.dueTime || draft.estimatedMinutes || draft.preferredStartTime)
      setCaptureShowAdvanced(hasAdvanced)
      setCaptureError(null)
      setCaptureMode('review')
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

  const transcribeMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const audioFile = new File([audioBlob], 'recording.webm', { type: audioBlob.type || 'audio/webm' })
      const formData = new FormData()
      formData.set('audio', audioFile, audioFile.name)
      formData.set('languageHint', 'auto')
      formData.set('source', 'pending-app')
      return transcribeCaptureAudio({ data: formData })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setTranscribeError(result.message)
        return
      }
      setCaptureRawInput(result.transcript)
      setTranscribeError(null)
      setCaptureMode('input')
    },
    onError: (error) => {
      setTranscribeError(error instanceof Error ? error.message : 'Transcription failed.')
    },
  })

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((t) => t.stop())
        transcribeMutation.mutate(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setTranscribeError(null)
    } catch {
      setTranscribeError('Microphone access denied.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  function resetCapture() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
    setCaptureMode('closed')
    setCaptureRawInput('')
    setCaptureDraft(null)
    setTaskForm(EMPTY_TASK_FORM)
    setTaskFieldErrors({})
    setHabitForm(EMPTY_HABIT_FORM)
    setHabitFieldErrors({})
    setCaptureError(null)
    setCaptureNotes([])
    setCaptureShowAdvanced(false)
    setTranscribeError(null)
  }

  function openCapture() {
    const resolved: CandidateType = ctx.defaultType === 'auto' ? 'task' : ctx.defaultType
    setCaptureType(resolved)
    setCaptureMode('recording')
  }

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
    interpretMutation.mutate(captureRawInput)
  }

  function handleConfirm(event: React.FormEvent) {
    event.preventDefault()
    setCaptureError(null)
    if (captureType === 'habit') {
      confirmHabitMutation.mutate()
    } else {
      confirmTaskMutation.mutate()
    }
  }

  const isOpen = captureMode !== 'closed'
  const isConfirming = confirmTaskMutation.isPending || confirmHabitMutation.isPending

  // Sheet title
  const sheetTitle =
    captureMode === 'recording'
      ? 'Voice capture'
      : captureMode === 'review'
        ? captureType === 'habit'
          ? 'Review habit'
          : 'Review task'
        : 'What do you need?'

  // Confirm button label
  const confirmLabel = isConfirming
    ? 'Saving…'
    : captureType === 'habit'
      ? 'Create habit'
      : 'Create task'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Global mic FAB — bottom-left, avoids collision with page FABs (bottom-right) */}
      <button
        type="button"
        onClick={openCapture}
        aria-label="Voice capture"
        className="fixed bottom-6 left-6 z-30 flex size-14 cursor-pointer items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-lg transition hover:opacity-90 active:scale-95"
      >
        <Mic size={24} />
      </button>

      {/* Backdrop */}
      <div
        onClick={resetCapture}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      {/* Bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 duration-300 lg:inset-0 lg:flex lg:items-center lg:justify-center ${
          isOpen
            ? 'translate-y-0 opacity-100 transition-[transform,opacity] lg:pointer-events-auto'
            : 'translate-y-full opacity-0 transition-[transform,opacity] lg:translate-y-0 lg:pointer-events-none'
        }`}
      >
        <div className="mx-auto w-full max-w-2xl lg:px-4">
          <div className="panel rounded-t-[2rem] px-6 pb-10 pt-3 lg:rounded-[2rem]">
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

            <div className="max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {/* ── Recording step ── */}
              {captureMode === 'recording' ? (
                <div className="flex flex-col items-center gap-6 py-6">
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={transcribeMutation.isPending}
                    aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                    className={`flex size-20 cursor-pointer items-center justify-center rounded-full transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                      isRecording
                        ? 'animate-pulse bg-red-500 text-white shadow-lg'
                        : 'bg-[var(--brand)] text-white shadow-lg hover:opacity-90'
                    }`}
                  >
                    {isRecording ? <Square size={28} /> : <Mic size={28} />}
                  </button>

                  <p className="m-0 text-sm font-semibold text-[var(--ink-soft)]">
                    {transcribeMutation.isPending
                      ? 'Transcribing…'
                      : isRecording
                        ? 'Tap to stop'
                        : 'Tap to start recording'}
                  </p>

                  {transcribeError ? (
                    <p className="m-0 text-sm font-medium text-red-500">{transcribeError}</p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setCaptureMode('input')}
                    className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                  >
                    Type instead
                  </button>
                </div>
              ) : null}

              {/* ── Input step ── */}
              {captureMode === 'input' ? (
                <form className="space-y-4" onSubmit={handleInterpret}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--ink-strong)]">
                      {ctx.defaultType === 'habit'
                        ? 'Describe a habit'
                        : ctx.defaultType === 'task'
                          ? 'What do you need to do?'
                          : 'What do you need?'}
                    </span>
                    <textarea
                      autoFocus
                      value={captureRawInput}
                      onChange={(e) => setCaptureRawInput(e.target.value)}
                      rows={4}
                      placeholder={
                        ctx.defaultType === 'habit'
                          ? 'Exercise every morning, meditate for 10 min'
                          : 'Call the bank tomorrow morning, high priority'
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
                      disabled={interpretMutation.isPending || !captureRawInput.trim()}
                      className="primary-pill cursor-pointer border-0 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {interpretMutation.isPending ? 'Interpreting…' : 'Interpret'}
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
              {captureMode === 'review' ? (
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
                          }}
                          className={
                            captureType === t
                              ? 'primary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                              : 'secondary-pill inline-flex cursor-pointer items-center border-0 !py-1.5 !px-3.5 text-sm font-semibold'
                          }
                        >
                          {t === 'task' ? 'Task' : 'Habit'}
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
                      onClick={() => setCaptureMode('input')}
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
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
