import { AlertTriangle, HelpCircle, Lightbulb, MessageSquareText, Sparkles, TrendingUp } from 'lucide-react'

export type ThreadEventType = 'thread_created' | 'user_turn_added' | 'assistant_question' | 'assistant_synthesis' | 'stage_changed' | 'assistant_failed'

export function formatThreadEventLabel(type: ThreadEventType) {
  switch (type) {
    case 'thread_created':
      return 'Thread created'
    case 'user_turn_added':
      return 'You added context'
    case 'assistant_question':
      return 'Assistant asked'
    case 'assistant_synthesis':
      return 'Assistant synthesis'
    case 'stage_changed':
      return 'Stage changed'
    case 'assistant_failed':
      return 'Assistant failed'
  }
}

export function getThreadEventPresentation(type: ThreadEventType) {
  switch (type) {
    case 'assistant_synthesis':
      return {
        label: formatThreadEventLabel(type),
        icon: Sparkles,
        iconClassName: 'text-violet-500',
        cardClassName: 'border-violet-200 bg-violet-50/70 dark:border-violet-500/30 dark:bg-violet-500/10',
      }
    case 'user_turn_added':
      return {
        label: formatThreadEventLabel(type),
        icon: MessageSquareText,
        iconClassName: 'text-sky-500',
        cardClassName: 'border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10',
      }
    case 'assistant_question':
      return {
        label: formatThreadEventLabel(type),
        icon: HelpCircle,
        iconClassName: 'text-emerald-500',
        cardClassName: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10',
      }
    case 'stage_changed':
      return {
        label: formatThreadEventLabel(type),
        icon: TrendingUp,
        iconClassName: 'text-sky-500',
        cardClassName: 'border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10',
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
    .find((event) => event.type !== 'thread_created' && event.type !== 'user_turn_added')

  switch (latestRelevantEvent?.type) {
    case 'assistant_synthesis':
      return {
        label: 'Assistant updated',
        badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
      }
    case 'assistant_question':
      return {
        label: 'Assistant guiding',
        badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
      }
    case 'stage_changed':
      return {
        label: 'Stage updated',
        badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
      }
    case 'assistant_failed':
      return {
        label: 'Assistant failed',
        badgeClassName: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
      }
    default:
      return {
        label: 'Discovery ready',
        badgeClassName: 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)]',
      }
  }
}
