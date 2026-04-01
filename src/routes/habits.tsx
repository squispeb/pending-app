import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/habits')({
  component: HabitsPage,
})

function HabitsPage() {
  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="panel rounded-[1.75rem] p-6 sm:p-8">
        <p className="island-kicker mb-3">Milestone 2</p>
        <h1 className="display-title mb-4 text-4xl font-bold text-[var(--ink-strong)]">
          Habits workspace
        </h1>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
          This route will hold recurring habit definitions, completion history,
          and the daily check-off flow once the habit schema and server actions
          are implemented.
        </p>
      </section>
    </main>
  )
}
