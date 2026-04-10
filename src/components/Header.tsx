import { Link } from '@tanstack/react-router'
import { Lightbulb, Settings } from 'lucide-react'
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
          <Link
            to="/ideas"
            aria-label="Ideas"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--ink-soft)] no-underline transition hover:text-[var(--ink-strong)] lg:hidden"
            activeProps={{ className: 'inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--brand)] no-underline lg:hidden' }}
          >
            <Lightbulb size={16} />
            Ideas
          </Link>
          {/* Settings gear — mobile only (bottom tab bar handles nav, but Settings has no tab slot) */}
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex size-9 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink-strong)] lg:hidden"
            activeProps={{ className: 'flex size-9 items-center justify-center rounded-full text-[var(--brand)] lg:hidden' }}
          >
            <Settings size={18} />
          </Link>
          <ThemeToggle />
        </div>

        {/* Nav links — desktop only (mobile uses bottom tab bar) */}
        <div className="order-3 hidden w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0 lg:flex">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
            activeOptions={{ exact: true }}
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
            to="/ideas"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Ideas
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
