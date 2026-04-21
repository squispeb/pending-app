import { describe, expect, it } from 'vitest'
import { deriveThreadState, getThreadEventPresentation } from './idea-thread-presentation'

describe('idea thread presentation', () => {
  it('derives an updated state from the latest assistant synthesis event', () => {
    const state = deriveThreadState([
      { type: 'thread_created' },
      { type: 'assistant_synthesis' },
    ])

    expect(state.label).toBe('Assistant updated')
    expect(state.badgeClassName).toContain('amber')
  })

  it('uses the latest visible non-bootstrap event as the thread state', () => {
    const state = deriveThreadState([
      { type: 'thread_created' },
      { type: 'assistant_synthesis' },
      { type: 'stage_changed' },
    ])

    expect(state.label).toBe('Stage updated')
    expect(state.badgeClassName).toContain('sky')
  })

  it('derives discovery guidance and failure states distinctly', () => {
    expect(deriveThreadState([{ type: 'assistant_question' }]).label).toBe('Assistant guiding')
    expect(deriveThreadState([{ type: 'stage_changed' }]).label).toBe('Stage updated')
    expect(deriveThreadState([{ type: 'assistant_failed' }]).label).toBe('Assistant failed')
  })

  it('prefers queue-aware status over event-derived readiness', () => {
    const state = deriveThreadState({
      status: 'queued',
      visibleEvents: [{ type: 'thread_created' }],
      queuedTurns: [
        {
          turnId: 'turn-2',
          source: 'text',
          userMessage: 'Add notes about activation metrics too.',
          transcriptLanguage: null,
          state: 'queued',
          createdAt: '2026-04-12T00:00:30.000Z',
          completedAt: null,
        },
      ],
    })

    expect(state.label).toBe('Queued (1)')
    expect(state.badgeClassName).toContain('indigo')
  })

  it('surfaces processing helper text from the active turn', () => {
    const state = deriveThreadState({
      status: 'processing',
      visibleEvents: [{ type: 'assistant_question' }],
      activeTurn: {
        turnId: 'turn-1',
        source: 'text',
        userMessage: 'Reduce onboarding drop-off for first-time users.',
        transcriptLanguage: null,
        state: 'processing',
        createdAt: '2026-04-12T00:00:00.000Z',
        completedAt: null,
      },
    })

    expect(state.label).toBe('Assistant thinking')
    expect(state.helperText).toContain('Reduce onboarding drop-off')
  })

  it('prefers optimistic activity before thread status changes arrive', () => {
    const state = deriveThreadState({
      status: 'idle',
      visibleEvents: [{ type: 'thread_created' }],
      optimisticActivity: {
        label: 'Preparing breakdown',
        badgeClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
        helperText: 'The assistant is turning this idea into concrete next steps.',
      },
    })

    expect(state.label).toBe('Preparing breakdown')
    expect(state.helperText).toContain('concrete next steps')
    expect(state.badgeClassName).toContain('cyan')
  })

  it('falls back to a ready state when only thread creation is visible', () => {
    const state = deriveThreadState([{ type: 'thread_created' }])

    expect(state.label).toBe('Discovery ready')
  })

  it('ignores user turns when deriving the thread status badge', () => {
    const state = deriveThreadState([
      { type: 'thread_created' },
      { type: 'user_turn_added' },
    ])

    expect(state.label).toBe('Discovery ready')
  })

  it('returns distinct event labels and treatments for each visible event family', () => {
    expect(getThreadEventPresentation('user_turn_added')).toMatchObject({
      label: 'Your reply',
      iconClassName: 'text-sky-500',
    })
    expect(getThreadEventPresentation('assistant_synthesis')).toMatchObject({
      label: 'Assistant synthesis',
      iconClassName: 'text-violet-500',
    })
    expect(getThreadEventPresentation('assistant_question')).toMatchObject({
      label: 'Assistant asked',
      iconClassName: 'text-emerald-500',
    })
    expect(getThreadEventPresentation('stage_changed')).toMatchObject({
      label: 'Stage changed',
      iconClassName: 'text-sky-500',
    })
    expect(getThreadEventPresentation('assistant_failed')).toMatchObject({
      label: 'Assistant failed',
      iconClassName: 'text-red-500',
    })
    expect(getThreadEventPresentation('breakdown_plan_recorded')).toMatchObject({
      label: 'Plan recorded',
      iconClassName: 'text-cyan-500',
    })
    expect(getThreadEventPresentation('step_status_changed')).toMatchObject({
      label: 'Step updated',
      iconClassName: 'text-emerald-500',
    })
    expect(getThreadEventPresentation('task_created')).toMatchObject({
      label: 'Task created',
      iconClassName: 'text-emerald-500',
      cardClassName: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-500/10',
    })
  })

  it('derives plan and step progress states distinctly', () => {
    expect(deriveThreadState([{ type: 'breakdown_plan_recorded' }]).label).toBe('Plan recorded')
    expect(deriveThreadState([{ type: 'step_status_changed' }]).label).toBe('Step updated')
  })
})
