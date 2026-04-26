import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  CalendarEventSummaryCard,
  SelectedTaskSummaryCard,
  VoiceCalendarClarifyPanel,
  VoiceTaskActionConfirmationPanel,
  VoiceTaskClarifyPanel,
  VoiceTaskStatusPanel,
} from './GlobalCaptureHost'

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

// ---------------------------------------------------------------------------
// SelectedTaskSummaryCard
// ---------------------------------------------------------------------------
describe('SelectedTaskSummaryCard', () => {
  it('renders task title prominently', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Call the bank" status="active" />,
    )
    expect(markup).toContain('Call the bank')
  })

  it('renders active status badge', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Call the bank" status="active" />,
    )
    expect(markup).toContain('Active')
  })

  it('renders completed status badge', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Call the bank" status="completed" />,
    )
    expect(markup).toContain('Completed')
  })

  it('renders due date without time', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" dueDate="2026-05-01" />,
    )
    expect(markup).toContain('Due 2026-05-01')
  })

  it('renders due date with time', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard
        title="Pay rent"
        status="active"
        dueDate="2026-05-01"
        dueTime="09:00"
      />,
    )
    expect(markup).toContain('Due 2026-05-01 at 09:00')
  })

  it('renders priority label', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" priority="high" />,
    )
    expect(markup).toContain('High priority')
  })

  it('renders medium priority label', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" priority="medium" />,
    )
    expect(markup).toContain('Medium priority')
  })

  it('renders low priority label', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" priority="low" />,
    )
    expect(markup).toContain('Low priority')
  })

  it('renders source label for visible_window source', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" source="visible_window" />,
    )
    expect(markup).toContain('From screen')
  })

  it('does not render source label for context_task (obvious by context)', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" source="context_task" />,
    )
    expect(markup).not.toContain('From context')
  })

  it('omits optional fields when not provided', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard title="Pay rent" status="active" />,
    )
    expect(markup).not.toContain('Due')
    expect(markup).not.toContain('priority')
  })

  it('renders task notes when provided', () => {
    const markup = renderToStaticMarkup(
      <SelectedTaskSummaryCard
        title="Run Quick Discovery"
        status="active"
        notes="Capture risks, constraints, and candidate customer calls."
      />,
    )

    expect(markup).toContain('Capture risks, constraints, and candidate customer calls.')
  })
})

