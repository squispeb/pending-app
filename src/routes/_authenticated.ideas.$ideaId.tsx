import { Lightbulb, Mic, Quote, SendHorizonal, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { useCaptureContext } from '../contexts/CaptureContext'
import { formatDisplayDateTime } from '../lib/date-time'
import {
  getIdeaActionLockedReason,
  getIdeaStageActionGuidance,
  getIdeaStructuredActionAvailability,
  canUseIdeaRefinementActions,
  getIdeaStructuredActionLabel,
  type IdeaRefinementAction,
  type IdeaRestructureAction,
} from '../lib/idea-structured-actions'
import { getIdeaStageBadgeClassName, getIdeaStageLabel, isIdeaStarred } from '../lib/ideas'
import { parseIdeaThreadStreamFrames } from '../lib/idea-thread-stream'
import {
  acceptIdeaBreakdown,
  acceptIdeaStructuredAction,
  completeAcceptedBreakdownStep,
  convertAcceptedBreakdownStepToTask,
  convertIdeaToTask,
  getIdea,
  getIdeaThread,
  listAcceptedBreakdownSteps,
  listIdeaExecutionLinks,
  persistIdeaRefinement,
  rejectIdeaStructuredAction,
  requestIdeaConvertToTask,
  requestIdeaRefinement,
  requestIdeaStructuredAction,
  streamIdeaThread,
  submitIdeaThreadTurn,
  toggleIdeaStar,
  uncompleteAcceptedBreakdownStep,
} from '../server/ideas'

type IdeaPageTab = 'thread' | 'context' | 'guided' | 'source'
type SupportSheetTab = Exclude<IdeaPageTab, 'thread'>

const ideaDetailQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['ideas', ideaId],
    queryFn: () => getIdea({ data: { id: ideaId } }),
  })

const ideaThreadQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['idea-thread', ideaId],
    queryFn: () => getIdeaThread({ data: { id: ideaId } }),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && status !== 'idle' ? 1500 : false
    },
  })

const ideaTaskLinksQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['idea-execution-links', ideaId, 'task'],
    queryFn: () => listIdeaExecutionLinks({ data: { id: ideaId, targetType: 'task' } }),
  })

const acceptedBreakdownStepsQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['idea-accepted-breakdown-steps', ideaId],
    queryFn: () => listAcceptedBreakdownSteps({ data: { id: ideaId } }),
  })

export const Route = createFileRoute('/_authenticated/ideas/$ideaId')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === 'default' ? 'default' : 'chat',
  }),
  loader: ({ context, params }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(ideaDetailQueryOptions(params.ideaId)),
      context.queryClient.ensureQueryData(ideaThreadQueryOptions(params.ideaId)),
      context.queryClient.ensureQueryData(ideaTaskLinksQueryOptions(params.ideaId)),
      context.queryClient.ensureQueryData(acceptedBreakdownStepsQueryOptions(params.ideaId)),
    ])
  },
  component: IdeaDetailPage,
})

