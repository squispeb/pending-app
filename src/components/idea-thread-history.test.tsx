import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AcceptedBreakdownPlanCard, BreakdownProposalCard, IdeaThreadHistory, StructuredActionProposalCard, type AcceptedBreakdownStep, type PendingBreakdownProposal, type PendingStructuredProposal } from './idea-thread-history'
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
            type: 'breakdown_plan_recorded',
            createdAt: '2026-04-12T00:04:30.000Z',
            summary: 'Stored accepted breakdown plan with 4 steps.',
            stepCount: 4,
            steps: ['Validate discovery', 'Draft the prototype', 'Test the workflow', 'Review results'],
          },
          {
            eventId: 'event-8',
            type: 'step_status_changed',
            createdAt: '2026-04-12T00:04:45.000Z',
            summary: 'Marked accepted breakdown step #2 done: Run quick discovery.',
            stepOrder: 2,
            status: 'completed',
          },
          {
            eventId: 'event-9',
            type: 'task_created',
            createdAt: '2026-04-12T00:05:00.000Z',
            summary: 'Created task Reduce onboarding drop-off from the accepted idea conversion.',
            taskId: 'task-123',
            stepOrder: 2,
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
    expect(markup).toContain('Plan recorded')
    expect(markup).toContain('Stored accepted breakdown plan with 4 steps.')
    expect(markup).toContain('4 steps')
    expect(markup).toContain('Validate discovery')
    expect(markup).toContain('Draft the prototype')
    expect(markup).toContain('Step updated')
    expect(markup).toContain('Step 2 completed')
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

  it('renders optimistic live activity before canonical thread status updates', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        optimisticActivity={{
          label: 'Preparing task proposal',
          badgeClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
          helperText: 'The assistant is preparing a task conversion proposal for review.',
        }}
      />,
    )

    expect(markup).toContain('Preparing task proposal')
    expect(markup).toContain('The assistant is preparing a task conversion proposal for review.')
    expect(markup).toContain('role="status"')
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

  it('renders inline structured action progress and failure states inside the thread', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        activeStructuredAction="restructure"
        lastStructuredActionError={{ action: 'convert-to-task', message: 'Provider timeout' }}
      />,
    )

    expect(markup).toContain('Preparing restructure')
    expect(markup).toContain('The assistant is reframing this idea into a clearer structure in the thread now.')
    expect(markup).toContain('Structured action failed')
    expect(markup).toContain('Provider timeout')
  })

  it('renders non-breakdown structured proposals inline in the thread', () => {
    const proposal: PendingStructuredProposal = {
      proposalId: 'proposal-1',
      action: 'restructure',
      proposedSummary: 'Refocus the idea around a lighter-weight onboarding checkpoint.',
      explanation: 'This framing makes the first milestone easier to scan and act on.',
    }

    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        pendingStructuredProposal={proposal}
        onAcceptStructuredProposal={() => {}}
        onRejectStructuredProposal={() => {}}
      />,
    )

    expect(markup).toContain('Restructure proposal')
    expect(markup).toContain('Suggested framing')
    expect(markup).toContain('Accept restructure')
    expect(markup).toContain('Reject restructure')
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
  proposedSteps: ['Research', 'Prototype', 'Ship'],
  explanation: 'The idea is mature enough to break down into concrete steps.',
}

