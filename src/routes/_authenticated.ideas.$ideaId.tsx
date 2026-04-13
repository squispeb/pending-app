import { Lightbulb, Quote, Sparkles, Star } from 'lucide-react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { IdeaThreadHistory } from '../components/idea-thread-history'
import { getIdeaExcerpt, isIdeaStarred } from '../lib/ideas'
import { approveIdeaProposal, elaborateIdea, getIdea, getIdeaThread, rejectIdeaProposal, toggleIdeaStar } from '../server/ideas'

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

  if (!idea) {
    throw notFound()
  }

  const toggleStarMutation = useMutation({
    mutationFn: async () => toggleIdeaStar({ data: { id: idea.id } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: ['ideas', ideaId] }),
      ])
    },
  })

  const invalidateIdeaThread = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ideas'] }),
      queryClient.invalidateQueries({ queryKey: ['ideas', ideaId] }),
      queryClient.invalidateQueries({ queryKey: ['idea-thread', ideaId] }),
    ])

  const elaborateMutation = useMutation({
    mutationFn: async () => elaborateIdea({ data: { id: ideaId, actionInput: null } }),
    onSuccess: async () => {
      await invalidateIdeaThread()
    },
  })

  const approveMutation = useMutation({
    mutationFn: async (proposalId: string) =>
      approveIdeaProposal({
        data: {
          id: ideaId,
          proposalId,
          expectedSnapshotVersion: thread.pendingProposal?.basedOnSnapshotVersion ?? 1,
        },
      }),
    onSuccess: async () => {
      await invalidateIdeaThread()
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async (proposalId: string) => rejectIdeaProposal({ data: { id: ideaId, proposalId } }),
    onSuccess: async () => {
      await invalidateIdeaThread()
    },
  })

  return (
    <main className="page-wrap pb-28 pt-8 lg:pb-16">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/ideas" className="text-sm font-medium text-[var(--brand)] no-underline hover:underline">
              Back to ideas
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ink-strong)]">{idea.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-soft)]">{getIdeaExcerpt(idea, 260) || 'This idea does not have extra detail yet.'}</p>
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
                Idea notes
              </div>

              <div className="space-y-4 text-sm leading-7 text-[var(--ink-soft)]">
                {idea.body ? (
                  idea.body.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index} className="m-0 whitespace-pre-wrap">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="m-0">No detailed notes yet. This slice establishes the canonical idea record and vault surface so refinement can land here later.</p>
                )}
              </div>
            </article>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                    <Sparkles size={14} />
                    Refinement
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-[var(--ink-strong)]">Elaborate this idea</h2>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    Ask the assistant to expand this idea into a clearer opportunity without changing the accepted idea until you approve it.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => elaborateMutation.mutate()}
                  disabled={elaborateMutation.isPending || thread.status === 'awaiting_approval'}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 py-3 font-semibold text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Sparkles size={16} />
                  {elaborateMutation.isPending ? 'Generating proposal...' : 'Elaborate idea'}
                </button>
              </div>

              {thread.pendingProposal ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink-strong)]">Pending proposal</div>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{thread.pendingProposal.explanation}</p>
                    </div>
                    <div className="text-xs text-[var(--ink-faint)]">Based on snapshot v{thread.pendingProposal.basedOnSnapshotVersion}</div>
                  </div>

                  <div className="mt-4 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Proposed title</div>
                      <div className="mt-2 text-sm font-medium text-[var(--ink-strong)]">{thread.pendingProposal.proposedTitle ?? idea.title}</div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Proposed summary</div>
                      <p className="mt-2 m-0 text-sm leading-6 text-[var(--ink-soft)]">{thread.pendingProposal.proposedSummary ?? 'No summary change proposed.'}</p>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Proposed body</div>
                      <p className="mt-2 m-0 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-soft)]">
                        {thread.pendingProposal.proposedBody ?? 'No body change proposed.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => approveMutation.mutate(thread.pendingProposal!.proposalId)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {approveMutation.isPending ? 'Applying...' : 'Approve proposal'}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectMutation.mutate(thread.pendingProposal!.proposalId)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--ink-strong)] transition hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {rejectMutation.isPending ? 'Rejecting...' : 'Reject proposal'}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <IdeaThreadHistory visibleEvents={thread.visibleEvents} />
          </div>

          <aside className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
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
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-[var(--ink-strong)]">Thread summary</dt>
                  <dd>{idea.threadSummary ?? 'Not available yet'}</dd>
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
