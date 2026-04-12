import { useState } from 'react'
import { Lightbulb, Plus, Sparkles, Star } from 'lucide-react'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getIdeaExcerpt, ideaFormSchema, isIdeaStarred, toIdeaFormValues, type IdeaFormValues } from '../lib/ideas'
import { createIdea, listIdeas, toggleIdeaStar } from '../server/ideas'

const ideasQueryOptions = () =>
  queryOptions({
    queryKey: ['ideas'],
    queryFn: () => listIdeas(),
  })

export const Route = createFileRoute('/ideas')({
  beforeLoad: async ({ context, location }) => {
    if (context.auth.state !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  loader: ({ context }) => {
    return context.queryClient.ensureQueryData(ideasQueryOptions())
  },
  component: IdeasPage,
})

const EMPTY_FORM = toIdeaFormValues(null)

function IdeasPage() {
  const queryClient = useQueryClient()
  const { data: ideas } = useSuspenseQuery(ideasQueryOptions())
  const [formValues, setFormValues] = useState<IdeaFormValues>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof IdeaFormValues, string>>>({})

  const invalidateIdeas = () => queryClient.invalidateQueries({ queryKey: ['ideas'] })

  const createIdeaMutation = useMutation({
    mutationFn: async (values: IdeaFormValues) => {
      const parsed = ideaFormSchema.parse(values)
      return createIdea({ data: parsed })
    },
    onSuccess: async () => {
      setFormValues(EMPTY_FORM)
      setFormError(null)
      setFieldErrors({})
      await invalidateIdeas()
    },
    onError: (error) => {
      if (error instanceof z.ZodError) {
        const flattened = error.flatten().fieldErrors
        setFieldErrors({
          title: flattened.title?.[0],
          body: flattened.body?.[0],
          sourceInput: flattened.sourceInput?.[0],
        })
        setFormError('Fix the highlighted fields and try again.')
        return
      }

      setFormError(error instanceof Error ? error.message : 'Failed to create idea.')
    },
  })

  const toggleStarMutation = useMutation({
    mutationFn: async (id: string) => toggleIdeaStar({ data: { id } }),
    onSuccess: async (_, ideaId) => {
      await Promise.all([
        invalidateIdeas(),
        queryClient.invalidateQueries({ queryKey: ['ideas', ideaId] }),
      ])
    },
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})
    createIdeaMutation.mutate(formValues)
  }

  function handleChange<K extends keyof IdeaFormValues>(key: K, value: IdeaFormValues[K]) {
    setFieldErrors((current) => ({
      ...current,
      [key]: undefined,
    }))
    setFormValues((current) => ({
      ...current,
      [key]: value,
    }))
  }

  return (
    <main className="page-wrap pb-28 pt-8 lg:pb-16">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-5">
          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  <Lightbulb size={14} />
                  Idea Vault
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink-strong)]">Capture ideas worth revisiting</h1>
                <p className="max-w-2xl text-sm text-[var(--ink-soft)] sm:text-base">
                  Save rough thoughts as first-class ideas now. Refinement threads and conversions can land on top of this vault without changing where your ideas live.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-right shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Saved ideas</div>
                <div className="mt-2 text-3xl font-semibold text-[var(--ink-strong)]">{ideas.length}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
              <Sparkles size={16} className="text-[var(--brand)]" />
              Recent ideas
            </div>

            <div className="space-y-3">
              {ideas.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
                  No ideas yet. Start by saving a title and a few notes in the form on this page.
                </div>
              ) : (
                ideas.map((idea) => (
                  <article
                    key={idea.id}
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[rgba(79,184,178,0.12)] text-[var(--brand)]">
                        <Lightbulb size={18} />
                      </div>

                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              to="/ideas/$ideaId"
                              params={{ ideaId: idea.id }}
                              className="text-base font-semibold text-[var(--ink-strong)] no-underline hover:text-[var(--brand)]"
                            >
                              {idea.title}
                            </Link>
                            <p className="mt-1 text-sm text-[var(--ink-soft)]">{getIdeaExcerpt(idea) || 'Open the idea to add more context.'}</p>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleStarMutation.mutate(idea.id)}
                            aria-label={isIdeaStarred(idea) ? 'Remove star from idea' : 'Star idea'}
                            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
                              isIdeaStarred(idea)
                                ? 'border-amber-300 bg-amber-100/70 text-amber-600 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                                : 'border-[var(--line)] bg-[var(--panel)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                            }`}
                          >
                            <Star size={16} className={isIdeaStarred(idea) ? 'fill-current' : ''} />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]">
                          <span className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 font-medium">
                            {idea.sourceType.replace('_', ' ')}
                          </span>
                          <span>Updated {idea.updatedAt.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-6 lg:sticky lg:top-24 lg:self-start">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <Plus size={16} className="text-[var(--brand)]" />
            New idea
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Title
              <input
                value={formValues.title}
                onChange={(event) => handleChange('title', event.target.value)}
                placeholder="What are you thinking about?"
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
              {fieldErrors.title ? <span className="mt-2 block text-sm font-medium text-red-500">{fieldErrors.title}</span> : null}
            </label>

            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Notes
              <textarea
                value={formValues.body ?? ''}
                onChange={(event) => handleChange('body', event.target.value)}
                placeholder="Capture the shape of the idea, why it matters, or what sparked it."
                rows={7}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
              {fieldErrors.body ? <span className="mt-2 block text-sm font-medium text-red-500">{fieldErrors.body}</span> : null}
            </label>

            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Source input
              <textarea
                value={formValues.sourceInput ?? ''}
                onChange={(event) => handleChange('sourceInput', event.target.value)}
                placeholder="Optional: paste the raw voice transcript or capture text that sparked this idea."
                rows={4}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
              {fieldErrors.sourceInput ? <span className="mt-2 block text-sm font-medium text-red-500">{fieldErrors.sourceInput}</span> : null}
            </label>

            {formError ? <p className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">{formError}</p> : null}

            <button
              type="submit"
              disabled={createIdeaMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 py-3 font-semibold text-white shadow-[0_18px_50px_rgba(79,184,178,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Plus size={16} />
              {createIdeaMutation.isPending ? 'Saving idea...' : 'Save idea'}
            </button>
          </form>
        </aside>
      </section>
    </main>
  )
}
