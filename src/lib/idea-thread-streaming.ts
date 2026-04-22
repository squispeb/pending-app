import { applyIdeaThreadStreamSessionEvent, parseIdeaThreadStreamFrames, type IdeaThreadStreamSessionState } from './idea-thread-stream'

export function shouldEnableIdeaThreadFallbackPolling(input: {
  isThreadBusy: boolean
  streamFallbackPollEnabled: boolean
}) {
  return input.isThreadBusy && input.streamFallbackPollEnabled
}

export async function applyIdeaThreadStreamResponse(input: {
  response: Response
  sessionState: IdeaThreadStreamSessionState
  onThreadSnapshot: (snapshot: unknown) => void
  onSessionState: (nextState: IdeaThreadStreamSessionState) => void
  onStreamingAssistantText: (text: string) => void
  onActiveStructuredAction: (action: IdeaThreadStreamSessionState['activeStructuredAction']) => void
  onLastStructuredActionError: (error: IdeaThreadStreamSessionState['lastFailedStructuredAction']) => void
}) {
  if (!input.response.body) {
    return
  }

  const reader = input.response.body
    .pipeThrough(new TextDecoderStream())
    .getReader()
  let buffer = ''
  let sessionState = input.sessionState

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    buffer += value
    const parsed = parseIdeaThreadStreamFrames(buffer)
    buffer = parsed.remainder

    for (const payload of parsed.events) {
      const applied = applyIdeaThreadStreamSessionEvent(sessionState, payload)

      if (!applied.didApply) {
        continue
      }

      sessionState = applied.nextSessionState
      input.onSessionState(sessionState)

      if (applied.appliedState.nextThreadSnapshot) {
        input.onThreadSnapshot(applied.appliedState.nextThreadSnapshot)
      }

      input.onActiveStructuredAction(applied.appliedState.activeStructuredAction)
      input.onLastStructuredActionError(applied.appliedState.lastFailedStructuredAction)
      input.onStreamingAssistantText(applied.appliedState.streamingAssistantText)
    }
  }
}
