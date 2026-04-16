import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AcceptedBreakdownPlanCard, BreakdownProposalCard, IdeaThreadHistory, type AcceptedBreakdownStep, type PendingBreakdownProposal } from './idea-thread-history'

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')

  return {
    ...actual,
    Link: ({ to, children, ...props }: any) => (
      <a href={typeof to === 'string' ? to : String(to)} {...props}>
        {children}
      </a>
    ),
  }
})

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
          {
            eventId: 'event-7',
            type: 'task_created',
            createdAt: '2026-04-12T00:05:00.000Z',
            summary: 'Created task Reduce onboarding drop-off from the accepted idea conversion.',
          },
        ]}
      />,
    )

    expect(markup).toContain('Thread created')
    expect(markup).toContain('Your reply')
    expect(markup).toContain('This could help new users understand the setup flow faster.')
    expect(markup).toContain('Assistant asked')
    expect(markup).toContain('Assistant synthesis')
    expect(markup).toContain('Stage changed')
    expect(markup).toContain('Assistant failed')
    expect(markup).toContain('Assistant could not complete the request.')
    expect(markup).toContain('Task created')
    expect(markup).toContain('View in Tasks')
    expect(markup).toContain('Created task Reduce onboarding drop-off from the accepted idea conversion.')
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

  it('can hide the internal thread header when the parent view already provides it', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        showHeader={false}
      />,
    )

    expect(markup).not.toContain('>Thread<')
    expect(markup).not.toContain('Discovery ready')
    expect(markup).toContain('No visible thread history yet.')
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

const sampleBreakdownProposal: PendingBreakdownProposal = {
  proposalId: 'prop-abc',
  action: 'breakdown',
  proposedSummary: 'Step 1: Research. Step 2: Prototype. Step 3: Ship.',
  explanation: 'The idea is mature enough to break down into concrete steps.',
}

describe('BreakdownProposalCard', () => {
  it('renders the proposal heading, summary, and explanation', () => {
    const markup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={false}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )

    expect(markup).toContain('Breakdown proposal')
    expect(markup).toContain('Step 1: Research. Step 2: Prototype. Step 3: Ship.')
    expect(markup).toContain('The idea is mature enough to break down into concrete steps.')
  })

  it('renders Accept and Reject buttons', () => {
    const markup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={false}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )

    expect(markup).toContain('Accept breakdown')
    expect(markup).toContain('Reject breakdown')
  })

  it('shows accepting/rejecting states when mutations are pending', () => {
    const acceptingMarkup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={true}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )
    expect(acceptingMarkup).toContain('Accepting…')

    const rejectingMarkup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={false}
        isRejecting={true}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )
    expect(rejectingMarkup).toContain('Rejecting…')
  })

  it('disables both buttons when either mutation is pending', () => {
    const markup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={true}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )
    // Both buttons carry disabled attr when isAccepting=true
    const disabledCount = (markup.match(/disabled=""/g) ?? []).length
    expect(disabledCount).toBe(2)
  })

  it('carries the accessible region label', () => {
    const markup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={sampleBreakdownProposal}
        isAccepting={false}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )

    expect(markup).toContain('aria-label="Pending breakdown proposal"')
  })
})

describe('IdeaThreadHistory — inline breakdown proposal', () => {
  it('renders the inline breakdown proposal when one is provided with callbacks', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        pendingBreakdownProposal={sampleBreakdownProposal}
        isAcceptingBreakdown={false}
        isRejectingBreakdown={false}
        onAcceptBreakdown={() => {}}
        onRejectBreakdown={() => {}}
      />,
    )

    expect(markup).toContain('Breakdown proposal')
    expect(markup).toContain('Step 1: Research. Step 2: Prototype. Step 3: Ship.')
    expect(markup).toContain('Accept breakdown')
    expect(markup).toContain('Reject breakdown')
  })

  it('does not render the breakdown card when pendingBreakdownProposal is null', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        pendingBreakdownProposal={null}
        onAcceptBreakdown={() => {}}
        onRejectBreakdown={() => {}}
      />,
    )

    expect(markup).not.toContain('Breakdown proposal')
    expect(markup).not.toContain('Accept breakdown')
  })

  it('does not render the breakdown card when callbacks are omitted', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        pendingBreakdownProposal={sampleBreakdownProposal}
        // no onAcceptBreakdown / onRejectBreakdown
      />,
    )

    expect(markup).not.toContain('Breakdown proposal')
  })

  it('renders proposal after existing thread events', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'e1',
            type: 'assistant_question',
            createdAt: '2026-04-12T00:01:00.000Z',
            summary: 'Who are the target users?',
          },
        ]}
        pendingBreakdownProposal={sampleBreakdownProposal}
        onAcceptBreakdown={() => {}}
        onRejectBreakdown={() => {}}
      />,
    )

    const questionIdx = markup.indexOf('Who are the target users?')
    const proposalIdx = markup.indexOf('Breakdown proposal')
    expect(questionIdx).toBeGreaterThan(-1)
    expect(proposalIdx).toBeGreaterThan(questionIdx)
  })
})

const sampleAcceptedSteps: AcceptedBreakdownStep[] = [
  { id: 'step-1', stepText: 'Research the problem space.' },
  { id: 'step-2', stepText: 'Prototype a minimal flow.' },
  { id: 'step-3', stepText: 'Ship and measure.' },
]

describe('AcceptedBreakdownPlanCard', () => {
  it('renders the accepted plan heading and all step texts', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).toContain('Accepted plan')
    expect(markup).toContain('Research the problem space.')
    expect(markup).toContain('Prototype a minimal flow.')
    expect(markup).toContain('Ship and measure.')
  })

  it('shows the correct step count badge', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).toContain('3 steps')
  })

  it('shows singular "step" when there is only one step', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={[{ id: 'step-1', stepText: 'Just this one thing.' }]} />,
    )

    expect(markup).toContain('1 step')
    expect(markup).not.toContain('1 steps')
  })

  it('carries the accessible region label', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).toContain('aria-label="Accepted breakdown plan"')
  })

  it('renders numbered step indicators', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).toContain('>1<')
    expect(markup).toContain('>2<')
    expect(markup).toContain('>3<')
  })
})

describe('IdeaThreadHistory — accepted breakdown plan card', () => {
  it('renders the plan card in the thread when acceptedBreakdownSteps are provided', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
      />,
    )

    expect(markup).toContain('Accepted plan')
    expect(markup).toContain('Research the problem space.')
    expect(markup).toContain('Prototype a minimal flow.')
  })

  it('does not render the plan card when acceptedBreakdownSteps is empty', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={[]}
      />,
    )

    expect(markup).not.toContain('Accepted plan')
  })

  it('does not render the plan card when a pending proposal is also present', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        pendingBreakdownProposal={sampleBreakdownProposal}
        onAcceptBreakdown={() => {}}
        onRejectBreakdown={() => {}}
      />,
    )

    // Pending proposal should appear, accepted plan should be hidden while
    // a new proposal is in review.
    expect(markup).toContain('Breakdown proposal')
    expect(markup).not.toContain('Accepted plan')
  })

  it('renders plan card after existing thread events', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[
          {
            eventId: 'e1',
            type: 'assistant_question',
            createdAt: '2026-04-12T00:01:00.000Z',
            summary: 'Who are the target users?',
          },
        ]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
      />,
    )

    const questionIdx = markup.indexOf('Who are the target users?')
    const planIdx = markup.indexOf('Accepted plan')
    expect(questionIdx).toBeGreaterThan(-1)
    expect(planIdx).toBeGreaterThan(questionIdx)
  })
})
