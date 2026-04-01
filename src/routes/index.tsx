import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="page-wrap px-4 pb-12 pt-10 sm:pt-14">
      <section className="hero-panel relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.24),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">Milestone 0 foundation</p>
        <h1 className="display-title mb-5 max-w-4xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--ink-strong)] sm:text-6xl">
          Daily planning for tasks, habits, and meeting context.
        </h1>
        <p className="mb-8 max-w-3xl text-base text-[var(--ink-soft)] sm:text-lg">
          The app foundation is ready for the first product slice: a unified
          planner built on TanStack Start with PWA support, a database layer,
          and Google Calendar-ready architecture.
        </p>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <a href="/tasks" className="primary-pill no-underline">
            Open task workspace
          </a>
          <a href="/settings" className="secondary-pill no-underline">
            Review integration setup
          </a>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
        <article className="panel rounded-[1.75rem] p-6 sm:p-7">
          <p className="island-kicker mb-3">What is wired</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['TanStack Start', 'File-based routing and SSR-ready app shell.'],
              ['React Query', 'Router context prepared for query-backed routes.'],
              ['Drizzle + libsql', 'Schema and database client baseline for SQLite and Turso.'],
              ['PWA baseline', 'Manifest, service worker registration, and installability support.'],
            ].map(([title, description]) => (
              <div key={title} className="subpanel rounded-2xl p-4">
                <h2 className="mb-2 text-base font-semibold text-[var(--ink-strong)]">
                  {title}
                </h2>
                <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel rounded-[1.75rem] p-6 sm:p-7">
          <p className="island-kicker mb-3">Next delivery slice</p>
          <ol className="m-0 space-y-3 pl-5 text-sm leading-6 text-[var(--ink-soft)]">
            <li>Implement the task schema and migrations.</li>
            <li>Build task creation, editing, and completion flows.</li>
            <li>Populate the dashboard with due-today and overdue tasks.</li>
            <li>Add the first test coverage around task lifecycle logic.</li>
          </ol>
        </article>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Dashboard', 'Primary planning surface for today.', '/'],
          ['Tasks', 'Local source of truth for work to do.', '/tasks'],
          ['Habits', 'Recurring routines and daily completions.', '/habits'],
          ['Calendar', 'Read-only Google event context.', '/calendar'],
        ].map(([title, description, href]) => (
          <a key={title} href={href} className="subpanel rounded-2xl p-5 no-underline">
            <p className="mb-2 text-base font-semibold text-[var(--ink-strong)]">{title}</p>
            <p className="m-0 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
          </a>
        ))}
      </section>
    </main>
  )
}
