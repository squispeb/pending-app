export function shouldEnableIdeaThreadFallbackPolling(input: {
  isThreadBusy: boolean
  streamFallbackPollEnabled: boolean
}) {
  return input.isThreadBusy && input.streamFallbackPollEnabled
}
