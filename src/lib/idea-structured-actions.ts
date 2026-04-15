import type { z } from 'zod'
import { ideaStageSchema } from './ideas'

export type IdeaStage = z.infer<typeof ideaStageSchema>
export type IdeaStructuredAction = 'title' | 'summary' | 'restructure' | 'breakdown'
export type IdeaRefinementAction = Extract<IdeaStructuredAction, 'title' | 'summary'>
export type IdeaRestructureAction = Extract<IdeaStructuredAction, 'restructure' | 'breakdown'>

export function canUseIdeaRefinementActions(stage: IdeaStage) {
  return stage === 'developed'
}

export function canUseIdeaStructuredActions(stage: IdeaStage) {
  return stage === 'framing' || stage === 'developed'
}

export function getIdeaStructuredActionAvailability(action: IdeaStructuredAction, stage: IdeaStage) {
  if (action === 'restructure') {
    return stage === 'discovery' ? 'locked' : 'available'
  }

  if (action === 'breakdown') {
    return stage === 'developed' ? 'available' : 'locked'
  }

  return stage === 'developed' ? 'available' : 'locked'
}

export function getIdeaStageActionGuidance(stage: IdeaStage) {
  switch (stage) {
    case 'discovery':
      return {
        title: 'Discovery comes first',
        description: 'Keep building the working idea with purpose, users, impact, scope, research, constraints, and open questions before later review actions unlock.',
      }
    case 'framing':
      return {
        title: 'Framing is ready for structure',
        description: 'The thread has enough context for a clearer framing pass. Keep refining the idea in-thread until it is developed enough for sharper wording and next-step planning.',
      }
    case 'developed':
      return {
        title: 'Developed ideas can use later actions',
        description: 'Use these guided actions when you want the assistant to tighten the framing, sharpen the wording, or turn the current idea into concrete next steps without leaving the thread.',
      }
  }
}

export function getIdeaActionLockedReason(action: IdeaStructuredAction, stage: IdeaStage) {
  if (getIdeaStructuredActionAvailability(action, stage) === 'available') {
    return null
  }

  switch (action) {
    case 'title':
      return 'Title improvement unlocks once the idea reaches developed.'
    case 'summary':
      return 'Summary improvement unlocks once the idea reaches developed.'
    case 'restructure':
      return 'Restructure unlocks once the idea reaches framing.'
    case 'breakdown':
      return 'Next-step breakdown unlocks once the idea reaches developed.'
  }
}

export function getIdeaStructuredActionLabel(action: IdeaStructuredAction) {
  switch (action) {
    case 'title':
      return 'Improve title'
    case 'summary':
      return 'Improve summary'
    case 'restructure':
      return 'Restructure idea'
    case 'breakdown':
      return 'Break into next steps'
  }
}
