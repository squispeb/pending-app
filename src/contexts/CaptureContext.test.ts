import { describe, expect, it } from 'vitest'
import { resolveCaptureOpenTargets } from './CaptureContext'

describe('capture open targets', () => {
  it('keeps idea detail capture in the general voice pipeline when bypassing thread reply', () => {
    expect(resolveCaptureOpenTargets('idea-123', { bypassThreadReply: true })).toEqual({
      captureThreadIdeaId: null,
      captureContextIdeaId: 'idea-123',
    })
  })

  it('preserves thread reply behavior by default', () => {
    expect(resolveCaptureOpenTargets('idea-123')).toEqual({
      captureThreadIdeaId: 'idea-123',
      captureContextIdeaId: null,
    })
  })
})
