import { Compass, Lightbulb, Quote, SendHorizonal, Star } from 'lucide-react'
import { useState } from 'react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { getIdeaExcerpt, isIdeaStarred } from '../lib/ideas'
import { getIdea, getIdeaThread, submitIdeaThreadTurn, toggleIdeaStar } from '../server/ideas'

const ideaDetailQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['ideas', ideaId],
    queryFn: () => getIdea({ data: { id: ideaId } }),
  })

const ideaThreadQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['idea-thread', ideaId],
    queryFn: () => getIdeaThread({ data: { id: ideaId } }),
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
  const [discoveryMessage, setDiscoveryMessage] = useState('')
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)

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
    onSuccess: async () => {
      setDiscoveryMessage('')
      setDiscoveryError(null)
      await queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] })
    },
    onError: (error) => {
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
    submitTurnMutation.mutate(message)
  }

  return (
    <main className="page-wrap pb-28 pt-8 lg:pb-16">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/ideas" className="text-sm font-medium text-[var(--brand)] no-underline hover:underline">
              Back to ideas
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ink-strong)]">{thread.workingIdea.provisionalTitle ?? idea.title}</h1>
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
                : 'border-[var(--line)] bg-[var(--panel)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
            }`}
          >
            <Star size={16} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
            {isIdeaStarred(idea) ? 'Starred' : 'Star idea'}
          </button>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_320px]">
          <div className="space-y-6">
            <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                <Lightbulb size={14} />
                Working idea
              </div>

              <div className="space-y-4 text-sm leading-7 text-[var(--ink-soft)]">
                {idea.body ? (
                  idea.body.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index} className="m-0 whitespace-pre-wrap">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="m-0">This idea is still in discovery. The thread and working idea panel should accumulate the missing context over time.</p>
                )}
              </div>
            </article>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  <Compass size={14} />
                  Discovery guidance
                </div>
                <h2 className="mt-3 text-lg font-semibold text-[var(--ink-strong)]">Develop the idea through discovery</h2>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  This thread is now the primary workspace for building context. The assistant should help uncover the purpose, scope, users, impact, research areas, constraints, and open questions behind the idea.
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="text-sm font-medium text-[var(--ink-strong)]">Current stage</div>
                <p className="mt-2 m-0 text-sm leading-6 text-[var(--ink-soft)]">
                  {thread.stage === 'discovery'
                    ? 'The assistant should ask focused questions and help collect missing context before any later structured actions are introduced.'
                    : thread.stage === 'framing'
                      ? 'The assistant has enough context to organize and frame the idea more clearly.'
                      : 'The idea has enough context for later structured actions and conversions if needed.'}
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="text-sm font-medium text-[var(--ink-strong)]">
                  {latestAssistantQuestion ? 'Latest assistant question' : 'Next discovery focus'}
                </div>
                <p className="mt-2 m-0 text-sm leading-6 text-[var(--ink-soft)]">
                  {latestAssistantQuestion
                    ? latestAssistantQuestion
                    : missingDiscoveryAreas.length > 0
                      ? `The biggest gaps right now are ${missingDiscoveryAreas.join(', ')}.`
                      : 'The working idea has enough context for a stronger framing pass.'}
                </p>
              </div>

              <form className="mt-4 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4" onSubmit={handleDiscoverySubmit}>
                <label className="block text-sm font-medium text-[var(--ink-soft)]">
                  Add context to the thread
                  <textarea
                    value={discoveryMessage}
                    onChange={(event) => setDiscoveryMessage(event.target.value)}
                    placeholder={latestAssistantQuestion ?? 'Describe the purpose, users, impact, scope, research needs, constraints, or open questions for this idea.'}
                    rows={4}
                    className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
                  />
                </label>

                {discoveryError ? (
                  <p className="m-0 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                    {discoveryError}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="m-0 text-sm text-[var(--ink-soft)]">
                    Reply in your own words. Each turn updates the working idea and the next assistant question.
                  </p>
                  <button
                    type="submit"
                    disabled={submitTurnMutation.isPending || discoveryMessage.trim().length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 py-3 font-semibold text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <SendHorizonal size={16} />
                    {submitTurnMutation.isPending ? 'Sending...' : 'Send reply'}
                  </button>
                </div>
              </form>
            </section>

            <IdeaThreadHistory visibleEvents={thread.visibleEvents} />
          </div>

          <aside className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Metadata</div>
              <dl className="mt-3 space-y-3 text-sm text-[var(--ink-soft)]">
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Stage</dt>
                  <dd className="capitalize">{thread.stage}</dd>
                </div>
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
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Thread summary</dt>
                  <dd>{thread.workingIdea.currentSummary ?? idea.threadSummary ?? 'Not available yet'}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Working idea</div>
              <dl className="space-y-3 text-sm text-[var(--ink-soft)]">
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Provisional title</dt>
                  <dd className="mt-1">{thread.workingIdea.provisionalTitle ?? idea.title}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Purpose</dt>
                  <dd className="mt-1">{thread.workingIdea.purpose ?? 'Still being discovered.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Scope</dt>
                  <dd className="mt-1">{thread.workingIdea.scope ?? 'Still being discovered.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Expected impact</dt>
                  <dd className="mt-1">{thread.workingIdea.expectedImpact ?? 'Still being discovered.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Target users</dt>
                  <dd className="mt-1">{thread.workingIdea.targetUsers.length > 0 ? thread.workingIdea.targetUsers.join(', ') : 'Still being discovered.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Research areas</dt>
                  <dd className="mt-1">{thread.workingIdea.researchAreas.length > 0 ? thread.workingIdea.researchAreas.join(', ') : 'None identified yet.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Constraints</dt>
                  <dd className="mt-1">{thread.workingIdea.constraints.length > 0 ? thread.workingIdea.constraints.join(', ') : 'No constraints captured yet.'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-strong)]">Open questions</dt>
                  <dd className="mt-1">{thread.workingIdea.openQuestions.length > 0 ? thread.workingIdea.openQuestions.join(', ') : 'No open questions captured yet.'}</dd>
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
