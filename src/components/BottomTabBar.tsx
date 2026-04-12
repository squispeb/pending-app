import { Link } from '@tanstack/react-router'
import { CalendarDays, CheckSquare, Lightbulb, Mic, Repeat, Sun } from 'lucide-react'
import { useCaptureContext } from '../contexts/CaptureContext'

const NAV_ITEMS_LEFT = [
  { to: '/' as const, icon: Sun, label: 'Today', exact: true },
  { to: '/tasks' as const, icon: CheckSquare, label: 'Tasks', exact: false },
]

const NAV_ITEMS_RIGHT = [
  { to: '/ideas' as const, icon: Lightbulb, label: 'Ideas', exact: false },
  { to: '/habits' as const, icon: Repeat, label: 'Habits', exact: false },
  { to: '/calendar' as const, icon: CalendarDays, label: 'Calendar', exact: false },
]

export default function BottomTabBar() {
  const { openCapture } = useCaptureContext()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Bar background with top border */}
      <div className="relative flex h-16 items-stretch border-t border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-xl">

        {/* Left two tabs */}
        <div className="flex flex-1 items-stretch">
          {NAV_ITEMS_LEFT.map(({ to, icon: Icon, label, exact }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[var(--ink-soft)] no-underline transition-colors"
              activeProps={{ className: 'group flex flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[var(--brand)] no-underline' }}
              activeOptions={{ exact }}
            >
              <Icon size={22} className="shrink-0" />
              <span className="text-[10px] font-semibold leading-none tracking-wide">{label}</span>
            </Link>
          ))}
        </div>

        {/* Center mic button — elevated */}
        <div className="relative flex w-20 shrink-0 items-center justify-center">
          <button
            type="button"
            onClick={openCapture}
            aria-label="Voice capture"
            className="absolute -top-5 flex size-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-emerald-500 shadow-[0_4px_20px_rgba(37,99,235,0.45)] transition active:scale-95"
          >
            <Mic size={24} className="text-white" />
          </button>
        </div>

        {/* Right two tabs */}
        <div className="flex flex-1 items-stretch">
          {NAV_ITEMS_RIGHT.map(({ to, icon: Icon, label, exact }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[var(--ink-soft)] no-underline transition-colors"
              activeProps={{ className: 'group flex flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[var(--brand)] no-underline' }}
              activeOptions={{ exact }}
            >
              <Icon size={22} className="shrink-0" />
              <span className="text-[10px] font-semibold leading-none tracking-wide">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
