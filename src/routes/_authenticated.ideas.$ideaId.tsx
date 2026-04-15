import { Lightbulb, Mic, Quote, SendHorizonal, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { useCaptureContext } from '../contexts/CaptureContext'
import { formatDisplayDateTime } from '../lib/date-time'
import {
  canUseIdeaRefinementActions,
  getIdeaStructuredActionLabel,
  type IdeaRefinementAction,
  type IdeaRestructureAction,
} from '../lib/idea-structured-actions'
import { getIdeaStageBadgeClassName, getIdeaStageLabel, isIdeaStarred } from '../lib/ideas'
import { parseIdeaThreadStreamFrames } from '../lib/idea-thread-stream'
import {
  acceptIdeaStructuredAction,
  getIdea,
  getIdeaThread,
  persistIdeaRefinement,
  rejectIdeaStructuredAction,
  requestIdeaRefinement,
  requestIdeaStructuredAction,
  streamIdeaThread,
  submitIdeaThreadTurn,
  toggleIdeaStar,
} from '../server/ideas'

type IdeaPageTab = 'thread' | 'context' | 'review' | 'source'
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

export const Route = createFileRoute('/_authenticated/ideas/$ideaId')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === 'default' ? 'default' : 'chat',
  }),
  loader: ({ context, params }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(ideaDetailQueryOptions(params.ideaId)),
      context.queryClient.ensureQueryData(ideaThreadQueryOptions(params.ideaId)),
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
  const isThreadBusy = thread.status === 'queued' || thread.status === 'processing' || thread.status === 'streaming'
  const queuedTurnCount = thread.queuedTurns.length
  const latestQueuedTurn = thread.queuedTurns.at(-1) ?? null

  if (!idea) {
    throw notFound()
  }

  const canUseRefinementActions = canUseIdeaRefinementActions(thread.stage)
  const suggestedTitle = thread.workingIdea.provisionalTitle
    && thread.workingIdea.provisionalTitle !== idea.title
    && thread.workingIdea.provisionalTitle !== dismissedRefinements.title
    ? thread.workingIdea.provisionalTitle
    : null
  const suggestedSummary = thread.workingIdea.currentSummary
    && thread.workingIdea.currentSummary !== idea.threadSummary
    && thread.workingIdea.currentSummary !== dismissedRefinements.summary
    ? thread.workingIdea.currentSummary
    : null
  const pendingStructuredAction = thread.pendingStructuredAction ?? null

  const latestAssistantEvent = [...thread.visibleEvents]
    .reverse()
    .find((event) => event.type === 'assistant_question' || event.type === 'assistant_synthesis') ?? null
  const latestAssistantQuestion = latestAssistantEvent?.type === 'assistant_question' ? latestAssistantEvent.summary : null
  const currentThreadTitle = thread.workingIdea.provisionalTitle ?? idea.title
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
    !thread.workingIdea.purpose ? 'purpose' : null,
    thread.workingIdea.targetUsers.length === 0 ? 'users' : null,
    !thread.workingIdea.expectedImpact ? 'impact' : null,
    !thread.workingIdea.scope ? 'scope' : null,
    thread.workingIdea.researchAreas.length === 0 ? 'research' : null,
    thread.workingIdea.constraints.length === 0 ? 'constraints' : null,
    thread.workingIdea.openQuestions.length === 0 ? 'open questions' : null,
  ].filter((value): value is string => value !== null)

  const populatedWorkingIdeaEntries = [
    thread.workingIdea.purpose ? ['Purpose', thread.workingIdea.purpose] : null,
    thread.workingIdea.scope ? ['Scope', thread.workingIdea.scope] : null,
    thread.workingIdea.expectedImpact ? ['Expected impact', thread.workingIdea.expectedImpact] : null,
    thread.workingIdea.targetUsers.length > 0 ? ['Target users', thread.workingIdea.targetUsers.join(', ')] : null,
    thread.workingIdea.researchAreas.length > 0 ? ['Research areas', thread.workingIdea.researchAreas.join(', ')] : null,
    thread.workingIdea.constraints.length > 0 ? ['Constraints', thread.workingIdea.constraints.join(', ')] : null,
    thread.workingIdea.openQuestions.length > 0 ? ['Open questions', thread.workingIdea.openQuestions.join(', ')] : null,
  ].filter((entry): entry is [string, string] => entry !== null)
  const stageLabel = getIdeaStageLabel(thread.stage)
  const stageBadgeClassName = getIdeaStageBadgeClassName(thread.stage)
  const discoveryProgressPercent = Math.max(12, (populatedWorkingIdeaEntries.length / 7) * 100)
  const isThreadTabActive = activePageTab === 'thread'
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
  const shouldShowComposerMeta = Boolean(discoveryError || discoveryNotice || isThreadBusy)
  const pageTabs = [
    { id: 'thread', label: 'Thread' },
    { id: 'context', label: 'Context' },
    { id: 'review', label: `Review${reviewItemCount > 0 ? ` (${reviewItemCount})` : ''}` },
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
      setDiscoveryNotice(action === 'title' ? 'Title suggestion ready to review.' : 'Summary suggestion ready to review.')
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
      setDiscoveryNotice(action === 'restructure' ? 'Restructured view ready to review.' : 'Next-step breakdown ready to review.')
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
      setDiscoveryNotice(kind === 'title' ? 'Saved suggested title.' : 'Saved suggested summary.')
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
      setDiscoveryNotice('Accepted the structured output in this thread.')
      queryClient.setQueryData(['idea-thread', ideaId], thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to accept the structured output.')
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
      setDiscoveryNotice('Rejected the structured output and kept the current thread state.')
      queryClient.setQueryData(['idea-thread', ideaId], thread)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
      setDiscoveryNotice(null)
      setDiscoveryError(error instanceof Error ? error.message : 'Failed to reject the structured output.')
    },
  })

  const refineActionsDisabled = isThreadBusy || requestRefinementMutation.isPending || persistRefinementMutation.isPending
  const structuredActionsDisabled = isThreadBusy || requestRefinementMutation.isPending || requestStructuredActionMutation.isPending || persistRefinementMutation.isPending

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
  }, [activePageTab, isThreadAtBottom, thread.visibleEvents.length, streamingAssistantText])

  useEffect(() => {
    if (activePageTab !== 'thread') {
      return
    }

    handleThreadViewportScroll()
  }, [activePageTab, thread.visibleEvents.length, streamingAssistantText])

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
    <section className="subpanel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Context</div>
          <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-soft)]">
            Supporting context captured alongside this thread.
          </p>
        </div>
        <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">
          {populatedWorkingIdeaEntries.length}/7
        </div>
      </div>

      <div className="space-y-4 text-sm text-[var(--ink-soft)]">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Saved framing</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Title</div>
                <div className="mt-1">{idea.title}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Summary</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{idea.threadSummary ?? 'No saved summary yet.'}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Description</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{idea.body || 'No description has been saved yet.'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">Working state</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Working title</div>
                <div className="mt-1">{thread.workingIdea.provisionalTitle ?? idea.title}</div>
              </div>
              <div>
                <div className="font-medium text-[var(--ink-strong)]">Working summary</div>
                <div className="mt-1 whitespace-pre-wrap leading-6">{thread.workingIdea.currentSummary ?? 'No working summary yet.'}</div>
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
    <section className="subpanel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Review</div>
          <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-soft)]">Refinement suggestions and structured actions.</p>
        </div>
        <div className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
          {reviewItemCount} item{reviewItemCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="space-y-4 text-sm text-[var(--ink-soft)]">
        {canUseRefinementActions ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-500/30 dark:bg-sky-500/10">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Refine and structure</div>
            <p className="m-0 mt-2 leading-6 text-[var(--ink-soft)]">
              Keep using the thread as the main workspace, then open targeted review actions when you want to tighten wording or request a more structured output.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(['title', 'summary'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={refineActionsDisabled}
                  onClick={() => requestRefinementMutation.mutate(action)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold leading-none text-slate-900 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500/30 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:border-slate-400/60 dark:hover:bg-slate-900/50 dark:hover:text-white"
                >
                  {getIdeaStructuredActionLabel(action)}
                </button>
              ))}
              {(['restructure', 'breakdown'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={structuredActionsDisabled}
                  onClick={() => requestStructuredActionMutation.mutate(action)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold leading-none text-slate-900 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500/30 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:border-slate-400/60 dark:hover:bg-slate-900/50 dark:hover:text-white"
                >
                  {getIdeaStructuredActionLabel(action)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="font-medium text-[var(--ink-strong)]">Review unlocks later in discovery</div>
            <p className="m-0 mt-2 leading-6">Keep adding context in the thread until the idea is developed enough for refinements and structured review.</p>
          </div>
        )}

        {canUseRefinementActions && (suggestedTitle || suggestedSummary) ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Suggested refinements</div>
            <div className="space-y-4">
              {suggestedTitle ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Title suggestion</div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Current</div>
                    <div className="mt-1">{idea.title}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="text-xs uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Suggested</div>
                    <div className="mt-1 text-[var(--ink-strong)]">{suggestedTitle}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isThreadBusy || persistRefinementMutation.isPending}
                      onClick={() => persistRefinementMutation.mutate('title')}
                      className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save title
                    </button>
                    <button
                      type="button"
                      disabled={persistRefinementMutation.isPending}
                      onClick={() => {
                        setDismissedRefinements((current) => ({
                          ...current,
                          title: suggestedTitle,
                        }))
                        setDiscoveryNotice('Kept the current title.')
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Keep current title
                    </button>
                  </div>
                </div>
              ) : null}

              {suggestedSummary ? (
                <div className="space-y-2">
                  <div className="font-medium text-[var(--ink-strong)]">Summary suggestion</div>
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Current</div>
                    <div className="mt-1 whitespace-pre-wrap">{idea.threadSummary ?? 'No saved summary yet.'}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="text-xs uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Suggested</div>
                    <div className="mt-1 whitespace-pre-wrap text-[var(--ink-strong)]">{suggestedSummary}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isThreadBusy || persistRefinementMutation.isPending}
                      onClick={() => persistRefinementMutation.mutate('summary')}
                      className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save summary
                    </button>
                    <button
                      type="button"
                      disabled={persistRefinementMutation.isPending}
                      onClick={() => {
                        setDismissedRefinements((current) => ({
                          ...current,
                          summary: suggestedSummary,
                        }))
                        setDiscoveryNotice('Kept the current summary.')
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Keep current summary
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {canUseRefinementActions && pendingStructuredAction ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
            <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Structured outputs</div>
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
                    <button
                      type="button"
                      disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending}
                      onClick={() => acceptStructuredActionMutation.mutate(pendingStructuredAction.proposalId)}
                      className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Accept restructure
                    </button>
                    <button
                      type="button"
                      disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending}
                      onClick={() => rejectStructuredActionMutation.mutate(pendingStructuredAction.proposalId)}
                      className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject restructure
                    </button>
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
                    <button
                      type="button"
                      disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending}
                      onClick={() => acceptStructuredActionMutation.mutate(pendingStructuredAction.proposalId)}
                      className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Accept breakdown
                    </button>
                    <button
                      type="button"
                      disabled={acceptStructuredActionMutation.isPending || rejectStructuredActionMutation.isPending}
                      onClick={() => rejectStructuredActionMutation.mutate(pendingStructuredAction.proposalId)}
                      className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject breakdown
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )

  const sourceSurface = (
    <section className="subpanel rounded-[28px] p-4 sm:p-5">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Source</div>
        <p className="m-0 mt-0.5 text-sm leading-6 text-[var(--ink-soft)]">Original captured input, separated from the chat so it stays available without crowding the workspace.</p>
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
            <p className="m-0 min-w-0 flex-1 text-[13px] leading-6 text-[var(--ink-soft)] sm:text-sm">
              {currentThreadSubtitle}
            </p>
            <div className="inline-flex shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)] sm:hidden">
              {threadStatusChipLabel}
            </div>
          </div>

          {/* Chat unit: scroll area + composer together, no overlay */}
          <div className="idea-thread-shell flex min-h-0 flex-1 flex-col gap-0 rounded-[28px]">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[28px]">
              <div
                ref={threadViewportRef}
                onScroll={handleThreadViewportScroll}
                aria-label="Thread messages"
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
              >
                <IdeaThreadHistory
                  visibleEvents={thread.visibleEvents}
                  threadStatus={thread.status}
                  activeTurn={thread.activeTurn}
                  queuedTurns={thread.queuedTurns}
                  lastTurn={thread.lastTurn}
                  streamingAssistantText={streamingAssistantText}
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
      : activePageTab === 'review'
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
              setActiveSupportTab(reviewItemCount > 0 ? 'review' : 'context')
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
          <IdeaThreadHistory
            visibleEvents={thread.visibleEvents}
            threadStatus={thread.status}
            activeTurn={thread.activeTurn}
            queuedTurns={thread.queuedTurns}
            lastTurn={thread.lastTurn}
            streamingAssistantText={streamingAssistantText}
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
        className="shrink-0 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_84%,white_16%)] px-4 pt-3 shadow-[0_-10px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl"
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

  const activeSupportSurface = activePageTab === 'context'
    ? contextSurface
    : activePageTab === 'review'
      ? reviewSurface
      : sourceSurface
  const chatSupportSurface = activeSupportTab === 'context'
    ? contextSurface
    : activeSupportTab === 'review'
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
                <p className="m-0 mt-1 text-sm text-[var(--ink-soft)]">Inspect context, review items, or source input without leaving the thread.</p>
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
        <section className="subpanel overflow-hidden rounded-[22px] px-3 py-2 sm:rounded-[28px] sm:px-4 sm:py-3.5">
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
