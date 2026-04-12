import { Lightbulb, Quote, Star } from 'lucide-react'
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { getIdeaExcerpt, isIdeaStarred } from '../lib/ideas'
import { getIdea, toggleIdeaStar } from '../server/ideas'

const ideaDetailQueryOptions = (ideaId: string) =>
  queryOptions({
    queryKey: ['ideas', ideaId],
    queryFn: () => getIdea({ data: { id: ideaId } }),
  })

export const Route = createFileRoute('/_authenticated/ideas/$ideaId')({
  loader: ({ context, params }) => {
    return context.queryClient.ensureQueryData(ideaDetailQueryOptions(params.ideaId))
  },
  component: IdeaDetailPage,
})

function IdeaDetailPage() {
  const { ideaId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaDetailQueryOptions(ideaId))

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
