import { describe, expect, it } from 'vitest'
import { shouldAutoCreateIdeaCapture } from './capture-flow'

describe('capture flow', () => {
  it('auto-creates new idea captures instead of sending them to review', () => {
    expect(shouldAutoCreateIdeaCapture({
      resolvedType: 'idea',
      isThreadReplyCapture: false,
    })).toBe(true)
  })

  it('does not auto-create task or habit captures', () => {
    expect(shouldAutoCreateIdeaCapture({ resolvedType: 'task', isThreadReplyCapture: false })).toBe(false)
    expect(shouldAutoCreateIdeaCapture({ resolvedType: 'habit', isThreadReplyCapture: false })).toBe(false)
  })

  it('does not treat thread replies as idea creation', () => {
    expect(shouldAutoCreateIdeaCapture({
      resolvedType: 'idea',
      isThreadReplyCapture: true,
    })).toBe(false)
  })
})
