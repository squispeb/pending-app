import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, LogOut, UserRound } from 'lucide-react'
import { getAuthStatus, signOutSession, startAnonymousSession } from '../server/auth'

const authStatusQueryOptions = () =>
  queryOptions({
    queryKey: ['auth-status'],
    queryFn: () => getAuthStatus(),
    staleTime: 30_000,
  })

export default function AuthStatusChip() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery(authStatusQueryOptions())

  const startSessionMutation = useMutation({
    mutationFn: async () => startAnonymousSession(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] })
    },
  })

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
    },
  })

  if (isPending || !data) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
        <LoaderCircle size={14} className="animate-spin" />
        Session
      </div>
    )
  }

  if (data.state === 'signed_out') {
    return (
      <button
        type="button"
        onClick={() => startSessionMutation.mutate()}
        disabled={startSessionMutation.isPending}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] transition hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {startSessionMutation.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <UserRound size={14} />}
        Start session
      </button>
    )
  }

  const label = data.state === 'anonymous' ? 'Anonymous session' : data.user?.displayName ?? data.user?.email ?? 'Signed in'

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)]">
      <UserRound size={14} className="text-[var(--brand)]" />
      <span className="max-w-32 truncate sm:max-w-44">{label}</span>
      <button
        type="button"
        onClick={() => signOutMutation.mutate()}
        disabled={signOutMutation.isPending}
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[var(--ink-soft)] transition hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Sign out"
        title="Sign out"
      >
        {signOutMutation.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <LogOut size={12} />}
      </button>
    </div>
  )
}
