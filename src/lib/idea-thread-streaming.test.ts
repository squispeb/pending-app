import { describe, expect, it } from 'vitest'
import { shouldEnableIdeaThreadFallbackPolling } from './idea-thread-streaming'

describe('idea thread fallback polling', () => {
  it('stays disabled while the stream is healthy', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: true,
      streamFallbackPollEnabled: false,
    })).toBe(false)
  })

  it('enables polling only when the thread is busy and the stream fallback is active', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: true,
      streamFallbackPollEnabled: true,
    })).toBe(true)
  })

  it('stays disabled when the thread is idle even if fallback was enabled', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: false,
      streamFallbackPollEnabled: true,
    })).toBe(false)
  })
})