describe('BreakdownProposalCard', () => {
  it('renders the proposal heading, structured steps, and explanation', () => {
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
    expect(markup).toContain('Research')
    expect(markup).toContain('Prototype')
    expect(markup).toContain('Ship')
    expect(markup).toContain('The idea is mature enough to break down into concrete steps.')
  })

  it('falls back to the proposed summary when structured steps are missing', () => {
    const markup = renderToStaticMarkup(
      <BreakdownProposalCard
        proposal={{
          proposalId: 'prop-fallback',
          action: 'breakdown',
          proposedSummary: 'Step 1: Research. Step 2: Prototype. Step 3: Ship.',
          explanation: 'Fallback rendering still shows the raw summary.',
        }}
        isAccepting={false}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )

    expect(markup).toContain('Step 1: Research. Step 2: Prototype. Step 3: Ship.')
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

describe('StructuredActionProposalCard', () => {
  it('renders convert-to-task proposal labels and actions', () => {
    const proposal: PendingStructuredProposal = {
      proposalId: 'proposal-task',
      action: 'convert-to-task',
      proposedSummary: 'Create a task to validate the onboarding bottleneck and prototype the fix.',
      explanation: 'This idea is developed enough to turn into a task-ready next step.',
    }

    const markup = renderToStaticMarkup(
      <StructuredActionProposalCard
        proposal={proposal}
        isAccepting={false}
        isRejecting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    )

    expect(markup).toContain('Task conversion proposal')
    expect(markup).toContain('Proposed task')
    expect(markup).toContain('Accept - create task')
    expect(markup).toContain('Reject proposal')
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
    expect(markup).toContain('Research')
    expect(markup).toContain('Prototype')
    expect(markup).toContain('Ship')
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

describe('AcceptedBreakdownPlanCard — Create task buttons', () => {
  it('renders a "Create task" button for each step when onCreateTaskFromStep is provided', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
      />,
    )

    // One button per step — match button text only (not aria-label)
    const matches = markup.match(/>Create task</g) ?? []
    expect(matches).toHaveLength(sampleAcceptedSteps.length)
  })

  it('does NOT render "Create task" buttons when onCreateTaskFromStep is omitted', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).not.toContain('Create task')
  })

  it('shows "Creating…" label for the in-flight step', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={{ stepId: 'step-2', action: 'create-task' }}
      />,
    )

    expect(markup).toContain('Creating…')
    // The other two steps still say "Create task" (button text only)
    const matches = markup.match(/>Create task</g) ?? []
    expect(matches).toHaveLength(sampleAcceptedSteps.length - 1)
  })

  it('disables all "Create task" buttons when any step creation is in-flight', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={{ stepId: 'step-1', action: 'create-task' }}
      />,
    )

    const disabledCount = (markup.match(/disabled=""/g) ?? []).length
    expect(disabledCount).toBe(sampleAcceptedSteps.length)
  })

  it('carries an accessible aria-label for each step button', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
      />,
    )

    expect(markup).toContain('aria-label="Create task from step 1"')
    expect(markup).toContain('aria-label="Create task from step 2"')
    expect(markup).toContain('aria-label="Create task from step 3"')
  })
})

describe('IdeaThreadHistory — Create task from accepted breakdown step', () => {
  it('passes onCreateTaskFromStep through to the plan card', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
      />,
    )

    expect(markup).toContain('Create task')
    const matches = markup.match(/>Create task</g) ?? []
    expect(matches).toHaveLength(sampleAcceptedSteps.length)
  })

  it('does not render Create task buttons when onCreateTaskFromStep is not passed', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
      />,
    )

    expect(markup).not.toContain('Create task')
  })

  it('shows in-flight "Creating…" label forwarded from stepActionInFlight', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={{ stepId: 'step-2', action: 'create-task' }}
      />,
    )

    expect(markup).toContain('Creating…')
  })
})