function IdeaDetailPage() {
  const { ideaId } = Route.useParams()
  const { view } = Route.useSearch()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaDetailQueryOptions(ideaId))
  const { data: thread } = useSuspenseQuery(ideaThreadQueryOptions(ideaId))
  const { data: taskLinks } = useSuspenseQuery(ideaTaskLinksQueryOptions(ideaId))
  const { data: acceptedBreakdownSteps } = useSuspenseQuery(acceptedBreakdownStepsQueryOptions(ideaId))
  const { openCapture } = useCaptureContext()
  const isChatView = view === 'chat'
  const [discoveryMessage, setDiscoveryMessage] = useState('')
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null)
  const [streamingAssistantText, setStreamingAssistantText] = useState('')
  const [isComposerExpanded, setIsComposerExpanded] = useState(false)
  const [dismissedRefinements, setDismissedRefinements] = useState<{ title: string | null; summary: string | null }>({
    title: null,
    summary: null,
  })
  const [activePageTab, setActivePageTab] = useState<IdeaPageTab>('thread')
  const [activeSupportTab, setActiveSupportTab] = useState<SupportSheetTab>('context')
  const [isSupportSheetOpen, setIsSupportSheetOpen] = useState(false)
  const [isThreadAtBottom, setIsThreadAtBottom] = useState(true)
  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const lastStreamEventIdRef = useRef<string | null>(null)
  const streamedEventIdsRef = useRef(new Set<string>())
  const activeStreamingTurnIdRef = useRef<string | null>(null)
  /** Track turn IDs that have already completed so replayed chunks on reconnect are skipped */
  const completedTurnIdsRef = useRef(new Set<string>())
  const queuedTurns = thread.queuedTurns ?? []
  const visibleEvents = thread.visibleEvents ?? []
  const safeAcceptedBreakdownSteps = acceptedBreakdownSteps ?? []
  const safeTaskLinks = taskLinks ?? []
  const workingIdea = thread.workingIdea ?? {
    provisionalTitle: null,
    currentSummary: null,
    purpose: null,
    scope: null,
    expectedImpact: null,
    targetUsers: [],
    researchAreas: [],
    constraints: [],
    openQuestions: [],
  }
  const isThreadBusy = thread.status === 'queued' || thread.status === 'processing' || thread.status === 'streaming'
  const queuedTurnCount = queuedTurns.length
  const latestQueuedTurn = queuedTurns.at(-1) ?? null

  /**
   * Derive which accepted breakdown steps already have a linked task.
   * The service stores linkReason as "Accepted breakdown step #N from idea."
   * where N is the 1-based stepOrder. We map that back to step IDs so the
   * plan card can suppress the "Create task" button for already-linked steps.
   */
  const linkedStepIds = safeAcceptedBreakdownSteps
    .filter((step) =>
      safeTaskLinks.some(
        (link) => link.linkReason === `Accepted breakdown step #${step.stepOrder} from idea.`,
      ),
    )
    .map((step) => step.id)

  if (!idea) {
    throw notFound()
  }

  const ideaTitle = idea.title ?? 'Untitled idea'
  const ideaThreadSummary = idea.threadSummary ?? null
  const ideaBody = idea.body ?? ''

  const canUseRefinementActions = canUseIdeaRefinementActions(thread.stage)
  const suggestedTitle = workingIdea.provisionalTitle
    && workingIdea.provisionalTitle !== ideaTitle
    && workingIdea.provisionalTitle !== dismissedRefinements.title
    ? workingIdea.provisionalTitle
    : null
  const suggestedSummary = workingIdea.currentSummary
    && workingIdea.currentSummary !== ideaThreadSummary
    && workingIdea.currentSummary !== dismissedRefinements.summary
    ? workingIdea.currentSummary
    : null
  const pendingStructuredAction = thread.pendingStructuredAction ?? null
  const latestTaskLink = safeTaskLinks[0] ?? null
  const convertedTaskId = latestTaskLink?.targetId ?? null

  const latestAssistantEvent = [...visibleEvents]
    .reverse()
    .find((event) => event.type === 'assistant_question' || event.type === 'assistant_synthesis') ?? null
  const latestAssistantQuestion = latestAssistantEvent?.type === 'assistant_question' ? latestAssistantEvent.summary : null
  const currentThreadTitle = workingIdea.provisionalTitle ?? ideaTitle
  const composerStatusText = thread.status === 'queued'
    ? latestQueuedTurn
      ? `Queued after the current turn: ${latestQueuedTurn.userMessage}`
      : 'Your next reply will queue after the current turn.'
    : thread.status === 'processing'
      ? thread.activeTurn
        ? `Assistant is working on: ${thread.activeTurn.userMessage}`
        : 'Assistant is processing the latest reply.'
      : thread.status === 'streaming'
        ? 'Assistant is replying now. You can queue another follow-up if needed.'
        : 'Add the next piece of context and the assistant will continue the conversation.'

  const missingDiscoveryAreas = [
    !workingIdea.purpose ? 'purpose' : null,
    workingIdea.targetUsers.length === 0 ? 'users' : null,
    !workingIdea.expectedImpact ? 'impact' : null,
    !workingIdea.scope ? 'scope' : null,
    workingIdea.researchAreas.length === 0 ? 'research' : null,
    workingIdea.constraints.length === 0 ? 'constraints' : null,
    workingIdea.openQuestions.length === 0 ? 'open questions' : null,
  ].filter((value): value is string => value !== null)

  const populatedWorkingIdeaEntries = [
    workingIdea.purpose ? ['Purpose', workingIdea.purpose] : null,
    workingIdea.scope ? ['Scope', workingIdea.scope] : null,
    workingIdea.expectedImpact ? ['Expected impact', workingIdea.expectedImpact] : null,
    workingIdea.targetUsers.length > 0 ? ['Target users', workingIdea.targetUsers.join(', ')] : null,
    workingIdea.researchAreas.length > 0 ? ['Research areas', workingIdea.researchAreas.join(', ')] : null,
    workingIdea.constraints.length > 0 ? ['Constraints', workingIdea.constraints.join(', ')] : null,
    workingIdea.openQuestions.length > 0 ? ['Open questions', workingIdea.openQuestions.join(', ')] : null,
  ].filter((entry): entry is [string, string] => entry !== null)
  const stageLabel = getIdeaStageLabel(thread.stage)
  const stageBadgeClassName = getIdeaStageBadgeClassName(thread.stage)
  const stageActionGuidance = getIdeaStageActionGuidance(thread.stage)
  const discoveryProgressPercent = Math.max(12, (populatedWorkingIdeaEntries.length / 7) * 100)
  const threadRailMessage = isThreadBusy
    ? thread.status === 'queued'
      ? queuedTurnCount > 0
        ? `${queuedTurnCount} replies are queued while the assistant finishes the current turn.`
        : 'Your latest reply is queued behind the current turn.'
      : thread.status === 'streaming'
        ? 'The assistant is writing back in this thread now.'
        : 'The assistant is processing the latest turn now.'
    : missingDiscoveryAreas.length > 0
      ? `The biggest gaps right now are ${missingDiscoveryAreas.join(', ')}.`
      : 'The working idea has enough context for a stronger framing pass.'
  const currentThreadSubtitle = latestAssistantQuestion
    ?? (streamingAssistantText
      ? 'Assistant is replying in the thread now.'
      : thread.status === 'failed'
        ? 'The last reply failed. Retry with another prompt or capture more context.'
        : threadRailMessage)
  const threadStatusChipLabel = thread.status === 'queued'
    ? queuedTurnCount > 0
      ? `${queuedTurnCount} queued`
      : 'Queued'
    : thread.status === 'processing'
      ? 'Assistant thinking'
      : thread.status === 'streaming'
        ? 'Assistant replying'
        : thread.status === 'failed'
          ? 'Needs retry'
          : 'Thread ready'
  const reviewItemCount = Number(Boolean(suggestedTitle)) + Number(Boolean(suggestedSummary)) + Number(Boolean(pendingStructuredAction))
  const refinementActions = (['title', 'summary'] as const).map((action) => ({
    action,
    label: getIdeaStructuredActionLabel(action),
    available: getIdeaStructuredActionAvailability(action, thread.stage) === 'available',
    lockedReason: getIdeaActionLockedReason(action, thread.stage),
    hasPendingReview: action === 'title' ? Boolean(suggestedTitle) : Boolean(suggestedSummary),
  }))
  const structuredActions = (['restructure', 'breakdown'] as const).map((action) => ({
    action,
    label: getIdeaStructuredActionLabel(action),
    available: getIdeaStructuredActionAvailability(action, thread.stage) === 'available',
    lockedReason: getIdeaActionLockedReason(action, thread.stage),
    hasPendingReview: Boolean(pendingStructuredAction) && pendingStructuredAction?.action === action,
  }))
  const convertToTaskAction = {
    action: 'convert-to-task' as const,
    label: getIdeaStructuredActionLabel('convert-to-task'),
    available: getIdeaStructuredActionAvailability('convert-to-task', thread.stage) === 'available',
    lockedReason: getIdeaActionLockedReason('convert-to-task', thread.stage),
    hasPendingReview: Boolean(pendingStructuredAction) && pendingStructuredAction?.action === 'convert-to-task',
  }
  const threadActionRailItems = [
    ...refinementActions
      .filter(({ available }) => available)
      .map((item) => ({ ...item, tone: 'emerald' as const })),
    ...structuredActions
      .filter(({ available }) => available)
      .map((item) => ({ ...item, tone: 'cyan' as const })),
    ...(convertToTaskAction.available ? [{ ...convertToTaskAction, tone: 'cyan' as const }] : []),
  ]
  const threadActionGuide = threadActionRailItems.length > 0 ? (
    <div className="pointer-events-none sticky top-3 z-20 mb-3 flex justify-end">
      <div
        className="pointer-events-auto w-full max-w-[18rem] rounded-[20px] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_90%,white_10%)] px-2.5 py-2 shadow-[0_14px_34px_rgba(15,23,42,0.16)] backdrop-blur-xl"
        role="group"
        aria-label="Suggested next steps"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Next steps</div>
        <div className="scrollbar-none mt-1.5 flex gap-1 overflow-x-auto overflow-y-hidden pb-0.5">
          {threadActionRailItems.map(({ action, label, tone }) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                if (action === 'title' || action === 'summary') {
                  requestRefinementMutation.mutate(action)
                  return
                }

                if (action === 'convert-to-task') {
                  requestConvertToTaskMutation.mutate()
                  return
                }

                requestStructuredActionMutation.mutate(action)
              }}
              className={`inline-flex h-7 flex-none items-center justify-center rounded-full border px-2.5 text-[10px] font-semibold leading-none transition ${tone === 'emerald' ? 'border-emerald-600/60 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20' : 'border-cyan-600/60 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null
  const shouldShowComposerMeta = Boolean(discoveryError || discoveryNotice || isThreadBusy)
  const pageTabs = [
    { id: 'thread', label: 'Thread' },
    { id: 'context', label: 'Context' },
    { id: 'guided', label: `Guided${reviewItemCount > 0 ? ` (${reviewItemCount})` : ''}` },
    { id: 'source', label: 'Source' },
  ] as const satisfies ReadonlyArray<{ id: IdeaPageTab; label: string }>
  const supportTabs = pageTabs.filter((tab) => tab.id !== 'thread')

  const toggleStarMutation = useMutation({
    mutationFn: async () => toggleIdeaStar({ data: { id: idea.id } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: ['ideas', ideaId] }),
      ])
    },
  })

  const submitTurnMutation = useMutation({
    mutationFn: async (message: string) => submitIdeaThreadTurn({ data: { id: ideaId, message } }),
    onSuccess: async (result) => {
      setDiscoveryMessage('')
      setIsComposerExpanded(false)
      setDiscoveryError(null)
      setDiscoveryNotice(result.state === 'queued' ? `Reply queued behind ${result.queueDepth} ${result.queueDepth === 1 ? 'active turn' : 'active turns'}.` : null)
      queryClient.setQueryData(['idea-thread', ideaId], result.thread)

      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to submit discovery turn.')
    },
  })
  const composerButtonLabel = submitTurnMutation.isPending ? 'Sending...' : isThreadBusy ? 'Queue reply' : 'Send reply'

  const requestRefinementMutation = useMutation({
    mutationFn: async (action: IdeaRefinementAction) => requestIdeaRefinement({
      data: {
        id: ideaId,
        kind: action,
      },
    }),
    onSuccess: async (result, action) => {
      setDiscoveryError(null)
      setDiscoveryNotice(action === 'title' ? 'Title suggestion added to the thread context.' : 'Summary suggestion added to the thread context.')
      setDismissedRefinements((current) => ({
        ...current,
        [action]: null,
      }))
      queryClient.setQueryData(['idea-thread', ideaId], result.thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to request a refinement action.')
    },
  })

  const requestStructuredActionMutation = useMutation({
    mutationFn: async (action: IdeaRestructureAction) => requestIdeaStructuredAction({
      data: {
        id: ideaId,
        kind: action,
      },
    }),
    onSuccess: async (result, action) => {
      setDiscoveryError(null)
      setDiscoveryNotice(action === 'restructure' ? 'Framing request sent.' : 'Breakdown request sent.')
      queryClient.setQueryData(['idea-thread', ideaId], result.thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to request a structured action.')
    },
  })

  const persistRefinementMutation = useMutation({
    mutationFn: async (kind: IdeaRefinementAction) => persistIdeaRefinement({
      data: {
        id: ideaId,
        kind,
      },
    }),
    onSuccess: async (_, kind) => {
      setDiscoveryError(null)
      setDiscoveryNotice(kind === 'title' ? 'Title saved.' : 'Summary saved.')
      setDismissedRefinements((current) => ({
        ...current,
        [kind]: null,
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: ['ideas', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
      ])
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to save the refinement suggestion.')
    },
  })

  const acceptStructuredActionMutation = useMutation({
    mutationFn: async (proposalId: string) => acceptIdeaStructuredAction({
      data: {
        id: ideaId,
        proposalId,
      },
    }),
    onSuccess: async (thread) => {
      setDiscoveryError(null)
      setDiscoveryNotice('Accepted — proposal applied to the thread.')
      queryClient.setQueryData(['idea-thread', ideaId], thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to apply the proposal.')
    },
  })

  const acceptBreakdownMutation = useMutation({
    mutationFn: async (proposalId: string) => acceptIdeaBreakdown({
      data: {
        id: ideaId,
        proposalId,
      },
    }),
    onSuccess: async (thread) => {
      setDiscoveryError(null)
      setDiscoveryNotice('Accepted — breakdown steps persisted to the thread.')
      queryClient.setQueryData(['idea-thread', ideaId], thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to persist the breakdown steps.')
    },
  })

  const rejectStructuredActionMutation = useMutation({
    mutationFn: async (proposalId: string) => rejectIdeaStructuredAction({
      data: {
        id: ideaId,
        proposalId,
      },
    }),
    onSuccess: async (thread) => {
      setDiscoveryError(null)
      setDiscoveryNotice('Rejected — your thread state is unchanged.')
      queryClient.setQueryData(['idea-thread', ideaId], thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to dismiss the proposal.')
    },
  })

  const requestConvertToTaskMutation = useMutation({
    mutationFn: async () => requestIdeaConvertToTask({
      data: {
        id: ideaId,
      },
    }),
    onSuccess: async (result) => {
      setDiscoveryError(null)
      setDiscoveryNotice('Convert to task request sent — a proposal will appear above.')
      setActiveSupportTab('guided')
      setIsSupportSheetOpen(true)
      queryClient.setQueryData(['idea-thread', ideaId], result.thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to request task conversion.')
    },
  })

  const convertToTaskMutation = useMutation({
    mutationFn: async (proposalId: string) => convertIdeaToTask({
      data: {
        id: ideaId,
        proposalId,
      },
    }),
    onSuccess: async (result) => {
      setDiscoveryError(null)
      setDiscoveryNotice('Task created and linked to this idea.')
      queryClient.setQueryData(['idea-thread', ideaId], result.thread)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-execution-links', ideaId, 'task'] }),
      ])
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to convert idea to task.')
    },
  })

  const convertBreakdownStepToTaskMutation = useMutation({
    mutationFn: async (stepId: string) => convertAcceptedBreakdownStepToTask({
      data: { ideaId, stepId },
    }),
    onSuccess: async () => {
      setDiscoveryError(null)
      setDiscoveryNotice('Task created from the breakdown step.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-execution-links', ideaId, 'task'] }),
      ])
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to create task from breakdown step.')
    },
  })

  const completeBreakdownStepMutation = useMutation({
    mutationFn: async (stepId: string) => completeAcceptedBreakdownStep({
      data: { ideaId, stepId },
    }),
    onSuccess: async () => {
      setDiscoveryError(null)
      setDiscoveryNotice('Step marked done.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['idea-accepted-breakdown-steps', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
      ])
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to mark breakdown step done.')
    },
  })

  const uncompleteBreakdownStepMutation = useMutation({
    mutationFn: async (stepId: string) => uncompleteAcceptedBreakdownStep({
      data: { ideaId, stepId },
    }),
    onSuccess: async () => {
      setDiscoveryError(null)
      setDiscoveryNotice('Step reopened.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['idea-accepted-breakdown-steps', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
      ])
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to reopen breakdown step.')
    },
  })

  const stepActionInFlight = convertBreakdownStepToTaskMutation.isPending
    ? { stepId: convertBreakdownStepToTaskMutation.variables ?? '', action: 'create-task' as const }
    : completeBreakdownStepMutation.isPending
      ? { stepId: completeBreakdownStepMutation.variables ?? '', action: 'complete' as const }
      : uncompleteBreakdownStepMutation.isPending
        ? { stepId: uncompleteBreakdownStepMutation.variables ?? '', action: 'uncomplete' as const }
        : null

  const refineActionsDisabled = isThreadBusy || requestRefinementMutation.isPending || persistRefinementMutation.isPending
  const structuredActionsDisabled = isThreadBusy || requestRefinementMutation.isPending || requestStructuredActionMutation.isPending || persistRefinementMutation.isPending || requestConvertToTaskMutation.isPending || convertToTaskMutation.isPending

  function handleDiscoverySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = discoveryMessage.trim()

    if (!message) {
      return
    }

    setDiscoveryError(null)
    setDiscoveryNotice(null)
    submitTurnMutation.mutate(message)
  }

  function handleComposerChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value
    const lineCount = nextValue.split('\n').length

    setDiscoveryMessage(nextValue)
    setIsComposerExpanded(nextValue.length > 72 || lineCount > 1)
  }

  function handleThreadViewportScroll() {
    if (activePageTab !== 'thread') {
      return
    }

    const viewport = threadViewportRef.current

    if (!viewport) {
      return
    }

    const composerHeight = composerRef.current?.offsetHeight ?? 96
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setIsThreadAtBottom(distanceFromBottom < composerHeight + 24)
  }

  function scrollThreadToBottom(behavior: ScrollBehavior = 'smooth') {
    const viewport = threadViewportRef.current

    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    })
    setIsThreadAtBottom(true)
  }

  useEffect(() => {
    if (activePageTab !== 'thread') {
      return
    }

    if (!isThreadAtBottom) {
      return
    }

    scrollThreadToBottom(streamingAssistantText ? 'auto' : 'smooth')
  }, [activePageTab, isThreadAtBottom, visibleEvents.length, streamingAssistantText])

  useEffect(() => {
    if (activePageTab !== 'thread') {
      return
    }

    handleThreadViewportScroll()
  }, [activePageTab, visibleEvents.length, streamingAssistantText])

  useEffect(() => {
    if (!isThreadBusy) {
      setStreamingAssistantText('')
      lastStreamEventIdRef.current = null
      activeStreamingTurnIdRef.current = null
      streamedEventIdsRef.current.clear()
      completedTurnIdsRef.current.clear()
      return
    }

    const abortController = new AbortController()
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      while (!abortController.signal.aborted) {
        try {
          const response = await streamIdeaThread({
            data: { id: ideaId, lastEventId: lastStreamEventIdRef.current },
            signal: abortController.signal as never,
          })

          if (!response.body) {
            return
          }

          const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .getReader()
          let buffer = ''

          while (true) {
            const { value, done } = await reader.read()

            if (done) {
              break
            }

            buffer += value
            const parsed = parseIdeaThreadStreamFrames(buffer)
            buffer = parsed.remainder

            for (const payload of parsed.events) {
              if (payload.streamEventId) {
                if (streamedEventIdsRef.current.has(payload.streamEventId)) {
                  continue
                }

                streamedEventIdsRef.current.add(payload.streamEventId)
                lastStreamEventIdRef.current = payload.streamEventId
              }

              if (payload.type === 'turn_started') {
                // Don't reset streaming text for a turn that already completed
                // (can be replayed when lastEventId is sent on reconnect)
                if (!completedTurnIdsRef.current.has(payload.turnId)) {
                  activeStreamingTurnIdRef.current = payload.turnId
                  setStreamingAssistantText('')
                }
                continue
              }

              if (payload.type === 'assistant_chunk') {
                // Skip chunks for turns that have already completed to prevent duplicates
                if (completedTurnIdsRef.current.has(payload.turnId)) {
                  continue
                }

                if (activeStreamingTurnIdRef.current !== payload.turnId) {
                  activeStreamingTurnIdRef.current = payload.turnId
                  setStreamingAssistantText(payload.textDelta)
                  continue
                }

                setStreamingAssistantText((current) => `${current}${payload.textDelta}`)
                continue
              }

              if (payload.type === 'turn_completed' || payload.type === 'turn_failed') {
                completedTurnIdsRef.current.add(payload.turnId)
                setStreamingAssistantText('')
                activeStreamingTurnIdRef.current = null
              }
            }
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            return
          }

          setDiscoveryError((current) => current ?? (error instanceof Error ? error.message : 'Failed to subscribe to assistant stream.'))
        }

        if (abortController.signal.aborted) {
          return
        }

        await new Promise<void>((resolve) => {
          const finish = () => {
            if (reconnectTimeout) {
              clearTimeout(reconnectTimeout)
              reconnectTimeout = null
            }
            resolve()
          }

          reconnectTimeout = setTimeout(finish, 1000)
          abortController.signal.addEventListener('abort', finish, { once: true })
        })
      }
    })()

    return () => {
      abortController.abort()
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
    }
  }, [ideaId, isThreadBusy])

  const contextSurface = (
    <section className="panel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Context</div>
          <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-strong)]">
            Supporting context captured alongside this thread.
          </p>
        </div>
        <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">
          {populatedWorkingIdeaEntries.length}/7
        </div>
      </div>

      <div className="space-y-4 text-sm text-[var(--ink-strong)]">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Saved framing</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Title</div>
                <div className="mt-1">{ideaTitle}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Summary</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{ideaThreadSummary ?? 'No saved summary yet.'}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Description</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{ideaBody || 'No description has been saved yet.'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Working state</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Working title</div>
                <div className="mt-1">{workingIdea.provisionalTitle ?? ideaTitle}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Working summary</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{workingIdea.currentSummary ?? 'No working summary yet.'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-[var(--ink-strong)]">Discovery progress</div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
              {populatedWorkingIdeaEntries.length}/7 captured
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-[var(--surface-strong)]">
            <div className="h-2 rounded-full bg-[var(--brand)]" style={{ width: `${discoveryProgressPercent}%` }} />
          </div>
          <p className="m-0 mt-3 leading-6">
            {missingDiscoveryAreas.length === 0
              ? 'All tracked discovery areas have initial context.'
              : `${missingDiscoveryAreas.length} areas still need more context: ${missingDiscoveryAreas.join(', ')}.`}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <dt className="font-medium text-[var(--ink-strong)]">Stage</dt>
            <dd className="mt-1">{stageLabel}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <dt className="font-medium text-[var(--ink-strong)]">Source type</dt>
            <dd className="mt-1">{idea.sourceType.replace('_', ' ')}</dd>
          </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <dt className="font-medium text-[var(--ink-strong)]">Created</dt>
              <dd className="mt-1">{formatDisplayDateTime(idea.createdAt)}</dd>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <dt className="font-medium text-[var(--ink-strong)]">Updated</dt>
              <dd className="mt-1">{formatDisplayDateTime(idea.updatedAt)}</dd>
            </div>
        </dl>
      </div>
    </section>
  )

  const reviewSurface = (
    <section className="panel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Guided actions</div>
          <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-strong)]">Stage-aware guidance, wording refinements, and guided thread actions.</p>
        </div>
        <div className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)] shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] dark:bg-[var(--surface-strong)] dark:text-[var(--ink-strong)]">
          {reviewItemCount} item{reviewItemCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="space-y-4 text-sm text-[var(--ink-strong)]">
        {reviewItemCount > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm leading-6 text-[var(--ink-strong)] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-[var(--ink-strong)]">
            Review the pending suggestions and proposals above before requesting new Guided actions.
          </div>
        ) : null}

        {safeAcceptedBreakdownSteps.length > 0 ? (
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/10">
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                Accepted breakdown
              </div>
              <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-strong)]">
                {safeAcceptedBreakdownSteps.length} step{safeAcceptedBreakdownSteps.length === 1 ? '' : 's'} locked in from the last accepted proposal.
              </p>
            </div>
            <ol className="m-0 space-y-2 pl-0 list-none">
              {safeAcceptedBreakdownSteps.map((step, index) => (
                <li key={step.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[11px] font-bold text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300">
                    {index + 1}
                  </span>
                  <span className="leading-6 text-[var(--ink-strong)]">{step.stepText}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {canUseRefinementActions && pendingStructuredAction ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
            <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Assistant proposal</div>
            <div className="space-y-4">
              {pendingStructuredAction.action === 'restructure' ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Restructured framing</div>
                  <div className="rounded-2xl border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
                    <div className="text-xs uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">Suggested</div>
                    <div className="mt-1 whitespace-pre-wrap text-[var(--ink-strong)]">{pendingStructuredAction.proposedSummary}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Why</div>
                    <div className="mt-1 whitespace-pre-wrap">{pendingStructuredAction.explanation}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => acceptStructuredActionMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">Accept restructure</button>
                    <button type="button" disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => rejectStructuredActionMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60">Reject restructure</button>
                  </div>
                </div>
              ) : null}

              {pendingStructuredAction.action === 'breakdown' ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Next-step breakdown</div>
                  <div className="rounded-2xl border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
                    <div className="text-xs uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">Suggested</div>
                    <div className="mt-1 whitespace-pre-wrap text-[var(--ink-strong)]">{pendingStructuredAction.proposedSummary}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Why</div>
                    <div className="mt-1 whitespace-pre-wrap">{pendingStructuredAction.explanation}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={acceptBreakdownMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => acceptBreakdownMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">Accept breakdown</button>
                    <button type="button" disabled={acceptBreakdownMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => rejectStructuredActionMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60">Reject breakdown</button>
                  </div>
                </div>
              ) : null}

              {pendingStructuredAction.action === 'convert-to-task' ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Task conversion proposal</div>
                  <div className="rounded-2xl border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
                    <div className="text-xs uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">Proposed task</div>
                    <div className="mt-1 whitespace-pre-wrap text-[var(--ink-strong)]">{pendingStructuredAction.proposedSummary}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Why</div>
                    <div className="mt-1 whitespace-pre-wrap">{pendingStructuredAction.explanation}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={convertToTaskMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => convertToTaskMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">{convertToTaskMutation.isPending ? 'Creating task…' : 'Accept — create task'}</button>
                    <button type="button" disabled={convertToTaskMutation.isPending || rejectStructuredActionMutation.isPending} onClick={() => rejectStructuredActionMutation.mutate(pendingStructuredAction.proposalId)} className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60">Reject proposal</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {convertedTaskId ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="mb-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Task created</div>
              <p className="m-0 leading-6 text-[var(--ink-strong)]">
                This idea has been converted to a task.{' '}
                <Link to="/tasks" className="font-semibold text-[var(--brand)] underline-offset-2 hover:underline">
                  View tasks →
                </Link>
              </p>
              <p className="m-0 mt-2 text-xs leading-5 text-[var(--ink-soft)]">Created task ID: {convertedTaskId}</p>
            </div>
          ) : null}

        {canUseRefinementActions && (suggestedTitle || suggestedSummary) ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Suggested refinements</div>
            <div className="space-y-4">
              {suggestedTitle ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Title suggestion</div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"><div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Current</div><div className="mt-1">{ideaTitle}</div></div>
                  <div className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10"><div className="text-xs uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Suggested</div><div className="mt-1 text-[var(--ink-strong)]">{suggestedTitle}</div></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={isThreadBusy || persistRefinementMutation.isPending} onClick={() => persistRefinementMutation.mutate('title')} className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">Save title</button>
                    <button type="button" disabled={persistRefinementMutation.isPending} onClick={() => { setDismissedRefinements((current) => ({ ...current, title: suggestedTitle })); setDiscoveryNotice('Kept the current title.') }} className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60">Keep current title</button>
                  </div>
                </div>
              ) : null}

              {suggestedSummary ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Summary suggestion</div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"><div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Current</div><div className="mt-1 whitespace-pre-wrap">{idea.threadSummary ?? 'No saved summary yet.'}</div></div>
                  <div className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10"><div className="text-xs uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Suggested</div><div className="mt-1 whitespace-pre-wrap text-[var(--ink-strong)]">{suggestedSummary}</div></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={isThreadBusy || persistRefinementMutation.isPending} onClick={() => persistRefinementMutation.mutate('summary')} className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">Save summary</button>
                    <button type="button" disabled={persistRefinementMutation.isPending} onClick={() => { setDismissedRefinements((current) => ({ ...current, summary: suggestedSummary })); setDiscoveryNotice('Kept the current summary.') }} className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60">Keep current summary</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-500/30 dark:bg-sky-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Guide the thread</div>
            <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stageBadgeClassName}`}>{stageLabel}</div>
          </div>
          <div className="mt-2 font-medium text-[var(--ink-strong)]">{stageActionGuidance.title}</div>
          <p className="m-0 mt-2 leading-6 text-[var(--ink-strong)]">{stageActionGuidance.description}</p>
          {missingDiscoveryAreas.length > 0 ? <p className="m-0 mt-2 text-xs leading-5 text-[var(--ink-soft)]">Missing context right now: {missingDiscoveryAreas.join(', ')}.</p> : null}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {refinementActions.map(({ action, label, available, lockedReason, hasPendingReview }) => (
              <div key={action} className={`rounded-2xl border p-3 shadow-sm ${hasPendingReview ? 'border-amber-300 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10' : available ? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-slate-200 bg-white dark:border-slate-500/30 dark:bg-slate-950/30'}`}>
                <button type="button" disabled={!available || refineActionsDisabled || hasPendingReview} onClick={() => requestRefinementMutation.mutate(action)} className={`inline-flex min-h-11 w-full items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-60 ${hasPendingReview ? 'border-amber-700 bg-amber-700 text-white hover:border-amber-800 hover:bg-amber-800 dark:border-amber-300 dark:bg-amber-300 dark:text-slate-950 dark:hover:bg-amber-200' : available ? 'border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 dark:border-emerald-300 dark:bg-emerald-300 dark:text-slate-950 dark:hover:bg-emerald-200' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-500/30 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:border-slate-400/60 dark:hover:bg-slate-900/50'}`}>{label}</button>
                <p className="m-0 mt-2 text-xs leading-5 text-[var(--ink-soft)]">{hasPendingReview ? 'A suggestion is already waiting above. Review it before requesting another.' : available ? 'Uses the current thread context to tighten the wording without leaving the conversation.' : lockedReason}</p>
              </div>
            ))}
            {structuredActions.map(({ action, label, available, lockedReason, hasPendingReview }) => (
              <div key={action} className={`rounded-2xl border p-3 shadow-sm ${hasPendingReview ? 'border-violet-300 bg-violet-50/80 dark:border-violet-500/30 dark:bg-violet-500/10' : available ? 'border-cyan-300 bg-cyan-50/80 dark:border-cyan-500/30 dark:bg-cyan-500/10' : 'border-slate-200 bg-white dark:border-slate-500/30 dark:bg-slate-950/30'}`}>
                <button type="button" disabled={!available || structuredActionsDisabled || hasPendingReview} onClick={() => requestStructuredActionMutation.mutate(action)} className={`inline-flex min-h-11 w-full items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-60 ${hasPendingReview ? 'border-violet-700 bg-violet-700 text-white hover:border-violet-800 hover:bg-violet-800 dark:border-violet-300 dark:bg-violet-300 dark:text-slate-950 dark:hover:bg-violet-200' : available ? 'border-cyan-700 bg-cyan-700 text-white hover:border-cyan-800 hover:bg-cyan-800 dark:border-cyan-300 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-500/30 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:border-slate-400/60 dark:hover:bg-slate-900/50'}`}>{label}</button>
                <p className="m-0 mt-2 text-xs leading-5 text-[var(--ink-soft)]">{hasPendingReview ? 'A proposal is already waiting above. Review it before requesting another.' : available ? action === 'restructure' ? 'Sends a guided prompt into the thread to clarify the framing while keeping the same idea direction.' : 'Sends a guided prompt into the thread to turn the developed idea into concrete next steps.' : lockedReason}</p>
              </div>
            ))}
            {(() => {
              const { label, available, lockedReason, hasPendingReview } = convertToTaskAction
              return (
                <div className={`rounded-2xl border p-3 shadow-sm ${hasPendingReview ? 'border-violet-300 bg-violet-50/80 dark:border-violet-500/30 dark:bg-violet-500/10' : available ? 'border-cyan-300 bg-cyan-50/80 dark:border-cyan-500/30 dark:bg-cyan-500/10' : 'border-slate-200 bg-white dark:border-slate-500/30 dark:bg-slate-950/30'}`}>
                  <button type="button" disabled={!available || structuredActionsDisabled || hasPendingReview} onClick={() => requestConvertToTaskMutation.mutate()} className={`inline-flex min-h-11 w-full items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-60 ${hasPendingReview ? 'border-violet-700 bg-violet-700 text-white hover:border-violet-800 hover:bg-violet-800 dark:border-violet-300 dark:bg-violet-300 dark:text-slate-950 dark:hover:bg-violet-200' : available ? 'border-cyan-700 bg-cyan-700 text-white hover:border-cyan-800 hover:bg-cyan-800 dark:border-cyan-300 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-500/30 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:border-slate-400/60 dark:hover:bg-slate-900/50'}`}>{label}</button>
                  <p className="m-0 mt-2 text-xs leading-5 text-[var(--ink-soft)]">{hasPendingReview ? 'A proposal is already waiting above. Review it before requesting another.' : available ? 'Asks the assistant to propose a task based on this idea. A proposal will appear above for you to review before any task is created.' : lockedReason}</p>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </section>
  )

  const sourceSurface = (
    <section className="panel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Source</div>
        <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-strong)]">Original captured input, separated from the chat so it stays available without crowding the workspace.</p>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
          <Quote size={15} className="text-[var(--brand)]" />
          Source input
        </div>
        <p className="m-0 whitespace-pre-wrap leading-6">{idea.sourceInput || 'No raw source input was stored for this idea.'}</p>
      </div>
    </section>
  )

  const activeTabSurface = activePageTab === 'thread'
    ? (
        <section className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
          {/* Thread-tab context bar — status/subtitle lives here, not in the page header */}
          <div className="flex items-start justify-between gap-2 px-0.5 sm:gap-3">
            <p className="m-0 min-w-0 flex-1 text-[13px] leading-6 text-[var(--ink-strong)] sm:text-sm">
              {currentThreadSubtitle}
            </p>
            <div className="inline-flex shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)] sm:hidden">
              {threadStatusChipLabel}
            </div>
          </div>

          {/* Chat unit: scroll area + composer together, with a compact in-thread guide */}
          <div className="idea-thread-shell flex min-h-0 flex-1 flex-col gap-0 rounded-[28px]">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[28px]">
              <div
                ref={threadViewportRef}
                onScroll={handleThreadViewportScroll}
                aria-label="Thread messages"
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
              >
                {threadActionGuide}
                <IdeaThreadHistory
                  visibleEvents={visibleEvents}
                  threadStatus={thread.status}
                  activeTurn={thread.activeTurn}
                  queuedTurns={queuedTurns}
                  lastTurn={thread.lastTurn}
                  streamingAssistantText={streamingAssistantText}
                  acceptedBreakdownSteps={safeAcceptedBreakdownSteps}
                  pendingBreakdownProposal={
                    pendingStructuredAction?.action === 'breakdown' && canUseRefinementActions
                      ? {
                          proposalId: pendingStructuredAction.proposalId,
                          action: 'breakdown',
                          proposedSummary: pendingStructuredAction.proposedSummary,
                          explanation: pendingStructuredAction.explanation,
                        }
                      : null
                  }
                  isAcceptingBreakdown={acceptBreakdownMutation.isPending}
                  isRejectingBreakdown={rejectStructuredActionMutation.isPending}
                  onAcceptBreakdown={(proposalId) => acceptBreakdownMutation.mutate(proposalId)}
                  onRejectBreakdown={(proposalId) => rejectStructuredActionMutation.mutate(proposalId)}
                  onCreateTaskFromStep={(stepId) => convertBreakdownStepToTaskMutation.mutate(stepId)}
                  onCompleteStep={(stepId) => completeBreakdownStepMutation.mutate(stepId)}
                  onUncompleteStep={(stepId) => uncompleteBreakdownStepMutation.mutate(stepId)}
                  stepActionInFlight={stepActionInFlight}
                  linkedStepIds={linkedStepIds}
                  threadRegionId="thread-history-panel"
                  showHeader={false}
                  className="min-h-full"
                 />
              </div>

              {!isThreadAtBottom ? (
                <button
                  type="button"
                  onClick={() => scrollThreadToBottom()}
                  aria-label="Jump to latest message"
                  className="absolute bottom-3 right-4 inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_88%,white_12%)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] shadow-[0_16px_34px_rgba(15,23,42,0.16)] backdrop-blur hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  Jump to latest
                </button>
              ) : null}
            </div>

            <form
              ref={composerRef}
              aria-label="Reply in thread"
              className="panel z-10 shrink-0 space-y-4 rounded-b-[28px] border border-t-0 border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_84%,white_16%)] p-4 shadow-[0_22px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              onSubmit={handleDiscoverySubmit}
            >
              <label className="sr-only" htmlFor="idea-thread-reply">Reply in thread</label>
              <div className="flex items-end gap-2 rounded-[26px] border border-[var(--line)] bg-[var(--surface)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <button
                  type="button"
                  onClick={openCapture}
                  aria-label="Reply with voice"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--ink-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  <Mic size={16} />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Reply in thread</div>
                  <textarea
                    id="idea-thread-reply"
                    value={discoveryMessage}
                    onChange={handleComposerChange}
                    onFocus={() => setIsComposerExpanded((current) => current || discoveryMessage.length > 0)}
                    onBlur={() => setIsComposerExpanded(discoveryMessage.trim().length > 72 || discoveryMessage.includes('\n'))}
                    placeholder={latestAssistantQuestion ?? 'Add more context to this idea.'}
                    rows={isComposerExpanded ? 3 : 1}
                    className="max-h-32 min-h-11 w-full resize-none border-0 bg-transparent px-3 py-2 text-[var(--ink-strong)] outline-none transition placeholder:text-[var(--ink-faint)]"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        handleDiscoverySubmit(event as unknown as React.FormEvent<HTMLFormElement>)
                      }
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitTurnMutation.isPending || discoveryMessage.trim().length === 0}
                  aria-label={composerButtonLabel}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <SendHorizonal size={16} />
                </button>
              </div>

              {shouldShowComposerMeta ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    {discoveryError ? (
                      <p role="alert" aria-live="assertive" className="m-0 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                        {discoveryError}
                      </p>
                    ) : !discoveryError && discoveryNotice ? (
                      <p aria-live="polite" className="m-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                        {discoveryNotice}
                      </p>
                    ) : (
                      <p aria-live="polite" className="m-0 px-1 text-sm leading-6 text-[var(--ink-soft)]">{composerStatusText}</p>
                    )}
                  </div>
                  <p className="m-0 hidden px-1 text-xs leading-5 text-[var(--ink-faint)] sm:block">Voice is preferred. Use <kbd className="rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[10px]">⌘</kbd>/<kbd className="rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>+<kbd className="rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send.</p>
                </div>
              ) : null}
            </form>
          </div>
        </section>
      )
    : activePageTab === 'context'
      ? contextSurface
    : activePageTab === 'guided'
      ? reviewSurface
        : sourceSurface

  const chatHeader = (
    <header className="shrink-0 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to="/ideas"
              className="inline-flex shrink-0 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)] no-underline hover:underline"
            >
              ← Ideas
            </Link>
            <div className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stageBadgeClassName}`}>
              {stageLabel}
            </div>
          </div>
          <h1 className="m-0 mt-2 truncate text-base font-semibold tracking-tight text-[var(--ink-strong)]">
            {currentThreadTitle}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            <span className="min-w-0 truncate">{currentThreadSubtitle}</span>
            <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
              {threadStatusChipLabel}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveSupportTab(reviewItemCount > 0 ? 'guided' : 'context')
              setIsSupportSheetOpen(true)
            }}
            aria-label="Open supporting idea sections"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            <span>Details</span>
            {reviewItemCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {reviewItemCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => toggleStarMutation.mutate()}
            aria-label={isIdeaStarred(idea) ? 'Remove star from idea' : 'Star idea'}
            className={`inline-flex size-9 items-center justify-center rounded-full border text-sm font-semibold transition ${
              isIdeaStarred(idea)
                ? 'border-amber-300 bg-amber-100/70 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
            }`}
          >
            <Star size={14} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
            <span className="sr-only">{isIdeaStarred(idea) ? 'Starred' : 'Star idea'}</span>
          </button>
        </div>
      </div>
    </header>
  )

  const threadSurface = (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={threadViewportRef}
          onScroll={handleThreadViewportScroll}
          aria-label="Thread messages"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3 [scrollbar-gutter:stable]"
        >
          {threadActionGuide}
          <IdeaThreadHistory
            visibleEvents={visibleEvents}
            threadStatus={thread.status}
            activeTurn={thread.activeTurn}
            queuedTurns={queuedTurns}
            lastTurn={thread.lastTurn}
            streamingAssistantText={streamingAssistantText}
            acceptedBreakdownSteps={safeAcceptedBreakdownSteps}
            pendingBreakdownProposal={
              pendingStructuredAction?.action === 'breakdown' && canUseRefinementActions
                ? {
                    proposalId: pendingStructuredAction.proposalId,
                    action: 'breakdown',
                    proposedSummary: pendingStructuredAction.proposedSummary,
                    explanation: pendingStructuredAction.explanation,
                  }
                : null
            }
            isAcceptingBreakdown={acceptBreakdownMutation.isPending}
            isRejectingBreakdown={rejectStructuredActionMutation.isPending}
            onAcceptBreakdown={(proposalId) => acceptBreakdownMutation.mutate(proposalId)}
            onRejectBreakdown={(proposalId) => rejectStructuredActionMutation.mutate(proposalId)}
            onCreateTaskFromStep={(stepId) => convertBreakdownStepToTaskMutation.mutate(stepId)}
            onCompleteStep={(stepId) => completeBreakdownStepMutation.mutate(stepId)}
            onUncompleteStep={(stepId) => uncompleteBreakdownStepMutation.mutate(stepId)}
            stepActionInFlight={stepActionInFlight}
            linkedStepIds={linkedStepIds}
            threadRegionId="thread-history-panel"
            showHeader={false}
            className="min-h-full rounded-[0] border-x-0 border-t-0 bg-transparent px-0 pb-0 pt-0 shadow-none"
          />
        </div>

        {!isThreadAtBottom ? (
          <button
            type="button"
            onClick={() => scrollThreadToBottom()}
            aria-label="Jump to latest message"
            className="absolute bottom-4 right-4 inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_88%,white_12%)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] shadow-[0_16px_34px_rgba(15,23,42,0.16)] backdrop-blur hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            Jump to latest
          </button>
        ) : null}
      </div>

      <form
        ref={composerRef}
        aria-label="Reply in thread"
        className="relative shrink-0 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_84%,white_16%)] px-4 pt-3 shadow-[0_-10px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onSubmit={handleDiscoverySubmit}
      >
        <label className="sr-only" htmlFor="idea-thread-reply">Reply in thread</label>
        <div className="flex items-end gap-2 rounded-[26px] border border-[var(--line)] bg-[var(--surface)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
          <button
            type="button"
            onClick={openCapture}
            aria-label="Reply with voice"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--ink-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            <Mic size={16} />
          </button>

          <div className="min-w-0 flex-1">
            <textarea
              id="idea-thread-reply"
              value={discoveryMessage}
              onChange={handleComposerChange}
              onFocus={() => setIsComposerExpanded((current) => current || discoveryMessage.length > 0)}
              onBlur={() => setIsComposerExpanded(discoveryMessage.trim().length > 72 || discoveryMessage.includes('\n'))}
              placeholder={latestAssistantQuestion ?? 'Add more context to this idea.'}
              rows={isComposerExpanded ? 3 : 1}
              className="max-h-32 min-h-11 w-full resize-none border-0 bg-transparent px-3 py-2 text-[var(--ink-strong)] outline-none transition placeholder:text-[var(--ink-faint)]"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  handleDiscoverySubmit(event as unknown as React.FormEvent<HTMLFormElement>)
                }
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitTurnMutation.isPending || discoveryMessage.trim().length === 0}
            aria-label={composerButtonLabel}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <SendHorizonal size={16} />
          </button>
        </div>

        {shouldShowComposerMeta ? (
          <div className="pt-2">
            {discoveryError ? (
              <p role="alert" aria-live="assertive" className="m-0 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {discoveryError}
              </p>
            ) : !discoveryError && discoveryNotice ? (
              <p aria-live="polite" className="m-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                {discoveryNotice}
              </p>
            ) : (
              <p aria-live="polite" className="m-0 px-1 text-sm leading-6 text-[var(--ink-soft)]">{composerStatusText}</p>
            )}
          </div>
        ) : null}
      </form>
    </section>
  )

  const chatSupportSurface = activeSupportTab === 'context'
    ? contextSurface
    : activeSupportTab === 'guided'
      ? reviewSurface
      : sourceSurface

  const supportSheet = isChatView ? (
    <>
      <div
        onClick={() => setIsSupportSheetOpen(false)}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${
          isSupportSheetOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        className={`fixed inset-x-0 bottom-0 z-50 duration-300 ${
          isSupportSheetOpen ? 'translate-y-0 opacity-100 transition-[transform,opacity]' : 'pointer-events-none translate-y-full opacity-0 transition-[transform,opacity]'
        }`}
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="panel rounded-t-[2rem] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold text-[var(--ink-strong)]">
                  {pageTabs.find((tab) => tab.id === activeSupportTab)?.label ?? 'Support'}
                </h2>
                <p className="m-0 mt-1 text-sm text-[var(--ink-strong)]">Inspect context, guided thread actions, or source input without leaving the thread.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSupportSheetOpen(false)}
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                Done
              </button>
            </div>

            <div
              className="scrollbar-none -mx-1 mb-4 flex items-stretch gap-1 overflow-x-auto px-1"
              role="tablist"
              aria-label="Support panels"
              style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
            >
              {supportTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSupportTab === tab.id}
                  onClick={() => setActiveSupportTab(tab.id)}
                  className={`inline-flex shrink-0 items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    activeSupportTab === tab.id
                      ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
                      : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="max-h-[60dvh] overflow-y-auto pr-1">
              {chatSupportSurface}
            </div>
          </div>
        </div>
      </div>
    </>
  ) : null

  if (isChatView) {
    return (
      <>
        <main className="flex h-[100dvh] flex-col overflow-hidden">
          {chatHeader}
          {threadSurface}
        </main>
        {supportSheet}
      </>
    )
  }

  return (
    <main className="page-wrap flex h-[calc(100dvh-4rem)] flex-col overflow-hidden px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-3 sm:pt-6 lg:h-auto lg:overflow-visible lg:pb-8">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Page header — core identity only: back, title, stage, star */}
        <section className="panel overflow-hidden rounded-[22px] px-3 py-2 sm:rounded-[28px] sm:px-4 sm:py-3.5">
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <Link to="/ideas" className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--brand)] no-underline hover:underline sm:text-xs">
                ← Ideas
              </Link>
              <h1 className="mt-0.5 text-[0.98rem] font-semibold leading-tight tracking-tight text-[var(--ink-strong)] sm:mt-1.5 sm:text-xl">
                {currentThreadTitle}
              </h1>
              <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 sm:flex">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                  <Lightbulb size={12} />
                  Discovery
                </div>
                <div className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${stageBadgeClassName}`}>
                  {stageLabel}
                </div>
              </div>
              <div className="mt-1.25 flex flex-wrap items-center gap-1.5 sm:hidden">
                <div className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${stageBadgeClassName}`}>
                  {stageLabel}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <div className="hidden rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)] sm:inline-flex">
                {threadStatusChipLabel}
              </div>
              <button
                type="button"
                onClick={() => toggleStarMutation.mutate()}
                aria-label={isIdeaStarred(idea) ? 'Remove star from idea' : 'Star idea'}
                className={`inline-flex size-9 items-center justify-center rounded-full border text-sm font-semibold transition ${
                  isIdeaStarred(idea)
                    ? 'border-amber-300 bg-amber-100/70 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                }`}
              >
                <Star size={14} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
                <span className="sr-only">{isIdeaStarred(idea) ? 'Starred' : 'Star idea'}</span>
              </button>
            </div>
          </div>
        </section>

        <div
          className="scrollbar-none sticky top-[4rem] z-30 -mx-4 flex items-stretch gap-0 overflow-x-auto border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-xl sm:top-[4.5rem]"
          role="tablist"
          aria-label="Idea sections"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
        >
          {pageTabs.map((tab) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activePageTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => setActivePageTab(tab.id)}
              className={`relative inline-flex shrink-0 items-center justify-center whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none sm:px-4 ${
                activePageTab === tab.id
                  ? 'text-[var(--brand)]'
                  : 'text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
              }`}
            >
              {tab.label}
              {activePageTab === tab.id ? (
                <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[var(--brand)]" />
              ) : null}
            </button>
          ))}
        </div>

        <div
          id={`tabpanel-${activePageTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activePageTab}`}
          className={activePageTab === 'thread' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}
        >
          {activeTabSurface}
        </div>
      </div>
    </main>
  )
}
