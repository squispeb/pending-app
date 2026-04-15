import { useRouterState } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import AuthControls from './AuthControls'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  const matches = useRouterState({ select: (state) => state.matches })
  const authMatch = [...matches].reverse().find((match) => match.context && 'auth' in match.context)
  const auth = authMatch?.context?.auth as
    | { state: 'authenticated'; user: { email: string; displayName: string | null } | null }
    | { state: 'needs_login' }
    | undefined
  const requiresLogin = !auth || auth.state !== 'authenticated'
  const label = auth && auth.state === 'authenticated' ? auth.user?.displayName ?? auth.user?.email ?? 'Signed in' : null
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-xl">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to={requiresLogin ? '/login' : '/'}
            className="inline-flex items-center gap-2.5 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--ink-strong)] no-underline shadow-[0_8px_24px_rgba(15,23,42,0.08)] sm:gap-3 sm:px-4 sm:py-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2563eb,#10b981)] text-xs font-bold text-white">
              P
            </span>
            <span className="hidden sm:inline">Pending App</span>
            <span className="sm:hidden">Pending</span>
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <AuthControls state={requiresLogin ? 'needs_login' : 'authenticated'} label={label} compact />
          {requiresLogin ? null : (
            <>
              <Link
                to="/settings"
                aria-label="Settings"
                className="flex size-10 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)] lg:hidden"
                activeProps={{ className: 'flex size-10 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--brand)] lg:hidden' }}
              >
                <Settings size={18} />
              </Link>
            </>
          )}
          <div className="lg:hidden">
            <ThemeToggle compact />
          </div>
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
        </div>

        <div className="order-3 hidden w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0 lg:flex">
          {requiresLogin ? (
            <Link
              to="/login"
              className="nav-link"
              activeProps={{ className: 'nav-link is-active' }}
            >
              Login
            </Link>
          ) : (
            <>
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
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
