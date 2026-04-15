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

  it('renders queue-aware thread status details when the thread is busy', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'event-1',
            type: 'thread_created',
            createdAt: '2026-04-12T00:00:00.000Z',
            summary: 'Thread bootstrapped.',
          },
        ]}
        threadStatus="queued"
        activeTurn={{
          turnId: 'turn-1',
          source: 'text',
          userMessage: 'Clarify the target user for the onboarding flow.',
          transcriptLanguage: null,
          state: 'processing',
          createdAt: '2026-04-12T00:00:30.000Z',
          completedAt: null,
        }}
        queuedTurns={[
          {
            turnId: 'turn-2',
            source: 'text',
            userMessage: 'Also capture where drop-off happens now.',
            transcriptLanguage: null,
            state: 'queued',
            createdAt: '2026-04-12T00:01:00.000Z',
            completedAt: null,
          },
        ]}
      />,
    )

    expect(markup).toContain('Queued (1)')
    expect(markup).toContain('The assistant is finishing an earlier turn first.')
    expect(markup).toContain('Active turn: Clarify the target user for the onboarding flow.')
    expect(markup).toContain('1 later reply is queued.')
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

  it('renders the denser thread shell and streaming reply state', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'event-1',
            type: 'assistant_question',
            createdAt: '2026-04-12T00:01:00.000Z',
            summary: 'What part of the flow should feel faster?',
          },
        ]}
        streamingAssistantText="I am outlining the fastest thread-first layout now."
        className="min-h-full"
      />,
    )

    expect(markup).toContain('Thread')
    expect(markup).toContain('Assistant replying')
    expect(markup).toContain('I am outlining the fastest thread-first layout now.')
    expect(markup).toContain('min-h-full')
  })

  it('includes accessible section label and live region on the status badge', () => {
    const markup = renderToStaticMarkup(<IdeaThreadHistory visibleEvents={[]} />)

    expect(markup).toContain('aria-label="Idea thread history"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
  })

  it('adds role=status and aria-live to the queue/busy panel', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        threadStatus="streaming"
      />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('The assistant is currently writing back in this thread.')
  })

  it('exposes threadRegionId as the section id for tab panel wiring', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        threadRegionId="thread-history-panel"
      />,
    )

    expect(markup).toContain('id="thread-history-panel"')
  })

  it('wraps streaming text in an article with an accessible label', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        streamingAssistantText="Thinking about your question now."
      />,
    )

    expect(markup).toContain('aria-label="Assistant is replying"')
    expect(markup).toContain('Thinking about your question now.')
  })

  it('renders event timestamps inside a time element', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'event-1',
            type: 'user_turn_added',
            createdAt: '2026-04-12T00:00:30.000Z',
            summary: 'More context here.',
          },
        ]}
      />,
    )

    expect(markup).toContain('<time')
    expect(markup).toContain('dateTime="2026-04-12T00:00:30.000Z"')
  })
})
