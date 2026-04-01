import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="panel rounded-[1.75rem] p-6 sm:p-8">
          <p className="island-kicker mb-3">Environment baseline</p>
          <h1 className="display-title mb-4 text-4xl font-bold text-[var(--ink-strong)]">
            Settings and integrations
          </h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
            This route will eventually host Google connection controls, calendar
            selection, reminder preferences, and timezone settings.
          </p>
        </article>

        <article className="panel rounded-[1.75rem] p-6 sm:p-8">
          <p className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">
            Expected server environment variables
          </p>
          <ul className="m-0 space-y-2 pl-5 text-sm leading-6 text-[var(--ink-soft)]">
            <li><code>DATABASE_URL</code></li>
            <li><code>DATABASE_AUTH_TOKEN</code></li>
            <li><code>GOOGLE_CLIENT_ID</code></li>
            <li><code>GOOGLE_CLIENT_SECRET</code></li>
            <li><code>GOOGLE_REDIRECT_URI</code></li>
            <li><code>SESSION_SECRET</code></li>
          </ul>
        </article>
      </section>
    </main>
  )
}
