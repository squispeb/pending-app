import { CheckCircle2, ClipboardList, CheckCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import {
  deriveThreadState,
  getThreadStructuredActionActivity,
  getThreadEventPresentation,
  type ThreadEventType,
  type ThreadLiveActivityPresentation,
  type ThreadStatus,
  type ThreadStructuredAction,
  type ThreadTurnPresentation,
} from '../lib/idea-thread-presentation'
import { formatDisplayDateTime } from '../lib/date-time'

type IdeaThreadVisibleEvent = {
  eventId: string
  type: ThreadEventType
  createdAt: string
  summary: string
} & Partial<{
  taskId: string
  stepOrder: number
  stepCount: number
  steps: string[]
  status: 'completed' | 'reopened'
}>

export type PendingBreakdownProposal = {
  proposalId: string
  action: 'breakdown'
  proposedSummary: string
  proposedSteps?: string[]
  explanation: string
}

export type PendingStructuredProposal = {
  proposalId: string
  action: ThreadStructuredAction
  proposedSummary: string
  proposedSteps?: string[]
  explanation: string
}

function getStructuredActionCardTitle(action: ThreadStructuredAction) {
  switch (action) {
    case 'restructure':
      return 'Restructure proposal'
    case 'breakdown':
      return 'Breakdown proposal'
    case 'convert-to-task':
      return 'Task conversion proposal'
  }
}

function getStructuredActionSuggestedLabel(action: ThreadStructuredAction) {
  switch (action) {
    case 'restructure':
      return 'Suggested framing'
    case 'breakdown':
      return 'Suggested steps'
    case 'convert-to-task':
      return 'Proposed task'
  }
}

function getStructuredActionAcceptLabel(action: ThreadStructuredAction, isAccepting: boolean) {
  if (isAccepting) {
    switch (action) {
      case 'restructure':
        return 'Applying…'
      case 'breakdown':
        return 'Accepting…'
      case 'convert-to-task':
        return 'Creating task…'
    }
  }

  switch (action) {
    case 'restructure':
      return 'Accept restructure'
    case 'breakdown':
      return 'Accept breakdown'
    case 'convert-to-task':
      return 'Accept - create task'
  }
}

function getStructuredActionRejectLabel(action: ThreadStructuredAction) {
  switch (action) {
    case 'restructure':
      return 'Reject restructure'
    case 'breakdown':
      return 'Reject breakdown'
    case 'convert-to-task':
      return 'Reject proposal'
  }
}

function getStructuredActionPendingLabel(action: ThreadStructuredAction) {
  switch (action) {
    case 'restructure':
      return 'Preparing restructure'
    case 'breakdown':
      return 'Preparing breakdown'
    case 'convert-to-task':
      return 'Preparing task proposal'
  }
}

function getStructuredActionPendingMessage(action: ThreadStructuredAction) {
  return getThreadStructuredActionActivity(action, 'working').helperText
}

export type AcceptedBreakdownStep = {
  id: string
  stepText: string
  /** ISO string or Date when the step was marked complete; null/undefined = incomplete. */
  completedAt?: string | Date | null
  completedSource?: 'manual' | 'linked-task' | null
}

export type AcceptedBreakdownStepArtifactSummary = {
  result?: string | null
  evidence?: string | null
}

export type AcceptedBreakdownLinkedTask = {
  taskId: string
  completedAt?: string | Date | null
}

type StepActionInFlight = {
  stepId: string
  action: 'create-task' | 'complete' | 'uncomplete'
}

/**
 * Plan card rendered in the thread once a breakdown proposal has been
 * accepted.  Visually distinct from the pending proposal card (cyan vs
 * violet). When callbacks are provided, incomplete steps can be marked
 * done or converted into tasks. Linked steps still show a "Task created"
 * chip, but they continue to participate in next-step progression until
 * they are explicitly completed.
 */
export function AcceptedBreakdownPlanCard({
  steps,
  onCreateTaskFromStep,
  onCompleteLinkedTask,
  onCompleteStep,
  onUncompleteStep,
  stepActionInFlight = null,
  linkedStepIds = [],
  artifactSummariesByStepId = {},
  linkedTasksByStepId = {},
}: {
  steps: AcceptedBreakdownStep[]
  onCreateTaskFromStep?: (stepId: string) => void
  onCompleteLinkedTask?: (stepId: string) => void
  onCompleteStep?: (stepId: string) => void
  onUncompleteStep?: (stepId: string) => void
  stepActionInFlight?: StepActionInFlight | null
  /** IDs of steps that already have a linked task. */
  linkedStepIds?: string[]
  artifactSummariesByStepId?: Record<string, AcceptedBreakdownStepArtifactSummary>
  linkedTasksByStepId?: Record<string, AcceptedBreakdownLinkedTask>
}) {
  const linkedSet = new Set(linkedStepIds)

  /**
   * First incomplete step, regardless of whether a task has already been
   * created from it. Creating a task should not remove the step from the
   * progression flow; only completion should do that.
   */
  const nextCandidateId = steps.find((step) => !step.completedAt)?.id ?? null

  return (
    <div
      role="region"
      aria-label="Accepted breakdown plan"
      className="mx-auto w-full max-w-[92%] rounded-[22px] border border-cyan-200 bg-cyan-50/60 px-3.5 py-3 shadow-sm dark:border-cyan-500/30 dark:bg-cyan-500/10 sm:max-w-[85%]"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <ClipboardList size={14} className="shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
          Accepted plan
        </span>
        <span className="ml-auto rounded-full border border-cyan-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/20 dark:text-cyan-300">
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
      </div>
      <ol className="m-0 list-none space-y-2 pl-0">
        {steps.map((step, index) => {
          const isCreating = stepActionInFlight?.stepId === step.id && stepActionInFlight.action === 'create-task'
          const isCompleting = stepActionInFlight?.stepId === step.id && stepActionInFlight.action === 'complete'
          const isUncompleting = stepActionInFlight?.stepId === step.id && stepActionInFlight.action === 'uncomplete'
          const isLinked = linkedSet.has(step.id)
          const isCompleted = Boolean(step.completedAt)
          const isNext = step.id === nextCandidateId
          const hasPendingAction = stepActionInFlight !== null
          const artifactSummary = artifactSummariesByStepId[step.id]
          const linkedTask = linkedTasksByStepId[step.id]

          return (
            <li
              key={step.id}
              aria-label={isCompleted ? `Step ${index + 1} completed` : isNext ? `Step ${index + 1} next recommended` : undefined}
              className={`flex items-start gap-2.5 ${isCompleted ? 'opacity-60' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isLinked
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                    : isCompleted
                      ? 'bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400'
                      : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300'
                }`}
              >
                {isLinked ? (
                  <CheckCheck size={11} aria-hidden="true" />
                ) : isCompleted ? (
                  <CheckCircle2 size={11} aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="flex flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={`text-sm leading-6 ${isCompleted ? 'text-[var(--ink-faint)] line-through' : 'text-[var(--ink-strong)]'}`}
                  >
                    {step.stepText}
                  </span>
                  {artifactSummary?.result ? (
                    <span className="rounded-2xl border border-emerald-200/80 bg-white/80 px-3 py-2 text-xs leading-5 text-[var(--ink-soft)] dark:border-emerald-500/30 dark:bg-emerald-500/10">
                      <span className="mr-1 font-semibold text-emerald-700 dark:text-emerald-300">Result:</span>
                      {artifactSummary.result}
                    </span>
                  ) : null}
                  {artifactSummary?.evidence ? (
                    <span className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs leading-5 text-[var(--ink-soft)]">
                      <span className="mr-1 font-semibold text-[var(--ink-strong)]">Evidence:</span>
                      {artifactSummary.evidence}
                    </span>
                  ) : null}
                </span>
                {/* Status chips and action buttons */}
                {isCompleted ? (
                  <>
                    <span
                      aria-label={`Step ${index + 1} done`}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-400"
                    >
                      Done
                    </span>
                    {onUncompleteStep && step.completedSource !== 'linked-task' ? (
                      <button
                        type="button"
                        disabled={hasPendingAction}
                        onClick={() => onUncompleteStep(step.id)}
                        aria-label={`Mark step ${index + 1} as not done`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-300 dark:hover:bg-slate-500/20"
                      >
                        {isUncompleting ? 'Undoing…' : 'Undo'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {isLinked ? (
                      <span
                        aria-label={`Step ${index + 1} task already created`}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      >
                        <CheckCircle2 size={11} aria-hidden="true" />
                        Task created
                      </span>
                    ) : null}
                    {isLinked && !isCompleted && onCompleteLinkedTask ? (
                      <button
                        type="button"
                        disabled={hasPendingAction}
                        onClick={() => onCompleteLinkedTask(step.id)}
                        aria-label={`Complete linked task for step ${index + 1}`}
                        className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                      >
                        Complete task
                      </button>
                    ) : null}
                    {isNext ? (
                      <span
                        aria-label={`Step ${index + 1} is the next recommended step`}
                        className="inline-flex items-center rounded-full border border-cyan-300 bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/20 dark:text-cyan-300"
                      >
                        Next
                      </span>
                    ) : null}
                    {onCompleteStep && !isLinked ? (
                      <button
                        type="button"
                        disabled={hasPendingAction}
                        onClick={() => onCompleteStep(step.id)}
                        aria-label={`Mark step ${index + 1} done`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-200 dark:hover:bg-slate-500/20"
                      >
                        {isCompleting ? 'Marking…' : 'Mark done'}
                      </button>
                    ) : null}
                    {!isLinked && onCreateTaskFromStep ? (
                      <button
                        type="button"
                        disabled={hasPendingAction}
                        onClick={() => onCreateTaskFromStep(step.id)}
                        aria-label={`Create task from step ${index + 1}`}
                        className="inline-flex items-center justify-center rounded-full border border-cyan-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20"
                      >
                        {isCreating ? 'Creating…' : 'Create task'}
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Inline breakdown proposal card rendered directly in the thread.
 * Reuses the same accept/reject callbacks as the Guided tab so mutations
 * are shared and the Guided tab stays intact as a secondary surface.
 */
export function BreakdownProposalCard({
  proposal,
  isAccepting,
  isRejecting,
  onAccept,
  onReject,
}: {
  proposal: PendingBreakdownProposal
  isAccepting: boolean
  isRejecting: boolean
  onAccept: (proposalId: string) => void
  onReject: (proposalId: string) => void
}) {
  const disabled = isAccepting || isRejecting

  return (
    <div
      role="region"
      aria-label="Pending breakdown proposal"
      className="mx-auto w-full max-w-[92%] rounded-[22px] border border-violet-200 bg-violet-50/70 px-3.5 py-3 shadow-sm dark:border-violet-500/30 dark:bg-violet-500/10 sm:max-w-[85%]"
    >
      {/* heading */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
          Breakdown proposal
        </span>
      </div>

      {/* proposed summary */}
      <div className="rounded-2xl border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">Suggested</div>
        {proposal.proposedSteps && proposal.proposedSteps.length > 0 ? (
          <ol className="m-0 mt-2 space-y-1.5 pl-5 text-sm leading-6 text-[var(--ink-strong)]">
            {proposal.proposedSteps.map((step, index) => (
              <li key={`${proposal.proposalId}-${index}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
            {proposal.proposedSummary}
          </p>
        )}
      </div>

      {/* explanation */}
      <div className="mt-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Why</div>
        <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
          {proposal.explanation}
        </p>
      </div>

      {/* actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAccept(proposal.proposalId)}
          className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isAccepting ? 'Accepting…' : 'Accept breakdown'}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReject(proposal.proposalId)}
          className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRejecting ? 'Rejecting…' : 'Reject breakdown'}
        </button>
      </div>
    </div>
  )
}

export function StructuredActionProposalCard({
  proposal,
  isAccepting,
  isRejecting,
  onAccept,
  onReject,
}: {
  proposal: PendingStructuredProposal
  isAccepting: boolean
  isRejecting: boolean
  onAccept: (proposalId: string) => void
  onReject: (proposalId: string) => void
}) {
  const disabled = isAccepting || isRejecting

  return (
    <div
      role="region"
      aria-label={getStructuredActionCardTitle(proposal.action)}
      className="mx-auto w-full max-w-[92%] rounded-[22px] border border-violet-200 bg-violet-50/70 px-3.5 py-3 shadow-sm dark:border-violet-500/30 dark:bg-violet-500/10 sm:max-w-[85%]"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
          {getStructuredActionCardTitle(proposal.action)}
        </span>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
          {getStructuredActionSuggestedLabel(proposal.action)}
        </div>
        {proposal.proposedSteps && proposal.proposedSteps.length > 0 ? (
          <ol className="m-0 mt-2 space-y-1.5 pl-5 text-sm leading-6 text-[var(--ink-strong)]">
            {proposal.proposedSteps.map((step, index) => (
              <li key={`${proposal.proposalId}-${index}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
            {proposal.proposedSummary}
          </p>
        )}
      </div>

      <div className="mt-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Why</div>
        <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
          {proposal.explanation}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAccept(proposal.proposalId)}
          className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {getStructuredActionAcceptLabel(proposal.action, isAccepting)}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReject(proposal.proposalId)}
          className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRejecting ? 'Rejecting…' : getStructuredActionRejectLabel(proposal.action)}
        </button>
      </div>
    </div>
  )
}

export function IdeaThreadHistory({
  visibleEvents,
  threadStatus = 'idle',
  activeTurn = null,
  queuedTurns = [],
  lastTurn = null,
  streamingAssistantText = '',
  optimisticActivity = null,
  acceptedBreakdownSteps = [],
  pendingBreakdownProposal = null,
  pendingStructuredProposal = null,
  activeStructuredAction = null,
  lastStructuredActionError = null,
  isAcceptingBreakdown = false,
  isRejectingBreakdown = false,
  isAcceptingStructuredProposal = false,
  isRejectingStructuredProposal = false,
  onAcceptBreakdown,
  onRejectBreakdown,
  onAcceptStructuredProposal,
  onRejectStructuredProposal,
  onCreateTaskFromStep,
  onCompleteLinkedTask,
  onCompleteStep,
  onUncompleteStep,
  stepActionInFlight = null,
  linkedStepIds = [],
  artifactSummariesByStepId = {},
  linkedTasksByStepId = {},
  className = '',
  threadRegionId,
  showHeader = true,
}: {
  visibleEvents: Array<IdeaThreadVisibleEvent>
  threadStatus?: ThreadStatus
  activeTurn?: ThreadTurnPresentation | null
  queuedTurns?: Array<ThreadTurnPresentation>
  lastTurn?: ThreadTurnPresentation | null
  streamingAssistantText?: string
  optimisticActivity?: ThreadLiveActivityPresentation | null
  /**
  * When accepted breakdown steps exist they are rendered as a plan card at
 * the bottom of the event list. When callbacks are provided, each step can
 * gain completion toggles and/or a per-step "Create task" button.
   */
  acceptedBreakdownSteps?: AcceptedBreakdownStep[]
  /**
   * When a pending breakdown proposal exists it is rendered inline at the
   * bottom of the event list so users can act on it without leaving the thread.
   */
  pendingBreakdownProposal?: PendingBreakdownProposal | null
  pendingStructuredProposal?: PendingStructuredProposal | null
  activeStructuredAction?: ThreadStructuredAction | null
  lastStructuredActionError?: { action: ThreadStructuredAction; message: string } | null
  isAcceptingBreakdown?: boolean
  isRejectingBreakdown?: boolean
  isAcceptingStructuredProposal?: boolean
  isRejectingStructuredProposal?: boolean
  onAcceptBreakdown?: (proposalId: string) => void
  onRejectBreakdown?: (proposalId: string) => void
  onAcceptStructuredProposal?: (proposalId: string) => void
  onRejectStructuredProposal?: (proposalId: string) => void
  /** Called when the user clicks "Create task" for a specific accepted step. */
  onCreateTaskFromStep?: (stepId: string) => void
  /** Called when the user completes a linked task for an accepted step. */
  onCompleteLinkedTask?: (stepId: string) => void
  /** Called when the user marks an accepted step as done. */
  onCompleteStep?: (stepId: string) => void
  /** Called when the user reopens a completed accepted step. */
  onUncompleteStep?: (stepId: string) => void
  /** Current in-flight step action, if any. */
  stepActionInFlight?: StepActionInFlight | null
  /** IDs of accepted breakdown steps that already have a linked task. */
  linkedStepIds?: string[]
  /** Latest result/evidence summaries for linked tasks by accepted step id. */
  artifactSummariesByStepId?: Record<string, AcceptedBreakdownStepArtifactSummary>
  /** Linked task metadata for accepted steps. */
  linkedTasksByStepId?: Record<string, AcceptedBreakdownLinkedTask>
  className?: string
  /** Optional id wired up to a tab's aria-controls for ARIA tab panel semantics */
  threadRegionId?: string
  /** Hide the internal thread shell header when a parent view already owns that context */
  showHeader?: boolean
}) {
  const threadState = deriveThreadState({
    status: threadStatus,
    visibleEvents,
    activeTurn,
    queuedTurns,
    optimisticActivity,
  })
  const showQueuePanel = Boolean(optimisticActivity)
    || threadStatus === 'queued'
    || threadStatus === 'processing'
    || threadStatus === 'streaming'
    || threadStatus === 'failed'

  return (
    <section
      id={threadRegionId}
      aria-label="Idea thread history"
      className={`panel rounded-t-[28px] rounded-b-none p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-5 ${className}`.trim()}
    >
      {showHeader ? (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Thread</div>
          {/* aria-live so status changes are announced to screen readers without moving focus */}
          <div
            aria-live="polite"
            aria-atomic="true"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${threadState.badgeClassName}`}
          >
            {threadState.label}
          </div>
        </div>
      ) : null}

      {showQueuePanel ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mb-2.5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
        >
          <p className="m-0 text-xs font-medium text-[var(--ink-strong)]">{threadState.helperText}</p>
          {activeTurn ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              Active turn: {activeTurn.userMessage}
            </p>
          ) : null}
          {queuedTurns.length > 0 ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              {queuedTurns.length === 1 ? '1 later reply is queued.' : `${queuedTurns.length} later replies are queued.`}
            </p>
          ) : null}
          {threadStatus === 'failed' && lastTurn ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              Last failed turn: {lastTurn.userMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* aria-live region wrapping the message list so new streamed content is announced */}
      <div aria-live="polite" aria-atomic="false" className="space-y-2.5 pb-8 sm:pb-10">
        {streamingAssistantText ? (
          <article aria-label="Assistant is replying" className="flex justify-start">
            <div className="max-w-[92%] rounded-[22px] border border-violet-200 bg-violet-50/70 px-3.5 py-3 shadow-sm dark:border-violet-500/30 dark:bg-violet-500/10 sm:max-w-[85%]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]" aria-hidden="true">
                <span className="text-violet-500">●</span>
                <span>Assistant replying</span>
              </div>
              <p className="m-0 mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
                {streamingAssistantText}
              </p>
            </div>
          </article>
        ) : null}

        {activeStructuredAction ? (
          <article aria-label={getStructuredActionPendingLabel(activeStructuredAction)} className="flex justify-start">
            <div className="max-w-[92%] rounded-[22px] border border-cyan-200 bg-cyan-50/80 px-3.5 py-3 shadow-sm dark:border-cyan-500/30 dark:bg-cyan-500/10 sm:max-w-[85%]">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300" aria-hidden="true">
                <span className="text-cyan-500">●</span>
                <span>{getStructuredActionPendingLabel(activeStructuredAction)}</span>
              </div>
              <p className="m-0 mt-1.5 text-sm leading-6 text-[var(--ink-strong)]">
                {getStructuredActionPendingMessage(activeStructuredAction)}
              </p>
            </div>
          </article>
        ) : null}

        {lastStructuredActionError ? (
          <article aria-label="Structured action failed" className="flex justify-start">
            <div className="max-w-[92%] rounded-[22px] border border-red-200 bg-red-50/80 px-3.5 py-3 shadow-sm dark:border-red-500/30 dark:bg-red-500/10 sm:max-w-[85%]">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300" aria-hidden="true">
                <span>Structured action failed</span>
              </div>
              <p className="m-0 mt-1.5 text-sm leading-6 text-[var(--ink-strong)]">
                {lastStructuredActionError.message}
              </p>
            </div>
          </article>
        ) : null}

        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            const presentation = getThreadEventPresentation(event.type)
            const Icon = presentation.icon
            const isUserTurn = event.type === 'user_turn_added'
            const isTaskCreated = event.type === 'task_created'
            const isProgressEvent = event.type === 'breakdown_plan_recorded' || event.type === 'step_status_changed'
            const isSystemEvent = event.type === 'thread_created' || event.type === 'stage_changed'

            return (
              <article key={event.eventId} className={isSystemEvent ? 'flex justify-center py-1' : `flex ${isUserTurn ? 'justify-end' : 'justify-start'}`}>
                {isTaskCreated ? (
                  <div className="max-w-[92%] rounded-[22px] border border-emerald-200 bg-emerald-50/80 px-3.5 py-3 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10 sm:max-w-[85%]">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" aria-hidden="true">
                      <CheckCircle2 size={14} className="text-emerald-500" aria-hidden="true" />
                      <span>Task created</span>
                    </div>
                    <p className="m-0 mt-1.5 text-sm leading-6 text-[var(--ink-strong)]">
                      {event.summary}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ink-faint)]">
                      <time dateTime={event.createdAt}>{formatDisplayDateTime(event.createdAt)}</time>
                      <Link to="/tasks" className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">
                        View in Tasks →
                      </Link>
                    </div>
                  </div>
                ) : isProgressEvent ? (
                  <div className={`max-w-[92%] rounded-[22px] border px-3.5 py-3 shadow-sm sm:max-w-[85%] ${presentation.cardClassName}`}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]" aria-hidden="true">
                      <Icon size={14} className={presentation.iconClassName} aria-hidden="true" />
                      <span>{presentation.label}</span>
                    </div>
                    <p className="m-0 mt-1.5 text-sm leading-6 text-[var(--ink-strong)]">
                      {event.summary}
                    </p>
                    {event.type === 'breakdown_plan_recorded' && event.steps && event.steps.length > 0 ? (
                      <ol className="m-0 mt-2 space-y-1.5 pl-5 text-sm leading-6 text-[var(--ink-strong)]">
                        {event.steps.map((step, index) => (
                          <li key={`${event.eventId}-${index}`}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-faint)]">
                      {event.type === 'breakdown_plan_recorded' && event.stepCount ? (
                        <span>{event.stepCount} {event.stepCount === 1 ? 'step' : 'steps'}</span>
                      ) : null}
                      {event.type === 'step_status_changed' && event.stepOrder ? (
                        <span>Step {event.stepOrder} {event.status === 'reopened' ? 'reopened' : 'completed'}</span>
                      ) : null}
                      <time dateTime={event.createdAt}>{formatDisplayDateTime(event.createdAt)}</time>
                    </div>
                  </div>
                ) : isSystemEvent ? (
                  <div className="inline-flex max-w-[90%] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--ink-soft)] sm:max-w-[85%]">
                    <Icon size={14} className={presentation.iconClassName} aria-hidden="true" />
                    <span className="font-medium text-[var(--ink-strong)]">{presentation.label}</span>
                    <span aria-hidden="true">•</span>
                    <span>{event.summary}</span>
                  </div>
                ) : (
                  <div className={`max-w-[92%] rounded-[22px] px-3.5 py-3 shadow-sm sm:max-w-[85%] ${isUserTurn ? 'bg-[var(--brand)] text-white' : `border ${presentation.cardClassName}`}`}>
                    <div className={`flex items-center gap-2 text-xs font-semibold ${isUserTurn ? 'text-white/80' : 'text-[var(--ink-soft)]'}`} aria-hidden="true">
                      {!isUserTurn ? <Icon size={14} className={presentation.iconClassName} aria-hidden="true" /> : null}
                      <span>{presentation.label}</span>
                    </div>
                    <p className={`m-0 mt-1.5 text-sm leading-6 ${isUserTurn ? 'whitespace-pre-wrap text-white' : 'text-[var(--ink-strong)]'}`}>
                      {event.summary}
                    </p>
                    <div className={`mt-1.5 text-[11px] ${isUserTurn ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>
                      <time dateTime={event.createdAt}>{formatDisplayDateTime(event.createdAt)}</time>
                    </div>
                  </div>
                )}
              </article>
            )
          })
        ) : (
          <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-8 text-center">
            <p className="m-0 text-sm font-medium text-[var(--ink-strong)]">No visible thread history yet.</p>
            <p className="m-0 mt-2 text-sm text-[var(--ink-soft)]">Reply to this idea and the assistant will start building context with you here.</p>
          </div>
        )}

        {pendingBreakdownProposal && onAcceptBreakdown && onRejectBreakdown ? (
          <div className="flex justify-start">
            <BreakdownProposalCard
              proposal={pendingBreakdownProposal}
              isAccepting={isAcceptingBreakdown}
              isRejecting={isRejectingBreakdown}
              onAccept={onAcceptBreakdown}
              onReject={onRejectBreakdown}
            />
          </div>
        ) : null}

        {pendingStructuredProposal && onAcceptStructuredProposal && onRejectStructuredProposal ? (
          <div className="flex justify-start">
            <StructuredActionProposalCard
              proposal={pendingStructuredProposal}
              isAccepting={isAcceptingStructuredProposal}
              isRejecting={isRejectingStructuredProposal}
              onAccept={onAcceptStructuredProposal}
              onReject={onRejectStructuredProposal}
            />
          </div>
        ) : null}

        {acceptedBreakdownSteps.length > 0 && !pendingBreakdownProposal && !pendingStructuredProposal ? (
          <div className="flex justify-start">
            <AcceptedBreakdownPlanCard
              steps={acceptedBreakdownSteps}
              onCreateTaskFromStep={onCreateTaskFromStep}
              onCompleteLinkedTask={onCompleteLinkedTask}
              onCompleteStep={onCompleteStep}
              onUncompleteStep={onUncompleteStep}
              stepActionInFlight={stepActionInFlight}
              linkedStepIds={linkedStepIds}
              artifactSummariesByStepId={artifactSummariesByStepId}
              linkedTasksByStepId={linkedTasksByStepId}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
