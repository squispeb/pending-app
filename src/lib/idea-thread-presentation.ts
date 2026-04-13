import { AlertTriangle, CheckCircle2, Clock3, Lightbulb, MessageSquareText, XCircle } from 'lucide-react'

export type ThreadEventType = 'thread_created' | 'user_request' | 'proposal_created' | 'proposal_approved' | 'proposal_rejected' | 'assistant_failed'

export function formatThreadEventLabel(type: ThreadEventType) {
  switch (type) {
    case 'thread_created':
      return 'Thread created'
    case 'user_request':
      return 'You asked'
    case 'proposal_created':
      return 'Proposal created'
    case 'proposal_approved':
      return 'Proposal approved'
    case 'proposal_rejected':
      return 'Proposal rejected'
    case 'assistant_failed':
      return 'Assistant failed'
  }
}

export function getThreadEventPresentation(type: ThreadEventType) {
  switch (type) {
    case 'proposal_created':
      return {
        label: formatThreadEventLabel(type),
        icon: Clock3,
        iconClassName: 'text-amber-500',
        cardClassName: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10',
      }
    case 'user_request':
      return {
        label: formatThreadEventLabel(type),
        icon: MessageSquareText,
        iconClassName: 'text-sky-500',
        cardClassName: 'border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10',
      }
    case 'proposal_approved':
      return {
        label: formatThreadEventLabel(type),
        icon: CheckCircle2,
        iconClassName: 'text-emerald-500',
        cardClassName: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10',
      }
    case 'proposal_rejected':
      return {
        label: formatThreadEventLabel(type),
        icon: XCircle,
        iconClassName: 'text-rose-500',
        cardClassName: 'border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10',
      }
    case 'assistant_failed':
      return {
        label: formatThreadEventLabel(type),
        icon: AlertTriangle,
        iconClassName: 'text-red-500',
        cardClassName: 'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10',
      }
    case 'thread_created':
      return {
        label: formatThreadEventLabel(type),
        icon: Lightbulb,
        iconClassName: 'text-[var(--brand)]',
        cardClassName: 'border-[var(--line)] bg-[var(--surface)]',
      }
  }
}

export function deriveThreadState(visibleEvents: Array<{ type: ThreadEventType }>) {
  const latestRelevantEvent = [...visibleEvents]
    .reverse()
    .find((event) => event.type !== 'thread_created' && event.type !== 'user_request')

  switch (latestRelevantEvent?.type) {
    case 'proposal_created':
      return {
        label: 'Proposal pending',
        badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
      }
    case 'proposal_approved':
      return {
        label: 'Proposal approved',
        badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
      }
    case 'proposal_rejected':
      return {
        label: 'Proposal rejected',
        badgeClassName: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
      }
    case 'assistant_failed':
      return {
        label: 'Assistant failed',
        badgeClassName: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
      }
    default:
      return {
        label: 'Thread ready',
        badgeClassName: 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)]',
      }
  }
}
