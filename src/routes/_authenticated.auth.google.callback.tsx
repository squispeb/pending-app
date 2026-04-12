import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { completeGoogleConnect } from '../server/calendar'

const googleCallbackSearchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/auth/google/callback')({
  validateSearch: (search) => googleCallbackSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (deps.error) {
      return {
        ok: false as const,
        message: `Google connection was cancelled: ${deps.error}`,
      }
    }

    if (!deps.code || !deps.state) {
      return {
        ok: false as const,
        message: 'Google callback is missing required parameters.',
      }
    }

    try {
      const result = await completeGoogleConnect({
        data: {
          code: deps.code,
          state: deps.state,
        },
      })

      return {
        ok: true as const,
        message: `Connected ${result.email}, selected ${result.selectedCalendarCount} calendars, and synced ${result.syncedEventCount} events.`,
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : 'Google Calendar connection failed unexpectedly.',
      }
    }
  },
  component: GoogleCallbackPage,
})

function GoogleCallbackPage() {
  const data = Route.useLoaderData()

  useEffect(() => {
    if (!data.ok || typeof window === 'undefined') {
      return
    }

    const timer = window.setTimeout(() => {
      window.location.replace('/settings')
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [data.ok])

  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="panel mx-auto max-w-2xl rounded-[1.75rem] p-6 sm:p-8">
        <p className="island-kicker mb-3">Google Calendar</p>
        <h1 className="display-title mb-4 text-3xl font-bold text-[var(--ink-strong)]">
          {data.ok ? 'Connection complete' : 'Connection failed'}
        </h1>
        <p className="text-base leading-7 text-[var(--ink-soft)]">{data.message}</p>
        <a
          href="/settings"
          className="primary-pill mt-5 inline-flex cursor-pointer border-0 text-sm font-semibold no-underline"
        >
          Return to settings
        </a>
      </section>
    </main>
  )
}