describe('AcceptedBreakdownPlanCard — linked step state', () => {
  it('shows "Task created" chip instead of "Create task" button for a linked step', () => {
    const markup = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={sampleAcceptedSteps}
          onCompleteLinkedTask={() => {}}
          onCompleteStep={() => {}}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={['step-1']}
        />,
    )

    // step-1 should show "Task created" chip, not "Create task" button
    expect(markup).toContain('Task created')
    expect(markup).not.toContain('aria-label="Mark step 1 done"')
    expect(markup).toContain('aria-label="Complete linked task for step 1"')
    // Other two steps still show "Create task"
    const createMatches = markup.match(/>Create task</g) ?? []
    expect(createMatches).toHaveLength(2)
  })

  it('shows "Task created" chip for all linked steps', () => {
    const markup = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={sampleAcceptedSteps}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={['step-1', 'step-2', 'step-3']}
        />,
    )

    // No "Create task" buttons at all — all replaced by chips
    expect(markup).not.toContain('>Create task<')
    const taskCreatedCount = (markup.match(/Task created/g) ?? []).length
    expect(taskCreatedCount).toBe(sampleAcceptedSteps.length)
  })

  it('carries accessible aria-label for the linked-step chip', () => {
    const markup = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={sampleAcceptedSteps}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={['step-2']}
        />,
    )

    expect(markup).toContain('aria-label="Step 2 task already created"')
  })

  it('shows a different step-number indicator style for linked steps', () => {
    const markupLinked = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={[{ id: 'step-1', stepText: 'Do the thing.' }]}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={['step-1']}
        />,
    )
    const markupUnlinked = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={[{ id: 'step-1', stepText: 'Do the thing.' }]}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={[]}
        />,
    )

    // Linked step uses emerald classes, unlinked uses cyan
    expect(markupLinked).toContain('bg-emerald-100')
    expect(markupUnlinked).toContain('bg-cyan-100')
    expect(markupUnlinked).not.toContain('bg-emerald-100')
  })

  it('does not render "Create task" button for a linked step even when onCreateTaskFromStep is provided', () => {
    const markup = renderToStaticMarkup(
        <AcceptedBreakdownPlanCard
          steps={[{ id: 'step-1', stepText: 'Research the space.' }]}
          onCreateTaskFromStep={() => {}}
          stepActionInFlight={null}
          linkedStepIds={['step-1']}
        />,
    )

    expect(markup).not.toContain('>Create task<')
    expect(markup).not.toContain('aria-label="Create task from step 1"')
    expect(markup).toContain('Task created')
  })

  it('renders no linked chip when linkedStepIds is empty', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
        linkedStepIds={[]}
      />,
    )

    expect(markup).not.toContain('Task created')
  })
})

