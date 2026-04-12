import { describe, expect, it } from 'vitest'
import { deriveThreadState, getThreadEventPresentation } from './idea-thread-presentation'

describe('idea thread presentation', () => {
  it('derives a pending proposal state from the latest visible proposal event', () => {
    const state = deriveThreadState([
      { type: 'thread_created' },
      { type: 'proposal_created' },
    ])

    expect(state.label).toBe('Proposal pending')
    expect(state.badgeClassName).toContain('amber')
  })

  it('uses the latest visible non-bootstrap event as the thread state', () => {
    const state = deriveThreadState([
      { type: 'thread_created' },
      { type: 'proposal_created' },
      { type: 'proposal_rejected' },
    ])

    expect(state.label).toBe('Proposal rejected')
    expect(state.badgeClassName).toContain('rose')
  })

  it('derives approval, rejection, and failure states distinctly', () => {
    expect(deriveThreadState([{ type: 'proposal_approved' }]).label).toBe('Proposal approved')
    expect(deriveThreadState([{ type: 'proposal_rejected' }]).label).toBe('Proposal rejected')
    expect(deriveThreadState([{ type: 'assistant_failed' }]).label).toBe('Assistant failed')
  })

  it('falls back to a ready state when only thread creation is visible', () => {
    const state = deriveThreadState([{ type: 'thread_created' }])

    expect(state.label).toBe('Thread ready')
  })

  it('returns distinct event labels and treatments for each visible event family', () => {
    expect(getThreadEventPresentation('proposal_created')).toMatchObject({
      label: 'Proposal created',
      iconClassName: 'text-amber-500',
    })
    expect(getThreadEventPresentation('proposal_approved')).toMatchObject({
      label: 'Proposal approved',
      iconClassName: 'text-emerald-500',
    })
    expect(getThreadEventPresentation('proposal_rejected')).toMatchObject({
      label: 'Proposal rejected',
      iconClassName: 'text-rose-500',
    })
    expect(getThreadEventPresentation('assistant_failed')).toMatchObject({
      label: 'Assistant failed',
      iconClassName: 'text-red-500',
    })
  })
})
