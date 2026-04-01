export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer mt-20 px-4 pb-14 pt-10 text-[var(--ink-soft)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">
          &copy; {year} Pending App. Personal planning, built incrementally.
        </p>
        <p className="island-kicker m-0">TanStack Start + PWA + Drizzle</p>
      </div>
      <p className="page-wrap mt-4 text-center text-sm sm:text-left">
        Milestone 0 provides the route shell, database baseline, environment
        template, and installable web app setup for the planner.
      </p>
    </footer>
  )
}
