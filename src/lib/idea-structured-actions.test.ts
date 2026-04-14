import { describe, expect, it } from 'vitest'
import {
  canUseIdeaRefinementActions,
  getIdeaRefinementActionInput,
  getIdeaRefinementActionLabel,
} from './idea-structured-actions'

describe('idea structured actions', () => {
  it('only enables title and summary refinements for developed ideas', () => {
    expect(canUseIdeaRefinementActions('discovery')).toBe(false)
    expect(canUseIdeaRefinementActions('framing')).toBe(false)
    expect(canUseIdeaRefinementActions('developed')).toBe(true)
  })

  it('creates targeted prompts for title and summary improvement', () => {
    expect(getIdeaRefinementActionInput('title')).toContain('Improve the title only')
    expect(getIdeaRefinementActionInput('summary')).toContain('Improve the summary only')
  })

  it('exposes user-facing labels for both refinement actions', () => {
    expect(getIdeaRefinementActionLabel('title')).toBe('Improve title')
    expect(getIdeaRefinementActionLabel('summary')).toBe('Improve summary')
  })
})
