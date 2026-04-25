import { describe, expect, it } from 'vitest'
import {
  applyAssistantSessionStreamStateEvent,
  createAssistantSessionStreamState,
  parseAssistantSessionStreamFrames,
} from './assistant-session-stream'

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    channel: 'mixed',
    status: 'streaming',
    activeTurn: null,
    queuedTurns: [],
    lastTurn: null,
    visibleEvents: [],
    context: null,
    workflow: {
      kind: 'task_edit',
      phase: 'collecting',
      task: {
        taskId: 'task-1',
        title: 'Run Quick Discovery',
        notes: null,
        dueDate: '2026-04-10',
        dueTime: null,
        priority: 'high',
      },
      requestedFields: [],
      missingFields: [],
      activeField: 'dueDate',
      fieldAttempts: { title: 0, description: 0, dueDate: 1 },
      changes: {},
      result: null,
    },
    ...overrides,
  }
}

describe('assistant session stream', () => {
  it('parses SSE frames and assigns the frame id when missing from payload', () => {
    const parsed = parseAssistantSessionStreamFrames(
      'id: evt-1\ndata: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\n\n',
    )

    expect(parsed.remainder).toBe('')
    expect(parsed.events).toEqual([
      {
        streamEventId: 'evt-1',
        type: 'assistant_chunk',
        turnId: 'turn-1',
        textDelta: 'Hello',
      },
    ])
  })

  it('accumulates assistant chunks and ignores duplicate stream events', () => {
    let state = createAssistantSessionStreamState()

    const firstApplied = applyAssistantSessionStreamStateEvent(state, {
      streamEventId: 'evt-1',
      type: 'assistant_chunk',
      turnId: 'turn-1',
      textDelta: 'Change the due ',
    })
    state = firstApplied.nextState

    const secondApplied = applyAssistantSessionStreamStateEvent(state, {
      streamEventId: 'evt-2',
      type: 'assistant_chunk',
      turnId: 'turn-1',
      textDelta: 'date to tomorrow.',
    })
    state = secondApplied.nextState

    const duplicateApplied = applyAssistantSessionStreamStateEvent(state, {
      streamEventId: 'evt-2',
      type: 'assistant_chunk',
      turnId: 'turn-1',
      textDelta: 'ignored',
    })

    expect(state.streamingAssistantText).toBe('Change the due date to tomorrow.')
    expect(duplicateApplied.didApply).toBe(false)
    expect(duplicateApplied.nextState.streamingAssistantText).toBe('Change the due date to tomorrow.')
  })

  it('captures the settled session on turn completion', () => {
    let state = createAssistantSessionStreamState()

    state = applyAssistantSessionStreamStateEvent(state, {
      streamEventId: 'evt-1',
      type: 'assistant_chunk',
      turnId: 'turn-1',
      textDelta: 'Working on it',
    }).nextState

    state = applyAssistantSessionStreamStateEvent(state, {
      streamEventId: 'evt-2',
      type: 'turn_completed',
      turnId: 'turn-1',
      session: makeSession({
        status: 'idle',
        workflow: {
          kind: 'task_edit',
          phase: 'ready_to_confirm',
          task: {
            taskId: 'task-1',
            title: 'Run Quick Discovery',
            notes: null,
            dueDate: '2026-04-10',
            dueTime: null,
            priority: 'high',
          },
          requestedFields: ['dueDate'],
          missingFields: [],
          activeField: null,
          fieldAttempts: { title: 0, description: 0, dueDate: 1 },
          changes: { dueDate: '2026-04-09' },
          result: null,
        },
      }),
    }).nextState

    expect(state.streamingAssistantText).toBe('')
    expect(state.activeStreamingTurnId).toBeNull()
    expect(state.latestSession?.workflow).toMatchObject({
      kind: 'task_edit',
      phase: 'ready_to_confirm',
      changes: { dueDate: '2026-04-09' },
    })
  })
})