// ---------------------------------------------------------------------------
// VoiceTaskStatusPanel
// ---------------------------------------------------------------------------
describe('GlobalCaptureHost voice panels', () => {
  it('renders the task status panel with status message and done button', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskStatusPanel
        transcript="What is the status of this task?"
        message='The task "Call the bank" is completed.'
        onDone={() => {}}
      />,
    )

    expect(markup).toContain('The task &quot;Call the bank&quot; is completed.')
    expect(markup).toContain('Done')
    // Transcript block removed
    expect(markup).not.toContain('Transcript')
    expect(markup).not.toContain('What is the status of this task?')
  })

  it('renders the task status panel with a selected task summary card', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskStatusPanel
        transcript="What is the status of my call task?"
        message='The task "Call the bank" is active.'
        task={{
          title: 'Call the bank',
          status: 'active',
          dueDate: '2026-05-10',
          dueTime: '10:00',
          priority: 'high',
          source: 'visible_window',
        }}
        onDone={() => {}}
      />,
    )

    expect(markup).toContain('Call the bank')
    expect(markup).toContain('Active')
    expect(markup).toContain('Due 2026-05-10 at 10:00')
    expect(markup).toContain('High priority')
    expect(markup).toContain('From screen')
    expect(markup).toContain('The task')
    // Transcript not rendered
    expect(markup).not.toContain('What is the status of my call task?')
  })

  it('renders the task status panel without a task card when task is not provided', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskStatusPanel
        transcript="What is the status of this task?"
        message='The task "Call the bank" is completed.'
        onDone={() => {}}
      />,
    )

    // No task card section header
    expect(markup).not.toContain('>Task<')
  })

  it('renders the task action confirmation panel with action prompt and controls', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Mark this task as done"
        message='I understood that as completing the task "Call the bank". Confirm if you want me to mark it as completed.'
        actionLabel="Complete this task"
        confirmLabel="Complete task"
        isConfirming={false}
        error={null}
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Complete this task')
    expect(markup).toContain('Complete task')
    expect(markup).toContain('Cancel')
    // Transcript and "Pending action" label removed
    expect(markup).not.toContain('Transcript')
    expect(markup).not.toContain('Mark this task as done')
    expect(markup).not.toContain('Pending action')
  })

  it('renders the task action confirmation panel with a selected task summary card', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Complete my bank task"
        message='I understood that as completing the task "Call the bank". Confirm if you want me to mark it as completed.'
        actionLabel="Complete this task"
        confirmLabel="Complete task"
        isConfirming={false}
        error={null}
        task={{
          title: 'Call the bank',
          status: 'active',
          dueDate: '2026-05-15',
          dueTime: null,
          priority: 'medium',
          source: 'context_task',
        }}
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Call the bank')
    expect(markup).toContain('Active')
    expect(markup).toContain('Due 2026-05-15')
    expect(markup).toContain('Medium priority')
    expect(markup).toContain('Complete this task')
    expect(markup).toContain('Cancel')
  })

  it('renders structured task edit confirmation fields instead of prose', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Change the due date"
        message='I understood that as editing the task "Run Quick Discovery" to set due date to 2026-05-01. Confirm if you want me to apply those changes.'
        actionLabel="Apply these edits"
        confirmLabel="Apply edits"
        isConfirming={false}
        error={null}
        task={{
          title: 'Run Quick Discovery',
          status: 'active',
          dueDate: '2026-04-10',
          dueTime: null,
          priority: 'medium',
          source: 'visible_window',
        }}
        edits={{
          dueDate: '2026-05-01',
        }}
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Apply these edits')
    expect(markup).toContain('Due date')
    expect(markup).toContain('May 1, 2026')
    expect(markup).not.toContain('I understood that as editing the task')
  })

  it('renders combined due date and due time in the structured edit summary', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Move it to next Saturday at six p.m."
        message='I understood that as editing the task "Run Quick Discovery" to set due date to 2026-05-02 and due time to 18:00. Confirm if you want me to apply those changes.'
        actionLabel="Apply these edits"
        confirmLabel="Apply edits"
        isConfirming={false}
        error={null}
        task={{
          title: 'Run Quick Discovery',
          status: 'active',
          dueDate: '2026-04-10',
          dueTime: null,
          priority: 'medium',
          source: 'visible_window',
        }}
        edits={{
          dueDate: '2026-05-02',
          dueTime: '18:00',
        }}
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Due date')
    expect(markup).toContain('May 2, 2026 at 6:00 PM')
    expect(markup).not.toContain('Due time')
  })

  it('renders archive confirmation labels for task archive actions', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Archive this task"
        message='I understood that as archiving the task "Call the bank". Confirm if you want me to archive it.'
        actionLabel="Archive this task"
        confirmLabel="Archive task"
        isConfirming={false}
        error={null}
        task={{
          title: 'Call the bank',
          status: 'active',
          dueDate: null,
          dueTime: null,
          priority: 'medium',
          source: 'context_task',
        }}
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Archive this task')
    expect(markup).toContain('Archive task')
    expect(markup).toContain('Call the bank')
  })

  it('renders voice action confirmation errors inline', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskActionConfirmationPanel
        transcript="Reopen this task"
        message='I understood that as reopening the task "Call the bank". Confirm if you want me to move it back to active.'
        actionLabel="Reopen this task"
        confirmLabel="Reopen task"
        isConfirming={false}
        error="Failed to update task status."
        onConfirm={(event) => event.preventDefault()}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Failed to update task status.')
  })

  it('renders the task clarify panel with task details and voice reply affordance', () => {
    const markup = renderToStaticMarkup(
      <VoiceTaskClarifyPanel
        transcript="I want us to edit the Run Quick Discovery task."
        message='What would you like to change on "Run Quick Discovery"?'
        questions={[]}
        reply=""
        isSubmitting={false}
        isRecording={false}
        error={null}
        streamingAssistantText="Updating the due date..."
        taskAction="edit_task"
        task={{
          title: 'Run Quick Discovery',
          status: 'active',
          notes: 'Capture risks, constraints, and candidate customer calls.',
          dueDate: '2026-04-10',
          dueTime: null,
          priority: 'high',
          source: 'context_task',
        }}
        onReplyChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
        onStartVoiceReply={() => {}}
        onEditFromScratch={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Run Quick Discovery')
    expect(markup).toContain('Capture risks, constraints, and candidate customer calls.')
    expect(markup).toContain('What would you like to change on &quot;Run Quick Discovery&quot;?')
    expect(markup).toContain('Updating the due date...')
    expect(markup).toContain('Reply with voice')
    expect(markup).toContain('Describe the task change you want…')
    expect(markup).not.toContain('Assistant tip')
  })

  it('renders a structured calendar event summary', () => {
    const markup = renderToStaticMarkup(
      <CalendarEventSummaryCard
        event={{
          title: 'Team sync',
          startDate: '2026-05-03',
          startTime: '09:30',
          endDate: '2026-05-03',
          endTime: '10:00',
          location: 'Room A',
          targetCalendarName: 'Work',
        }}
      />,
    )

    expect(markup).toContain('Team sync')
    expect(markup).toContain('May 3, 2026 at 9:30 AM until 10:00 AM')
    expect(markup).toContain('Room A')
    expect(markup).toContain('Work')
  })

  it('renders the calendar clarify panel with event context and voice reply affordance', () => {
    const markup = renderToStaticMarkup(
      <VoiceCalendarClarifyPanel
        transcript="Agrega una reunion en el calendario personal"
        message={`I couldn't find a writable calendar named "personal".`}
        questions={['Which calendar should I use instead? Available writable calendars: Work, Family.']}
        reply=""
        isSubmitting={false}
        isRecording={false}
        error={null}
        streamingAssistantText="Checking calendars..."
        calendarEvent={{
          startDate: '2026-05-03',
          allDay: true,
          targetCalendarName: 'personal',
        }}
        onReplyChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
        onStartVoiceReply={() => {}}
        onEditFromScratch={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(markup).toContain('Event so far')
    expect(markup).toContain('May 3, 2026 all day')
    expect(markup).toContain('personal')
    expect(markup).toContain('Checking calendars...')
    expect(markup).toContain('Reply with voice')
    expect(markup).toContain('Which calendar should I use instead? Available writable calendars: Work, Family.')
  })
})
