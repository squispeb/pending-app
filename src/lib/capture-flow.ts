import type { CandidateType } from './capture'

export function shouldAutoCreateIdeaCapture(options: {
  resolvedType: CandidateType
  isThreadReplyCapture: boolean
}) {
  return options.resolvedType === 'idea' && !options.isThreadReplyCapture
}
