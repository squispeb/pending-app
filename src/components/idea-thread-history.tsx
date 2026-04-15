import {
  deriveThreadState,
  getThreadEventPresentation,
  type ThreadEventType,
  type ThreadStatus,
  type ThreadTurnPresentation,
} from '../lib/idea-thread-presentation'
import { formatDisplayDateTime } from '../lib/date-time'

type IdeaThreadVisibleEvent = {
  eventId: string
  type: ThreadEventType
  createdAt: string
  summary: string
}

export function IdeaThreadHistory({
  visibleEvents,
  threadStatus = 'idle',
  activeTurn = null,
  queuedTurns = [],
  lastTurn = null,
  streamingAssistantText = '',
  className = '',
}: {
  visibleEvents: Array<IdeaThreadVisibleEvent>
  threadStatus?: ThreadStatus
  activeTurn?: ThreadTurnPresentation | null
  queuedTurns?: Array<ThreadTurnPresentation>
  lastTurn?: ThreadTurnPresentation | null
  streamingAssistantText?: string
  className?: string
}) {
  const threadState = deriveThreadState({
    status: threadStatus,
    visibleEvents,
    activeTurn,
    queuedTurns,
  })
  const showQueuePanel = threadStatus === 'queued' || threadStatus === 'processing' || threadStatus === 'streaming' || threadStatus === 'failed'

  return (
    <section className={`panel rounded-t-[28px] rounded-b-none p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-5 ${className}`.trim()}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Thread</div>
        <div className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${threadState.badgeClassName}`}>{threadState.label}</div>
      </div>

      {showQueuePanel ? (
        <div className="mb-2.5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
          <p className="m-0 text-xs font-medium text-[var(--ink-strong)]">{threadState.helperText}</p>
          {activeTurn ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              Active turn: {activeTurn.userMessage}
            </p>
          ) : null}
          {queuedTurns.length > 0 ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              {queuedTurns.length === 1 ? '1 later reply is queued.' : `${queuedTurns.length} later replies are queued.`}
            </p>
          ) : null}
          {threadStatus === 'failed' && lastTurn ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              Last failed turn: {lastTurn.userMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2.5">
        {streamingAssistantText ? (
          <article className="flex justify-start">
            <div className="max-w-[92%] rounded-[22px] border border-violet-200 bg-violet-50/70 px-3.5 py-3 shadow-sm dark:border-violet-500/30 dark:bg-violet-500/10 sm:max-w-[85%]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
                <span className="text-violet-500">●</span>
                <span>Assistant replying</span>
              </div>
              <p className="m-0 mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-strong)]">
                {streamingAssistantText}
              </p>
            </div>
          </article>
        ) : null}

        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            const presentation = getThreadEventPresentation(event.type)
            const Icon = presentation.icon
            const isUserTurn = event.type === 'user_turn_added'
            const isSystemEvent = event.type === 'thread_created' || event.type === 'stage_changed'

            return (
              <article key={event.eventId} className={isSystemEvent ? 'flex justify-center py-1' : `flex ${isUserTurn ? 'justify-end' : 'justify-start'}`}>
                {isSystemEvent ? (
                  <div className="inline-flex max-w-[90%] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--ink-soft)] sm:max-w-[85%]">
                    <Icon size={14} className={presentation.iconClassName} />
                    <span className="font-medium text-[var(--ink-strong)]">{presentation.label}</span>
                    <span>•</span>
                    <span>{event.summary}</span>
                  </div>
                ) : (
                  <div className={`max-w-[92%] rounded-[22px] px-3.5 py-3 shadow-sm sm:max-w-[85%] ${isUserTurn ? 'bg-[var(--brand)] text-white' : `border ${presentation.cardClassName}`}`}>
                    <div className={`flex items-center gap-2 text-xs font-semibold ${isUserTurn ? 'text-white/80' : 'text-[var(--ink-soft)]'}`}>
                      {!isUserTurn ? <Icon size={14} className={presentation.iconClassName} /> : null}
                      <span>{presentation.label}</span>
                    </div>
                    <p className={`m-0 mt-1.5 text-sm leading-6 ${isUserTurn ? 'whitespace-pre-wrap text-white' : 'text-[var(--ink-strong)]'}`}>
                      {event.summary}
                    </p>
                    <div className={`mt-1.5 text-[11px] ${isUserTurn ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>
                      {formatDisplayDateTime(event.createdAt)}
                    </div>
                  </div>
                )}
              </article>
            )
          })
        ) : (
          <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-8 text-center">
            <p className="m-0 text-sm font-medium text-[var(--ink-strong)]">No visible thread history yet.</p>
            <p className="m-0 mt-2 text-sm text-[var(--ink-soft)]">Reply to this idea and the assistant will start building context with you here.</p>
          </div>
        )}
      </div>
    </section>
  )
}
