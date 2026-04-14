import { Lightbulb, Mic, Quote, SendHorizonal, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { useCaptureContext } from '../contexts/CaptureContext'
import { getIdeaExcerpt, isIdeaStarred } from '../lib/ideas'
import { parseIdeaThreadStreamFrames } from '../lib/idea-thread-stream'
import { getIdea, getIdeaThread, streamIdeaThread, submitIdeaThreadTurn, toggleIdeaStar } from '../server/ideas'

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
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const isThreadBusy = thread.status === 'queued' || thread.status === 'processing' || thread.status === 'streaming'
  const queuedTurnCount = thread.queuedTurns.length
  const latestQueuedTurn = thread.queuedTurns.at(-1) ?? null

  if (!idea) {
    throw notFound()
  }

  const latestAssistantQuestion = [...thread.visibleEvents]
    .reverse()
    .find((event) => event.type === 'assistant_question')?.summary ?? null

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
    onSuccess: async (result, message) => {
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
      return
    }

    const abortController = new AbortController()

    void (async () => {
      try {
        const response = await streamIdeaThread({ data: { id: ideaId }, signal: abortController.signal as never })

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
            if (payload.type === 'assistant_chunk') {
              setStreamingAssistantText((current) => `${current}${payload.textDelta}`)
              continue
            }

            if (payload.type === 'turn_completed' || payload.type === 'turn_failed') {
              setStreamingAssistantText('')
            }
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        setDiscoveryError(error instanceof Error ? error.message : 'Failed to subscribe to assistant stream.')
      }
    })()

    return () => {
      abortController.abort()
    }
  }, [ideaId, isThreadBusy])

  return (
    <main className="page-wrap pb-32 pt-8 lg:pb-16">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/ideas" className="text-sm font-medium text-[var(--brand)] no-underline hover:underline">
              Back to ideas
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ink-strong)]">
              {thread.workingIdea.provisionalTitle ?? idea.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-soft)]">
              {thread.workingIdea.currentSummary ?? (getIdeaExcerpt(idea, 260) || 'This idea is still in discovery.')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => toggleStarMutation.mutate()}
            aria-label={isIdeaStarred(idea) ? 'Remove star from idea' : 'Star idea'}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
              isIdeaStarred(idea)
                ? 'border-amber-300 bg-amber-100/70 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
            }`}
          >
            <Star size={16} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
            {isIdeaStarred(idea) ? 'Starred' : 'Star idea'}
          </button>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px]">
          <div className="space-y-4">
            <div className="panel rounded-[28px] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                    <Lightbulb size={14} />
                    Discovery thread
                  </div>
                  <p className="mt-3 mb-0 text-sm leading-6 text-[var(--ink-soft)]">
                    {isThreadBusy
                      ? thread.status === 'queued'
                        ? queuedTurnCount > 0
                          ? `${queuedTurnCount} replies are queued while the assistant finishes the current turn.`
                          : 'Your latest reply is queued behind the current turn.'
                        : thread.status === 'streaming'
                          ? 'The assistant is writing back in this thread now.'
                          : 'The assistant is processing the latest turn now.'
                      : latestAssistantQuestion
                      ? latestAssistantQuestion
                      : missingDiscoveryAreas.length > 0
                        ? `The biggest gaps right now are ${missingDiscoveryAreas.join(', ')}.`
                        : 'The working idea has enough context for a stronger framing pass.'}
                  </p>
                </div>

                <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium capitalize text-[var(--ink-soft)]">
                  Stage: {thread.stage}
                </div>
              </div>
            </div>

            <div className="space-y-4 pb-36 lg:pb-40">
              <IdeaThreadHistory
                visibleEvents={thread.visibleEvents}
                threadStatus={thread.status}
                activeTurn={thread.activeTurn}
                queuedTurns={thread.queuedTurns}
                lastTurn={thread.lastTurn}
              />
              {streamingAssistantText ? (
                <section className="panel rounded-[28px] border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-500/30 dark:bg-violet-500/10">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                    <Lightbulb size={14} />
                    Assistant reply streaming
                  </div>
                  <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">{streamingAssistantText}</p>
                </section>
              ) : null}
              <div ref={threadEndRef} />
            </div>

            <form
              className="panel sticky bottom-24 z-10 space-y-4 rounded-[28px] p-4 lg:bottom-6"
              onSubmit={handleDiscoverySubmit}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Reply in thread</div>
                  <div className="mt-1 text-sm text-[var(--ink-soft)]">
                    {thread.status === 'queued'
                      ? latestQueuedTurn
                        ? `Queued after the current turn: ${latestQueuedTurn.userMessage}`
                        : 'Your next reply will queue after the current turn.'
                      : thread.status === 'processing'
                        ? thread.activeTurn
                          ? `Assistant is working on: ${thread.activeTurn.userMessage}`
                          : 'Assistant is processing the latest reply.'
                        : thread.status === 'streaming'
                          ? 'Assistant is replying now. You can queue another follow-up if needed.'
                          : latestAssistantQuestion ?? 'Add the next piece of context and the assistant will continue the conversation.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openCapture}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 font-semibold text-[var(--ink-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  <Mic size={16} />
                  Voice reply
                </button>
              </div>

              <label className="block">
                <textarea
                  value={discoveryMessage}
                  onChange={(event) => setDiscoveryMessage(event.target.value)}
                  placeholder={latestAssistantQuestion ?? 'Add more context to this idea.'}
                  rows={3}
                  className="w-full rounded-[24px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
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

              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm text-[var(--ink-soft)]">Voice is preferred. Use `Cmd/Ctrl+Enter` to send typed replies.</p>
                <button
                  type="submit"
                  disabled={submitTurnMutation.isPending || discoveryMessage.trim().length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 py-3 font-semibold text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <SendHorizonal size={16} />
                  {submitTurnMutation.isPending ? 'Sending...' : isThreadBusy ? 'Queue reply' : 'Send reply'}
                </button>
              </div>
            </form>
          </div>

          <aside className="panel space-y-4 rounded-[28px] p-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Metadata</div>
              <dl className="mt-3 space-y-3 text-sm text-[var(--ink-soft)]">
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Source type</dt>
                  <dd>{idea.sourceType.replace('_', ' ')}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Created</dt>
                  <dd>{idea.createdAt.toLocaleString()}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Updated</dt>
                  <dd>{idea.updatedAt.toLocaleString()}</dd>
                </div>
                {idea.threadSummary ? (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="font-medium text-[var(--ink-strong)]">Saved summary</dt>
                    <dd>{idea.threadSummary}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

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
                        style={{ width: `${Math.max(12, (populatedWorkingIdeaEntries.length / 7) * 100)}%` }}
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

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
                <Quote size={15} className="text-[var(--brand)]" />
                Source input
              </div>
              <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-soft)]">
                {idea.sourceInput || 'No raw source input was stored for this idea.'}
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
