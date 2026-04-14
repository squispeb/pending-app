import { Lightbulb, Mic, Quote, SendHorizonal, Sparkles, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { useCaptureContext } from '../contexts/CaptureContext'
import {
  canUseIdeaRefinementActions,
  getIdeaStructuredActionLabel,
  type IdeaRefinementAction,
  type IdeaRestructureAction,
} from '../lib/idea-structured-actions'
import { getIdeaExcerpt, getIdeaStageBadgeClassName, getIdeaStageLabel, isIdeaStarred } from '../lib/ideas'
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
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaDetailQueryOptions(ideaId))
  const { data: thread } = useSuspenseQuery(ideaThreadQueryOptions(ideaId))
  const { openCapture } = useCaptureContext()
  const [discoveryMessage, setDiscoveryMessage] = useState('')
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null)
  const [streamingAssistantText, setStreamingAssistantText] = useState('')
  const [dismissedRefinements, setDismissedRefinements] = useState<{ title: string | null; summary: string | null }>({
    title: null,
    summary: null,
  })
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const lastStreamEventIdRef = useRef<string | null>(null)
  const streamedEventIdsRef = useRef(new Set<string>())
  const activeStreamingTurnIdRef = useRef<string | null>(null)
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
  const threadRailHeading = streamingAssistantText
    ? 'Assistant replying'
    : latestAssistantEvent?.type === 'assistant_question'
      ? 'Latest prompt'
      : latestAssistantEvent?.type === 'assistant_synthesis'
        ? 'Latest synthesis'
        : 'Discovery guide'
  const threadRailBody = streamingAssistantText
    ? 'Watch the live assistant reply in the thread below.'
    : latestAssistantEvent?.summary ?? threadRailMessage
  const mobileDetailsSummary = pendingStructuredAction
    ? 'Structured output ready to review.'
    : suggestedTitle || suggestedSummary
      ? 'Refinement suggestions ready to review.'
      : `${populatedWorkingIdeaEntries.length}/7 discovery areas captured.`

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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread.visibleEvents.length, streamingAssistantText])

  useEffect(() => {
    if (!isThreadBusy) {
      setStreamingAssistantText('')
      lastStreamEventIdRef.current = null
      activeStreamingTurnIdRef.current = null
      streamedEventIdsRef.current.clear()
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
                activeStreamingTurnIdRef.current = payload.turnId
                setStreamingAssistantText('')
                continue
              }

              if (payload.type === 'assistant_chunk') {
                if (activeStreamingTurnIdRef.current !== payload.turnId) {
                  activeStreamingTurnIdRef.current = payload.turnId
                  setStreamingAssistantText(payload.textDelta)
                  continue
                }

                setStreamingAssistantText((current) => `${current}${payload.textDelta}`)
                continue
              }

              if (payload.type === 'turn_completed' || payload.type === 'turn_failed') {
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

  const detailPanels = (
    <>
      {canUseRefinementActions ? (
        <section className="panel rounded-[28px] border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-500/30 dark:bg-sky-500/10 sm:p-5">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Refine and structure</div>
              <p className="m-0 mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                Keep using the thread as the main workspace, then open targeted review actions when you want to tighten wording or request a more structured output.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {(['title', 'summary'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={isThreadBusy || requestRefinementMutation.isPending || persistRefinementMutation.isPending}
                  onClick={() => requestRefinementMutation.mutate(action)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
                >
                  {getIdeaStructuredActionLabel(action)}
                </button>
              ))}
              {(['restructure', 'breakdown'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={isThreadBusy || requestRefinementMutation.isPending || requestStructuredActionMutation.isPending || persistRefinementMutation.isPending}
                  onClick={() => requestStructuredActionMutation.mutate(action)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 transition hover:border-violet-300 hover:text-violet-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
                >
                  {getIdeaStructuredActionLabel(action)}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel rounded-[28px] p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Idea details</div>
        <div className="mt-3 space-y-4 text-sm text-[var(--ink-soft)]">
          <div>
            <div className="font-medium text-[var(--ink-strong)]">Description</div>
            <p className="m-0 mt-1 whitespace-pre-wrap leading-6">{idea.body || 'No description has been saved yet.'}</p>
          </div>
          <div>
            <div className="font-medium text-[var(--ink-strong)]">Saved summary</div>
            <p className="m-0 mt-1 whitespace-pre-wrap leading-6">{idea.threadSummary ?? 'No saved summary yet.'}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <dt className="font-medium text-[var(--ink-strong)]">Stage</dt>
              <dd className="mt-1">{stageLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink-strong)]">Source type</dt>
              <dd className="mt-1">{idea.sourceType.replace('_', ' ')}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink-strong)]">Created</dt>
              <dd className="mt-1">{idea.createdAt.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink-strong)]">Updated</dt>
              <dd className="mt-1">{idea.updatedAt.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Working idea</div>
        <dl className="space-y-3 text-sm text-[var(--ink-soft)]">
          <div>
            <dt className="font-medium text-[var(--ink-strong)]">Provisional title</dt>
            <dd className="mt-1">{thread.workingIdea.provisionalTitle ?? idea.title}</dd>
          </div>
          {populatedWorkingIdeaEntries.map(([label, value]) => (
            <div key={label}>
              <dt className="font-medium text-[var(--ink-strong)]">{label}</dt>
              <dd className="mt-1">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="font-medium text-[var(--ink-strong)]">Discovery progress</dt>
            <dd className="mt-2">
              <div className="h-2 rounded-full bg-[var(--surface-strong)]">
                <div
                  className="h-2 rounded-full bg-[var(--brand)]"
                  style={{ width: `${discoveryProgressPercent}%` }}
                />
              </div>
              <p className="m-0 mt-2 text-sm text-[var(--ink-soft)]">
                {missingDiscoveryAreas.length === 0
                  ? 'All tracked discovery areas have initial context.'
                  : `${missingDiscoveryAreas.length} areas still need more context: ${missingDiscoveryAreas.join(', ')}.`}
              </p>
            </dd>
          </div>
        </dl>
      </div>

      {canUseRefinementActions && (suggestedTitle || suggestedSummary) ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Suggested refinements</div>
          <div className="space-y-4 text-sm text-[var(--ink-soft)]">
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
          <div className="space-y-4 text-sm text-[var(--ink-soft)]">
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

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
          <Quote size={15} className="text-[var(--brand)]" />
          Source input
        </div>
        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-soft)]">
          {idea.sourceInput || 'No raw source input was stored for this idea.'}
        </p>
      </div>
    </>
  )

  return (
    <main className="page-wrap px-4 pb-28 pt-5 sm:pt-7 lg:pb-16">
      <div className="space-y-4">
        <section className="panel overflow-hidden rounded-[32px] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link to="/ideas" className="text-sm font-medium text-[var(--brand)] no-underline hover:underline">
                Back to ideas
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  <Lightbulb size={14} />
                  Discovery thread
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${stageBadgeClassName}`}>
                  {stageLabel}
                </div>
                <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)]">
                  {threadStatusChipLabel}
                </div>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--ink-strong)] sm:text-3xl">
                {thread.workingIdea.provisionalTitle ?? idea.title}
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
                {thread.workingIdea.currentSummary ?? (getIdeaExcerpt(idea, 260) || 'This idea is still in discovery.')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => toggleStarMutation.mutate()}
              aria-label={isIdeaStarred(idea) ? 'Remove star from idea' : 'Star idea'}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition sm:w-auto ${
                isIdeaStarred(idea)
                  ? 'border-amber-300 bg-amber-100/70 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
              }`}
            >
              <Star size={16} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
              {isIdeaStarred(idea) ? 'Starred' : 'Star idea'}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-[var(--ink-soft)]">
            <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1">
              {populatedWorkingIdeaEntries.length}/7 discovery areas captured
            </div>
            <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1">
              {missingDiscoveryAreas.length === 0 ? 'No major discovery gaps' : `${missingDiscoveryAreas.length} gaps left to cover`}
            </div>
            {pendingStructuredAction ? (
              <div className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
                Structured review ready
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] px-4 py-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl ${threadRailHeading === 'Latest prompt' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : threadRailHeading === 'Latest synthesis' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-[var(--chip-bg)] text-[var(--brand)]'}`}>
                <Sparkles size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">{threadRailHeading}</div>
                <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">{threadRailBody}</p>
                {!streamingAssistantText ? (
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--ink-soft)]">{threadRailMessage}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 lg:hidden">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Details and review</div>
              <div className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{mobileDetailsSummary}</div>
            </div>
            <button
              type="button"
              aria-expanded={isMobileDetailsOpen}
              aria-controls="idea-thread-details"
              onClick={() => setIsMobileDetailsOpen((current) => !current)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            >
              {isMobileDetailsOpen ? 'Hide details' : 'Show details'}
            </button>
          </div>
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <div className="space-y-4">
            {isMobileDetailsOpen ? (
              <section id="idea-thread-details" className="space-y-4 lg:hidden">
                {detailPanels}
              </section>
            ) : null}

            <div className="space-y-4 pb-40 lg:pb-40">
              <IdeaThreadHistory
                visibleEvents={thread.visibleEvents}
                threadStatus={thread.status}
                activeTurn={thread.activeTurn}
                queuedTurns={thread.queuedTurns}
                lastTurn={thread.lastTurn}
                streamingAssistantText={streamingAssistantText}
              />
              <div ref={threadEndRef} />
            </div>

            <form
              className="panel sticky bottom-20 z-10 space-y-4 rounded-[28px] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_84%,white_16%)] p-4 shadow-[0_22px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl lg:bottom-6"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              onSubmit={handleDiscoverySubmit}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Reply in thread</div>
                  <div className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{composerStatusText}</div>
                </div>
                <button
                  type="button"
                  onClick={openCapture}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 font-semibold text-[var(--ink-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] sm:w-auto"
                >
                  <Mic size={16} />
                  Voice reply
                </button>
              </div>

              <label className="block" htmlFor="idea-thread-reply">
                <span className="sr-only">Reply in thread</span>
                <textarea
                  id="idea-thread-reply"
                  value={discoveryMessage}
                  onChange={(event) => setDiscoveryMessage(event.target.value)}
                  placeholder={latestAssistantQuestion ?? 'Add more context to this idea.'}
                  rows={3}
                  className="w-full resize-none rounded-[24px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      handleDiscoverySubmit(event as unknown as React.FormEvent<HTMLFormElement>)
                    }
                  }}
                />
              </label>

              {discoveryError ? (
                <p className="m-0 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                  {discoveryError}
                </p>
              ) : null}

              {!discoveryError && discoveryNotice ? (
                <p className="m-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                  {discoveryNotice}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">Voice is preferred. Use `Cmd/Ctrl+Enter` to send typed replies.</p>
                <button
                  type="submit"
                  disabled={submitTurnMutation.isPending || discoveryMessage.trim().length === 0}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 py-3 font-semibold text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
                >
                  <SendHorizonal size={16} />
                  {submitTurnMutation.isPending ? 'Sending...' : isThreadBusy ? 'Queue reply' : 'Send reply'}
                </button>
              </div>
            </form>
          </div>

          <aside className="hidden space-y-4 lg:block">
            {detailPanels}
          </aside>
        </section>
      </div>
    </main>
  )
}
