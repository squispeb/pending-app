import { describe, expect, it } from 'vitest'
import {
  canUseIdeaStructuredActions,
  getIdeaActionLockedReason,
  getIdeaStageActionGuidance,
  getIdeaStructuredActionAvailability,
  canUseIdeaRefinementActions,
  getIdeaStructuredActionLabel,
} from './idea-structured-actions'

describe('idea structured actions', () => {
  it('only enables title and summary refinements for developed ideas', () => {
    expect(canUseIdeaRefinementActions('discovery')).toBe(false)
    expect(canUseIdeaRefinementActions('framing')).toBe(false)
    expect(canUseIdeaRefinementActions('developed')).toBe(true)
  })

  it('enables later structured actions once the thread reaches framing', () => {
    expect(canUseIdeaStructuredActions('discovery')).toBe(false)
    expect(canUseIdeaStructuredActions('framing')).toBe(true)
    expect(canUseIdeaStructuredActions('developed')).toBe(true)
  })

  it('exposes stage-aware availability per action', () => {
    expect(getIdeaStructuredActionAvailability('restructure', 'discovery')).toBe('locked')
    expect(getIdeaStructuredActionAvailability('restructure', 'framing')).toBe('available')
    expect(getIdeaStructuredActionAvailability('breakdown', 'framing')).toBe('locked')
    expect(getIdeaStructuredActionAvailability('breakdown', 'developed')).toBe('available')
    expect(getIdeaStructuredActionAvailability('summary', 'developed')).toBe('available')
    expect(getIdeaStructuredActionAvailability('convert-to-task', 'discovery')).toBe('locked')
    expect(getIdeaStructuredActionAvailability('convert-to-task', 'framing')).toBe('locked')
    expect(getIdeaStructuredActionAvailability('convert-to-task', 'developed')).toBe('available')
  })

  it('explains the current stage guidance', () => {
    expect(getIdeaStageActionGuidance('discovery').title).toBe('Discovery comes first')
    expect(getIdeaStageActionGuidance('framing').title).toBe('Framing is ready for structure')
    expect(getIdeaStageActionGuidance('developed').title).toBe('Developed ideas can use later actions')
  })

  it('explains why locked actions are unavailable', () => {
    expect(getIdeaActionLockedReason('restructure', 'discovery')).toBe('Restructure unlocks once the idea reaches framing.')
    expect(getIdeaActionLockedReason('breakdown', 'framing')).toBe('Next-step breakdown unlocks once the idea reaches developed.')
    expect(getIdeaActionLockedReason('summary', 'discovery')).toBe('Summary improvement unlocks once the idea reaches developed.')
    expect(getIdeaActionLockedReason('title', 'developed')).toBeNull()
    expect(getIdeaActionLockedReason('convert-to-task', 'discovery')).toBe('Convert to task unlocks once the idea reaches developed.')
    expect(getIdeaActionLockedReason('convert-to-task', 'framing')).toBe('Convert to task unlocks once the idea reaches developed.')
    expect(getIdeaActionLockedReason('convert-to-task', 'developed')).toBeNull()
  })

  it('exposes user-facing labels for both refinement actions', () => {
    expect(getIdeaStructuredActionLabel('title')).toBe('Improve title')
    expect(getIdeaStructuredActionLabel('summary')).toBe('Improve summary')
    expect(getIdeaStructuredActionLabel('restructure')).toBe('Restructure idea')
    expect(getIdeaStructuredActionLabel('breakdown')).toBe('Break into next steps')
    expect(getIdeaStructuredActionLabel('convert-to-task')).toBe('Convert to task')
  })
})
