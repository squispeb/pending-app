import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdeaThreadHistory } from './idea-thread-history'

describe('IdeaThreadHistory', () => {
  it('renders an empty-state message when no visible events exist', () => {
    const markup = renderToStaticMarkup(<IdeaThreadHistory visibleEvents={[]} />)

    expect(markup).toContain('No visible thread history yet.')
    expect(markup).toContain('Reply to this idea and the assistant will start building context with you here.')
    expect(markup).toContain('Discovery ready')
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
            type: 'user_turn_added',
            createdAt: '2026-04-12T00:00:30.000Z',
            summary: 'This could help new users understand the setup flow faster.',
          },
          {
            eventId: 'event-3',
            type: 'assistant_question',
            createdAt: '2026-04-12T00:01:00.000Z',
            summary: 'Who is the main user for this onboarding improvement?',
          },
          {
            eventId: 'event-4',
            type: 'assistant_synthesis',
            createdAt: '2026-04-12T00:02:00.000Z',
            summary: 'The assistant has identified onboarding clarity and activation speed as the main opportunity so far.',
          },
          {
            eventId: 'event-5',
            type: 'stage_changed',
            createdAt: '2026-04-12T00:03:00.000Z',
            summary: 'The idea moved from discovery to framing.',
          },
          {
            eventId: 'event-6',
            type: 'assistant_failed',
            createdAt: '2026-04-12T00:04:00.000Z',
            summary: 'Assistant could not complete the request.',
          },
        ]}
      />,
    )

    expect(markup).toContain('Thread created')
    expect(markup).toContain('You added context')
    expect(markup).toContain('This could help new users understand the setup flow faster.')
    expect(markup).toContain('Assistant asked')
    expect(markup).toContain('Assistant synthesis')
    expect(markup).toContain('Stage changed')
    expect(markup).toContain('Assistant failed')
    expect(markup).toContain('Assistant could not complete the request.')
  })
})