describe('AcceptedBreakdownPlanCard — completed steps and next candidate', () => {
  const stepsWithCompletion: AcceptedBreakdownStep[] = [
    { id: 'step-1', stepText: 'Research the problem space.', completedAt: '2026-04-10T08:00:00.000Z' },
    { id: 'step-2', stepText: 'Prototype a minimal flow.', completedAt: new Date('2026-04-11T09:00:00.000Z') },
    { id: 'step-3', stepText: 'Ship and measure.', completedAt: null },
    { id: 'step-4', stepText: 'Gather feedback.', completedAt: null },
  ]

  it('renders a "Done" chip for completed steps', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={stepsWithCompletion} />,
    )

    const doneCount = (markup.match(/\bDone\b/g) ?? []).length
    expect(doneCount).toBe(2)
  })

  it('renders "Mark done" buttons for incomplete steps when onCompleteStep is provided', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={stepsWithCompletion}
        onCompleteStep={() => {}}
      />,
    )

    const matches = markup.match(/>Mark done</g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('renders "Undo" for completed steps when onUncompleteStep is provided', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={stepsWithCompletion}
        onUncompleteStep={() => {}}
      />,
    )

    const matches = markup.match(/>Undo</g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('renders linked task result and evidence summaries when provided', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Run quick discovery.', completedAt: null }]}
        linkedStepIds={['step-1']}
        artifactSummariesByStepId={{
          'step-1': {
            result: 'Interviewed 10 nutritionists and identified pricing trust as the main blocker.',
            evidence: '7 of 10 asked for stronger social proof before paying.',
          },
        }}
      />,
    )

    expect(markup).toContain('Result:')
    expect(markup).toContain('pricing trust as the main blocker')
    expect(markup).toContain('Evidence:')
    expect(markup).toContain('7 of 10 asked for stronger social proof')
  })

  it('does not render Undo for linked-task-derived completion', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[
          {
            id: 'step-1',
            stepText: 'Completed through linked task.',
            completedAt: '2026-04-10T08:00:00.000Z',
            completedSource: 'linked-task',
          },
        ]}
        onUncompleteStep={() => {}}
      />,
    )

    expect(markup).toContain('>Done<')
    expect(markup).not.toContain('>Undo<')
  })

  it('shows pending labels for completion mutations', () => {
    const completingMarkup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCompleteStep={() => {}}
        stepActionInFlight={{ stepId: 'step-2', action: 'complete' }}
      />,
    )
    const uncompletingMarkup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Done.', completedAt: '2026-04-10T08:00:00.000Z' }]}
        onUncompleteStep={() => {}}
        stepActionInFlight={{ stepId: 'step-1', action: 'uncomplete' }}
      />,
    )

    expect(completingMarkup).toContain('Marking…')
    expect(uncompletingMarkup).toContain('Undoing…')
  })

  it('carries accessible aria-labels for completion toggle buttons', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[
          { id: 'step-1', stepText: 'Pending.', completedAt: null },
          { id: 'step-2', stepText: 'Done.', completedAt: '2026-04-10T08:00:00.000Z' },
        ]}
        onCompleteStep={() => {}}
        onUncompleteStep={() => {}}
      />,
    )

    expect(markup).toContain('aria-label="Mark step 1 done"')
    expect(markup).toContain('aria-label="Mark step 2 as not done"')
  })

  it('disables all step buttons while any step action is pending', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        onCompleteStep={() => {}}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={{ stepId: 'step-1', action: 'complete' }}
      />,
    )

    const disabledCount = (markup.match(/disabled=""/g) ?? []).length
    expect(disabledCount).toBe(sampleAcceptedSteps.length * 2)
  })

  it('applies line-through styling to completed step text', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={stepsWithCompletion} />,
    )

    expect(markup).toContain('line-through')
  })

  it('renders slate indicator for completed steps (not cyan or emerald)', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Done thing.', completedAt: '2026-04-10T08:00:00.000Z' }]}
      />,
    )

    expect(markup).toContain('bg-slate-100')
    expect(markup).not.toContain('bg-cyan-100')
    expect(markup).not.toContain('bg-emerald-100')
  })

  it('marks the first incomplete, non-linked step as Next', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={stepsWithCompletion} />,
    )

    // step-3 is the first incomplete step
    expect(markup).toContain('Next')
    expect(markup).toContain('Step 3 is the next recommended step')
  })

  it('does not mark a completed step as Next', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[
          { id: 'step-1', stepText: 'Done.', completedAt: '2026-04-10T08:00:00.000Z' },
          { id: 'step-2', stepText: 'Not done.', completedAt: null },
        ]}
      />,
    )

    // Next badge must be on step-2, not step-1
    expect(markup).toContain('Step 2 is the next recommended step')
    expect(markup).not.toContain('Step 1 is the next recommended step')
  })

  it('keeps a linked incomplete step as Next when it is first in progression', () => {
    const steps: AcceptedBreakdownStep[] = [
      { id: 'step-1', stepText: 'Linked but not completed.', completedAt: null },
      { id: 'step-2', stepText: 'Real next step.', completedAt: null },
    ]
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={steps} linkedStepIds={['step-1']} />,
    )

    expect(markup).toContain('Step 1 is the next recommended step')
    expect(markup).not.toContain('Step 2 is the next recommended step')
  })

  it('shows no Next badge when all steps are completed', () => {
    const allDone: AcceptedBreakdownStep[] = [
      { id: 'step-1', stepText: 'Done 1.', completedAt: '2026-04-10T08:00:00.000Z' },
      { id: 'step-2', stepText: 'Done 2.', completedAt: '2026-04-11T08:00:00.000Z' },
    ]
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={allDone} />,
    )

    expect(markup).not.toContain('>Next<')
    expect(markup).not.toContain('next recommended step')
  })

  it('still shows Next when all steps are linked but incomplete', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={sampleAcceptedSteps}
        linkedStepIds={['step-1', 'step-2', 'step-3']}
      />,
    )

    expect(markup).toContain('>Next<')
    expect(markup).toContain('Step 1 is the next recommended step')
  })

  it('does not render Done chip for steps with null completedAt', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Pending step.', completedAt: null }]}
      />,
    )

    expect(markup).not.toContain('>Done<')
    expect(markup).not.toContain('line-through')
  })

  it('does not render Done chip for steps with undefined completedAt', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'No completedAt field.' }]}
      />,
    )

    expect(markup).not.toContain('>Done<')
  })

  it('marks first step as Next when none are completed or linked', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={sampleAcceptedSteps} />,
    )

    expect(markup).toContain('Step 1 is the next recommended step')
    expect(markup).not.toContain('Step 2 is the next recommended step')
  })

  it('carries accessible aria-label for Done chip', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Done thing.', completedAt: '2026-04-10T08:00:00.000Z' }]}
      />,
    )

    expect(markup).toContain('aria-label="Step 1 done"')
  })

  it('carries accessible aria-label for Next badge', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'First step.', completedAt: null }]}
      />,
    )

    expect(markup).toContain('aria-label="Step 1 is the next recommended step"')
  })

  it('renders completed step with reduced opacity class', () => {
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard
        steps={[{ id: 'step-1', stepText: 'Completed.', completedAt: '2026-04-10T00:00:00.000Z' }]}
      />,
    )

    expect(markup).toContain('opacity-60')
  })

  it('renders Next badge on step-2 when step-1 is completed and step-3 is linked', () => {
    const steps: AcceptedBreakdownStep[] = [
      { id: 'step-1', stepText: 'Done.', completedAt: '2026-04-10T08:00:00.000Z' },
      { id: 'step-2', stepText: 'Do next.', completedAt: null },
      { id: 'step-3', stepText: 'Later.', completedAt: null },
    ]
    const markup = renderToStaticMarkup(
      <AcceptedBreakdownPlanCard steps={steps} linkedStepIds={[]} />,
    )

    expect(markup).toContain('Step 2 is the next recommended step')
    expect(markup).not.toContain('Step 3 is the next recommended step')
  })
})

