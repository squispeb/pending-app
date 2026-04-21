export type IdeaThreadStreamEvent =
  | { streamEventId?: string; type: 'turn_started'; turnId: string }
  | { streamEventId?: string; type: 'structured_action_started'; action: 'restructure' | 'breakdown' | 'convert-to-task' }
  | { streamEventId?: string; type: 'assistant_chunk'; turnId: string; textDelta: string }
  | {
      streamEventId?: string
      type: 'structured_action_completed'
      action: 'restructure' | 'breakdown' | 'convert-to-task'
      thread: unknown
    }
  | {
      streamEventId?: string
      type: 'structured_action_failed'
      action: 'restructure' | 'breakdown' | 'convert-to-task'
      message: string
      thread: unknown
    }
  | { streamEventId?: string; type: 'working_idea_updated'; thread: unknown }
  | { streamEventId?: string; type: 'turn_completed'; turnId: string; thread: unknown }
  | { streamEventId?: string; type: 'turn_failed'; turnId: string; message: string; thread: unknown }

export type IdeaThreadStreamApplicationState = {
  streamingAssistantText: string
  activeStreamingTurnId: string | null
  completedTurnIds: Set<string>
  activeStructuredAction: 'restructure' | 'breakdown' | 'convert-to-task' | null
  lastCompletedStructuredAction: 'restructure' | 'breakdown' | 'convert-to-task' | null
  lastFailedStructuredAction: {
    action: 'restructure' | 'breakdown' | 'convert-to-task'
    message: string
  } | null
  nextThreadSnapshot?: unknown
}

export function applyIdeaThreadStreamEvent(
  state: IdeaThreadStreamApplicationState,
  event: IdeaThreadStreamEvent,
) {
  const nextState: IdeaThreadStreamApplicationState = {
    streamingAssistantText: state.streamingAssistantText,
    activeStreamingTurnId: state.activeStreamingTurnId,
    completedTurnIds: new Set(state.completedTurnIds),
    activeStructuredAction: state.activeStructuredAction,
    lastCompletedStructuredAction: state.lastCompletedStructuredAction,
    lastFailedStructuredAction: state.lastFailedStructuredAction,
    nextThreadSnapshot: undefined,
  }

  if (event.type === 'working_idea_updated') {
    nextState.nextThreadSnapshot = event.thread
    return nextState
  }

  if (event.type === 'structured_action_started') {
    nextState.activeStructuredAction = event.action
    nextState.lastCompletedStructuredAction = null
    nextState.lastFailedStructuredAction = null
    return nextState
  }

  if (event.type === 'structured_action_completed') {
    nextState.activeStructuredAction = null
    nextState.lastCompletedStructuredAction = event.action
    nextState.lastFailedStructuredAction = null
    nextState.nextThreadSnapshot = event.thread
    return nextState
  }

  if (event.type === 'structured_action_failed') {
    nextState.activeStructuredAction = null
    nextState.lastCompletedStructuredAction = null
    nextState.lastFailedStructuredAction = {
      action: event.action,
      message: event.message,
    }
    nextState.nextThreadSnapshot = event.thread
    return nextState
  }

  if (event.type === 'turn_started') {
    if (!nextState.completedTurnIds.has(event.turnId)) {
      nextState.activeStreamingTurnId = event.turnId
      nextState.streamingAssistantText = ''
    }

    return nextState
  }

  if (event.type === 'assistant_chunk') {
    if (nextState.completedTurnIds.has(event.turnId)) {
      return nextState
    }

    if (nextState.activeStreamingTurnId !== event.turnId) {
      nextState.activeStreamingTurnId = event.turnId
      nextState.streamingAssistantText = event.textDelta
      return nextState
    }

    nextState.streamingAssistantText = `${nextState.streamingAssistantText}${event.textDelta}`
    return nextState
  }

  if (event.type === 'turn_completed' || event.type === 'turn_failed') {
    nextState.completedTurnIds.add(event.turnId)
    nextState.streamingAssistantText = ''
    nextState.activeStreamingTurnId = null
    nextState.nextThreadSnapshot = event.thread
    return nextState
  }

  return nextState
}

export function parseIdeaThreadStreamFrames(buffer: string) {
  const normalizedBuffer = buffer.replace(/\r\n?/g, '\n')
  const frames = normalizedBuffer.split('\n\n')
  let remainder = frames.pop() ?? ''
  const events: IdeaThreadStreamEvent[] = []

  for (const [index, frame] of frames.entries()) {
    const lines = frame
      .split('\n')
      .filter((line) => line.length > 0 && !line.startsWith(':'))
    const idLine = lines.find((line) => line.startsWith('id:'))
    const dataLines = lines.filter((line) => line.startsWith('data:'))

    if (dataLines.length === 0) {
      continue
    }

    const payload = dataLines.map((line) => line.slice(5).trimStart()).join('\n')
    let event: IdeaThreadStreamEvent

    try {
      event = JSON.parse(payload) as IdeaThreadStreamEvent
    } catch {
      remainder = [frame, ...frames.slice(index + 1), remainder].filter((value) => value.length > 0).join('\n\n')
      break
    }

    if (idLine && !('streamEventId' in event)) {
      ;(event as { streamEventId?: string }).streamEventId = idLine.slice(3).trimStart()
    }

    events.push(event)
  }

  return {
    events,
    remainder,
  }
}
