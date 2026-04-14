import type { z } from 'zod'
import { ideaStageSchema } from './ideas'

export type IdeaStage = z.infer<typeof ideaStageSchema>
export type IdeaRefinementAction = 'title' | 'summary'

export function canUseIdeaRefinementActions(stage: IdeaStage) {
  return stage === 'developed'
}

export function getIdeaRefinementActionInput(action: IdeaRefinementAction) {
  switch (action) {
    case 'title':
      return 'Improve the title only. Keep the existing summary aligned with the discovery context and do not broaden the idea beyond what the thread already established.'
    case 'summary':
      return 'Improve the summary only. Keep it concise, product-relevant, and grounded in the discovery context already established in the thread.'
  }
}

export function getIdeaRefinementActionLabel(action: IdeaRefinementAction) {
  switch (action) {
    case 'title':
      return 'Improve title'
    case 'summary':
      return 'Improve summary'
  }
}
