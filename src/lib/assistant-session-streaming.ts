import {
  applyAssistantSessionStreamStateEvent,
  parseAssistantSessionStreamFrames,
  type AssistantSessionStreamState,
} from './assistant-session-stream'

export async function applyAssistantSessionStreamResponse(input: {
  response: Response
  sessionState: AssistantSessionStreamState
  onSessionState: (nextState: AssistantSessionStreamState) => void
  onStreamingAssistantText: (text: string) => void
  onSessionSnapshot: (session: AssistantSessionStreamState['latestSession']) => void
  shouldStop?: (event: Parameters<typeof applyAssistantSessionStreamStateEvent>[1], nextState: AssistantSessionStreamState) => boolean
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
    const parsed = parseAssistantSessionStreamFrames(buffer)
    buffer = parsed.remainder

    for (const payload of parsed.events) {
      const applied = applyAssistantSessionStreamStateEvent(sessionState, payload)

      if (!applied.didApply) {
        continue
      }

      sessionState = applied.nextState
      input.onSessionState(sessionState)
      input.onStreamingAssistantText(applied.appliedState.streamingAssistantText)
      input.onSessionSnapshot(applied.appliedState.latestSession)

      if (input.shouldStop?.(payload, sessionState)) {
        await reader.cancel()
        return
      }
    }
  }
}
