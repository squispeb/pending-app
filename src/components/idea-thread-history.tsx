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
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">Thread history</div>
        <div className={`rounded-full border px-3 py-1 text-xs font-medium ${threadState.badgeClassName}`}>{threadState.label}</div>
      </div>

      <div className="space-y-3">
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            const presentation = getThreadEventPresentation(event.type)
            const Icon = presentation.icon

            return (
              <article key={event.eventId} className={`rounded-2xl border p-4 ${presentation.cardClassName}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
                    <Icon size={16} className={presentation.iconClassName} />
                    {presentation.label}
                  </div>
                  <div className="text-xs text-[var(--ink-faint)]">{new Date(event.createdAt).toLocaleString()}</div>
                </div>
                <p className="mt-2 m-0 text-sm leading-6 text-[var(--ink-soft)]">{event.summary}</p>
              </article>
            )
          })
        ) : (
          <p className="m-0 text-sm text-[var(--ink-soft)]">No visible thread history yet.</p>
        )}
      </div>
    </section>
  )
}
