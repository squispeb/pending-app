import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdeaThreadHistory } from './idea-thread-history'

describe('IdeaThreadHistory', () => {
  it('renders an empty-state message when no visible events exist', () => {
    const markup = renderToStaticMarkup(<IdeaThreadHistory visibleEvents={[]} />)

    expect(markup).toContain('No visible thread history yet.')
    expect(markup).toContain('Thread ready')
  })

  it('renders distinct visible event labels and the latest thread status', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'event-1',
            type: 'thread_created',
            createdAt: '2026-04-12T00:00:00.000Z',
            summary: 'Thread bootstrapped.',
          },
          {
            eventId: 'event-2',
            type: 'proposal_created',
            createdAt: '2026-04-12T00:01:00.000Z',
            summary: 'Assistant generated a proposal.',
          },
          {
            eventId: 'event-3',
            type: 'proposal_approved',
            createdAt: '2026-04-12T00:02:00.000Z',
            summary: 'User approved the proposal.',
          },
          {
            eventId: 'event-4',
            type: 'proposal_rejected',
            createdAt: '2026-04-12T00:03:00.000Z',
            summary: 'User rejected a later proposal.',
          },
          {
            eventId: 'event-5',
            type: 'assistant_failed',
            createdAt: '2026-04-12T00:04:00.000Z',
            summary: 'Assistant could not complete the request.',
          },
        ]}
      />,
    )

    expect(markup).toContain('Thread created')
    expect(markup).toContain('Proposal created')
    expect(markup).toContain('Proposal approved')
    expect(markup).toContain('Proposal rejected')
    expect(markup).toContain('Assistant failed')
    expect(markup).toContain('Assistant could not complete the request.')
  })
})
