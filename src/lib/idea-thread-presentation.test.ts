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
    expect(state.badgeClassName).toContain('rose')
  })

  it('derives discovery guidance and failure states distinctly', () => {
    expect(deriveThreadState([{ type: 'assistant_question' }]).label).toBe('Assistant guiding')
    expect(deriveThreadState([{ type: 'stage_changed' }]).label).toBe('Stage updated')
    expect(deriveThreadState([{ type: 'assistant_failed' }]).label).toBe('Assistant failed')
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
      label: 'You added context',
      iconClassName: 'text-sky-500',
    })
    expect(getThreadEventPresentation('assistant_synthesis')).toMatchObject({
      label: 'Assistant synthesis',
      iconClassName: 'text-amber-500',
    })
    expect(getThreadEventPresentation('assistant_question')).toMatchObject({
      label: 'Assistant asked',
      iconClassName: 'text-emerald-500',
    })
    expect(getThreadEventPresentation('stage_changed')).toMatchObject({
      label: 'Stage changed',
      iconClassName: 'text-rose-500',
    })
    expect(getThreadEventPresentation('assistant_failed')).toMatchObject({
      label: 'Assistant failed',
      iconClassName: 'text-red-500',
    })
  })
})
