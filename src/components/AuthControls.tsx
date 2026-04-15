import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, LogOut, UserRound } from 'lucide-react'
import { signOutSession } from '../server/auth'

export default function AuthControls({
  state,
  label,
  compact = false,
}: {
  state: 'authenticated' | 'needs_login'
  label?: string | null
  compact?: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()

  const signOutMutation = useMutation({
    mutationFn: async () => signOutSession(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-status'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['habits'] }),
        queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-view'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-settings'] }),
      ])
      await router.invalidate({ sync: true })
      await navigate({ to: '/login' })
    },
  })

  if (state === 'needs_login') {
    return (
      <Link
        to="/login"
        className={compact
          ? 'inline-flex size-10 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--ink-strong)] no-underline transition hover:text-[var(--brand)]'
          : 'inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] no-underline transition hover:text-[var(--brand)]'}
        aria-label="Log in"
        title="Log in"
      >
        <UserRound size={14} />
        {compact ? null : 'Log in'}
      </Link>
    )
  }

  const resolvedLabel = label ?? 'Signed in'

  return (
    <div
      className={compact
        ? 'inline-flex h-10 items-center gap-1 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 text-xs font-semibold text-[var(--ink-strong)]'
        : 'inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)]'}
      title={resolvedLabel}
    >
      <UserRound size={14} className="text-[var(--brand)]" />
      <span className={compact ? 'hidden sm:inline max-w-32 truncate' : 'max-w-32 truncate sm:max-w-44'}>{resolvedLabel}</span>
      <button
        type="button"
        onClick={() => signOutMutation.mutate()}
        disabled={signOutMutation.isPending}
        className={`inline-flex items-center gap-1 rounded-full text-[var(--ink-soft)] transition hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'size-7 justify-center px-0 py-0' : 'px-1.5 py-0.5'}`}
        aria-label="Sign out"
        title="Sign out"
      >
        {signOutMutation.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <LogOut size={12} />}
      </button>
    </div>
  )
}
