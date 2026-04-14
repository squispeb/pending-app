import { deriveThreadState, getThreadEventPresentation, type ThreadEventType } from '../lib/idea-thread-presentation'

type IdeaThreadVisibleEvent = {
  eventId: string
  type: ThreadEventType
  createdAt: string
  summary: string
}

export function IdeaThreadHistory({ visibleEvents }: { visibleEvents: Array<IdeaThreadVisibleEvent> }) {
  const threadState = deriveThreadState(visibleEvents)

  return (
    <section className="panel rounded-[28px] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Thread history</div>
        <div className={`rounded-full border px-3 py-1 text-xs font-medium ${threadState.badgeClassName}`}>{threadState.label}</div>
      </div>

      <div className="space-y-3">
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            const presentation = getThreadEventPresentation(event.type)
            const Icon = presentation.icon
            const isUserTurn = event.type === 'user_turn_added'
            const isSystemEvent = event.type === 'thread_created' || event.type === 'stage_changed'

            return (
              <article key={event.eventId} className={isSystemEvent ? 'flex justify-center py-1' : `flex ${isUserTurn ? 'justify-end' : 'justify-start'}`}>
                {isSystemEvent ? (
                  <div className="inline-flex max-w-[85%] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink-soft)]">
                    <Icon size={14} className={presentation.iconClassName} />
                    <span className="font-medium text-[var(--ink-strong)]">{presentation.label}</span>
                    <span>•</span>
                    <span>{event.summary}</span>
                  </div>
                ) : (
                  <div className={`max-w-[85%] rounded-[24px] px-4 py-3 shadow-sm ${isUserTurn ? 'bg-[var(--brand)] text-white' : `border ${presentation.cardClassName}`}`}>
                    <div className={`flex items-center gap-2 text-xs font-semibold ${isUserTurn ? 'text-white/80' : 'text-[var(--ink-soft)]'}`}>
                      {!isUserTurn ? <Icon size={14} className={presentation.iconClassName} /> : null}
                      <span>{presentation.label}</span>
                    </div>
                    <p className={`mt-2 m-0 text-sm leading-6 ${isUserTurn ? 'whitespace-pre-wrap text-white' : 'text-[var(--ink-strong)]'}`}>
                      {event.summary}
                    </p>
                    <div className={`mt-2 text-[11px] ${isUserTurn ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>
                      {new Date(event.createdAt).toLocaleString()}
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