describe('IdeaThreadHistory — linked step forwarding', () => {
  it('forwards linkedStepIds so linked steps show "Task created" chip', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        onCompleteLinkedTask={() => {}}
        onCompleteStep={() => {}}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
        linkedStepIds={['step-1']}
      />,
    )

    expect(markup).toContain('Task created')
    expect(markup).not.toContain('aria-label="Mark step 1 done"')
    expect(markup).toContain('aria-label="Complete linked task for step 1"')
    // step-2 and step-3 still get Create task buttons
    const createMatches = markup.match(/>Create task</g) ?? []
    expect(createMatches).toHaveLength(2)
  })

  it('shows no "Task created" chips when linkedStepIds is empty', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        onCreateTaskFromStep={() => {}}
        stepActionInFlight={null}
        linkedStepIds={[]}
      />,
    )

    // No chips, all steps actionable
    expect(markup).not.toContain('Task created')
    const createMatches = markup.match(/>Create task</g) ?? []
    expect(createMatches).toHaveLength(sampleAcceptedSteps.length)
  })
})

describe('IdeaThreadHistory — completion action forwarding', () => {
  it('forwards completion controls to the accepted plan card', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={[
          { id: 'step-1', stepText: 'Pending.', completedAt: null },
          { id: 'step-2', stepText: 'Done.', completedAt: '2026-04-10T08:00:00.000Z' },
        ]}
        onCompleteStep={() => {}}
        onUncompleteStep={() => {}}
      />,
    )

    expect(markup).toContain('Mark done')
    expect(markup).toContain('Undo')
  })

  it('forwards artifact summaries to the accepted plan card', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={[{ id: 'step-1', stepText: 'Run quick discovery.', completedAt: null }]}
        linkedStepIds={['step-1']}
        artifactSummariesByStepId={{
          'step-1': {
            result: 'Interviewed 10 nutritionists and identified pricing trust as the main blocker.',
          },
        }}
      />,
    )

    expect(markup).toContain('Result:')
    expect(markup).toContain('pricing trust as the main blocker')
  })

  it('forwards the stepActionInFlight state to show pending completion labels', () => {
    const markup = renderToStaticMarkup(
      <IdeaThreadHistory
        visibleEvents={[]}
        acceptedBreakdownSteps={sampleAcceptedSteps}
        onCompleteStep={() => {}}
        stepActionInFlight={{ stepId: 'step-2', action: 'complete' }}
      />,
    )

    expect(markup).toContain('Marking…')
  })
})
