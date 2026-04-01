import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="panel rounded-[1.75rem] p-6 sm:p-8">
        <p className="island-kicker mb-3">Milestone 4</p>
        <h1 className="display-title mb-4 text-4xl font-bold text-[var(--ink-strong)]">
          Calendar context
        </h1>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
          This route is prepared for read-only Google Calendar sync, selected
          calendar management, manual sync status, and future meeting context
          views.
        </p>
      </section>
    </main>
  )
}
