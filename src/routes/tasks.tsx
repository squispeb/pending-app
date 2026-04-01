import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

function TasksPage() {
  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="panel rounded-[1.75rem] p-6 sm:p-8">
        <p className="island-kicker mb-3">Milestone 1</p>
        <h1 className="display-title mb-4 text-4xl font-bold text-[var(--ink-strong)]">
          Tasks workspace
        </h1>
        <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)]">
          This route is reserved for local task creation, filtering, and status
          management. The next implementation slice will wire Drizzle-backed task
          CRUD, due-today grouping, and overdue logic here.
        </p>
      </section>
    </main>
  )
}
