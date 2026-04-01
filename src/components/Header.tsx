import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-xl">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-3 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--ink-strong)] no-underline shadow-[0_8px_24px_rgba(15,23,42,0.08)] sm:px-4 sm:py-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2563eb,#10b981)] text-xs font-bold text-white">
              P
            </span>
            Pending App
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold tracking-[0.16em] text-[var(--ink-soft)] uppercase sm:inline-flex">
            Foundation ready
          </span>
          <ThemeToggle />
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Today
          </Link>
          <Link
            to="/tasks"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Tasks
          </Link>
          <Link
            to="/habits"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Habits
          </Link>
          <Link
            to="/calendar"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Calendar
          </Link>
          <Link
            to="/settings"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Settings
          </Link>
        </div>
      </nav>
    </header>
  )
}
