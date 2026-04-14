import type { z } from 'zod'
import { ideaStageSchema } from './ideas'

export type IdeaStage = z.infer<typeof ideaStageSchema>
export type IdeaStructuredAction = 'title' | 'summary' | 'restructure' | 'breakdown'
export type IdeaRefinementAction = Extract<IdeaStructuredAction, 'title' | 'summary'>
export type IdeaRestructureAction = Extract<IdeaStructuredAction, 'restructure' | 'breakdown'>

export function canUseIdeaRefinementActions(stage: IdeaStage) {
  return stage === 'developed'
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
