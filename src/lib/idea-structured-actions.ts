import type { z } from 'zod'
import { ideaStageSchema } from './ideas'

export type IdeaStage = z.infer<typeof ideaStageSchema>
export type IdeaRefinementAction = 'title' | 'summary'

export function canUseIdeaRefinementActions(stage: IdeaStage) {
  return stage === 'developed'
}

export function getIdeaRefinementActionLabel(action: IdeaRefinementAction) {
  switch (action) {
    case 'title':
      return 'Improve title'
    case 'summary':
      return 'Improve summary'
  }
}
