import { useRef, useState, useEffect, useCallback } from 'react'
import { CalendarDays, CheckCircle, ChevronDown, Mic, RotateCcw, SendHorizonal, Square, X } from 'lucide-react'
import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { CaptureContext } from '../contexts/CaptureContext'
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
import type { CandidateType, ProcessVoiceCaptureAutoSaved, TypedTaskDraft } from '../lib/capture'
import {
  confirmCapturedHabit as confirmCapturedHabitFn,
  confirmCapturedTask as confirmCapturedTaskFn,
  interpretCaptureInput,
  processVoiceCapture,
} from '../server/capture'

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
type CaptureMode = 'closed' | 'recording' | 'transcribing' | 'interpreting' | 'input' | 'review' | 'clarify' | 'success'

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

  // Resolve effective candidate type (auto defers to 'task' by default, override on review)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('closed')
  const [captureType, setCaptureType] = useState<CandidateType>('task')
  const [captureRawInput, setCaptureRawInput] = useState('')
  const [captureDraft, setCaptureDraft] = useState<TypedTaskDraft | null>(null)
  const [captureNotes, setCaptureNotes] = useState<string[]>([])

  // Auto-save success result
  const [captureAutoSaved, setCaptureAutoSaved] = useState<ProcessVoiceCaptureAutoSaved | null>(null)

  // Track which mode to return to when pressing Back from review
  const [captureReviewBackMode, setCaptureReviewBackMode] = useState<CaptureMode>('input')

  // Task review form
  const [taskForm, setTaskForm] = useState<TaskFormValues>(EMPTY_TASK_FORM)
  const [taskFieldErrors, setTaskFieldErrors] = useState<Partial<Record<keyof TaskFormValues, string>>>({})

  // Habit review form
  const [habitForm, setHabitForm] = useState<HabitFormValues>(EMPTY_HABIT_FORM)
  const [habitFieldErrors, setHabitFieldErrors] = useState<Partial<Record<keyof HabitFormValues, string>>>({})

  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureClarifyMessage, setCaptureClarifyMessage] = useState<string | null>(null)
  const [captureClarifyQuestions, setCaptureClarifyQuestions] = useState<string[]>([])
  const [captureClarifyReply, setCaptureClarifyReply] = useState('')
  const [captureShowAdvanced, setCaptureShowAdvanced] = useState(false)

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
      return interpretCaptureInput({ data: { rawInput, currentDate, timezone } })
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

  const voiceProcessMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const audioFile = new File([audioBlob], 'recording.webm', { type: audioBlob.type || 'audio/webm' })
      const formData = new FormData()
      formData.set('audio', audioFile, audioFile.name)
      formData.set('languageHint', 'auto')
      formData.set('source', 'pending-app')
      formData.set('currentDate', getTodayDateString())
      formData.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
      return processVoiceCapture({ data: formData })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setTranscribeError(result.message)
        return
      }

      if (result.outcome === 'auto_saved') {
        setCaptureAutoSaved(result)
        setCaptureMode('success')
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        void queryClient.invalidateQueries({ queryKey: ['habits'] })
        void queryClient.invalidateQueries({ queryKey: ['habit-completions'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        // Auto-dismiss after 4 s — wired here in the event handler, not a useEffect
        autoDismissTimerRef.current = setTimeout(() => resetCapture(), 4000)
        return
      }

      if (result.outcome === 'clarify') {
        applyClarifyState(result.message, result.questions, result.transcript, result.draft)
        setTranscribeError(null)
        return
      }

      applyDraftForReview(result.draft, result.transcript, 'recording')
      setTranscribeError(null)
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
        stream.getTracks().forEach((t) => t.stop())
        stopVisualizer()
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
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
    setCaptureReviewBackMode('input')
    setTaskForm(EMPTY_TASK_FORM)
    setTaskFieldErrors({})
    setHabitForm(EMPTY_HABIT_FORM)
    setHabitFieldErrors({})
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureClarifyReply('')
    setCaptureNotes([])
    setCaptureShowAdvanced(false)
    setTranscribeError(null)
  }

  function registerEscapeHandler() {
    if (escapeHandlerRef.current) return // already registered
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') resetCapture()
    }
    escapeHandlerRef.current = onKeyDown
    window.addEventListener('keydown', onKeyDown)
  }

  function openCapture() {
    const resolved: CandidateType = ctx.defaultType === 'auto' ? 'task' : ctx.defaultType
    setCaptureType(resolved)
    setCaptureMode('recording')
    registerEscapeHandler()
    // Auto-start recording when the sheet opens — no extra tap required
    void startRecording()
  }

  function openCaptureWithText(text: string) {
    const resolved: CandidateType = ctx.defaultType === 'auto' ? 'task' : ctx.defaultType
    setCaptureType(resolved)
    setCaptureRawInput(text)
    setCaptureMode('input')
    registerEscapeHandler()
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

  // ---------------------------------------------------------------------------
  // Voice capture helper transitions
  // ---------------------------------------------------------------------------
  function applyClarifyState(
    message: string,
    questions: string[],
    transcript: string,
    draft: TypedTaskDraft | null,
  ) {
    setCaptureRawInput(transcript)
    setCaptureDraft(draft)
    setCaptureNotes(draft?.interpretationNotes ?? [])
    setCaptureClarifyMessage(message)
    setCaptureClarifyQuestions(questions)
    setCaptureClarifyReply('')
    setCaptureError(null)
    setCaptureMode('clarify')
  }

  function handleClarifyReplySubmit(event: React.FormEvent) {
    event.preventDefault()
    const reply = captureClarifyReply.trim()
    if (!reply) return
    // Combine original transcript + reply so the interpreter has full context
    const combined = `${captureRawInput}\n\n${reply}`
    setCaptureError(null)
    interpretMutation.mutate(combined)
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
    } else {
      setTaskForm(draftToTaskForm(draft))
      setTaskFieldErrors({})
    }

    const hasAdvanced = !!(draft.dueTime || draft.estimatedMinutes || draft.preferredStartTime)
    setCaptureShowAdvanced(hasAdvanced)
    setCaptureError(null)
    setCaptureClarifyMessage(null)
    setCaptureClarifyQuestions([])
    setCaptureMode('review')
  }

  const isOpen = captureMode !== 'closed'
  const isConfirming = confirmTaskMutation.isPending || confirmHabitMutation.isPending
  const isVoiceStep = captureMode === 'recording' || captureMode === 'transcribing' || captureMode === 'interpreting'

  // Sheet title
  const sheetTitle =
    captureMode === 'recording' || captureMode === 'transcribing' || captureMode === 'interpreting'
      ? 'Voice capture'
      : captureMode === 'success'
        ? captureAutoSaved?.candidateType === 'habit'
          ? 'Habit saved'
          : 'Task saved'
        : captureMode === 'review'
          ? captureType === 'habit'
            ? 'Review habit'
            : 'Review task'
          : captureMode === 'clarify'
            ? 'Need a bit more detail'
            : 'What do you need?'

  // Confirm button label
  const confirmLabel = isConfirming
    ? 'Saving…'
    : captureType === 'habit'
      ? 'Create habit'
      : 'Create task'

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
    <CaptureContext.Provider value={{ openCapture, openCaptureWithText }}>
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
                        ? isRecording ? 'Listening…' : 'Starting…'
                        : captureMode === 'interpreting'
                          ? 'Interpreting…'
                          : 'Transcribing…'}
                    </p>
                    {captureMode === 'recording' && isRecording ? (
                      <p className="m-0 text-xs text-[var(--ink-soft)]">Tap the button to stop</p>
                    ) : null}
                  </div>

                  {/* Error */}
                  {transcribeError ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="m-0 text-sm font-medium text-red-500">{transcribeError}</p>
                      <button
                        type="button"
                        onClick={() => { setTranscribeError(null); setCaptureMode('recording'); void startRecording() }}
                        className="cursor-pointer text-sm font-semibold text-[var(--brand)] transition hover:underline"
                      >
                        Try again
                      </button>
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
                      Type instead
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

                  {captureMode === 'clarify' ? (
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

                      {/* Inline reply input */}
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
                  ) : null}

                  {captureMode === 'success' && captureAutoSaved ? (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
                          <CheckCircle size={32} className="text-green-500" />
                        </div>
                        <p className="m-0 text-center text-base font-semibold text-[var(--ink-strong)]">
                          {captureAutoSaved.candidateType === 'habit' ? 'Habit saved' : 'Task saved'}
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
                            void navigate({ to: captureAutoSaved.candidateType === 'habit' ? '/habits' : '/tasks' })
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
          className="fixed bottom-8 right-8 z-30 hidden size-14 cursor-pointer items-center justify-center rounded-full shadow-[0_4px_24px_rgba(37,99,235,0.45)] transition hover:scale-105 active:scale-95 lg:flex"
          style={{ background: 'linear-gradient(135deg, #2563eb, #10b981)' }}
        >
          <Mic size={24} className="text-white" />
        </button>
      )}
    </CaptureContext.Provider>
  )
}
