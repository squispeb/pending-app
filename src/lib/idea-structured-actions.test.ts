import { describe, expect, it } from 'vitest'
import {
  canUseIdeaRefinementActions,
  getIdeaStructuredActionLabel,
} from './idea-structured-actions'

describe('idea structured actions', () => {
  it('only enables title and summary refinements for developed ideas', () => {
    expect(canUseIdeaRefinementActions('discovery')).toBe(false)
    expect(canUseIdeaRefinementActions('framing')).toBe(false)
    expect(canUseIdeaRefinementActions('developed')).toBe(true)
  })

  it('exposes user-facing labels for both refinement actions', () => {
    expect(getIdeaStructuredActionLabel('title')).toBe('Improve title')
    expect(getIdeaStructuredActionLabel('summary')).toBe('Improve summary')
    expect(getIdeaStructuredActionLabel('restructure')).toBe('Restructure idea')
    expect(getIdeaStructuredActionLabel('breakdown')).toBe('Break into next steps')
  })
})
