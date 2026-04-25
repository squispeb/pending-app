import type { AssistantSessionView } from '../server/assistant-service-client'

export type AssistantSessionStreamEvent =
  | { streamEventId?: string; type: 'session_updated'; session: AssistantSessionView }
  | { streamEventId?: string; type: 'assistant_chunk'; turnId: string; textDelta: string }
  | { streamEventId?: string; type: 'turn_completed'; turnId: string; session: AssistantSessionView }
  | { streamEventId?: string; type: 'turn_failed'; turnId: string; message: string; session: AssistantSessionView }

export type AssistantSessionStreamApplicationState = {
  streamingAssistantText: string
  activeStreamingTurnId: string | null
  completedTurnIds: Set<string>
  latestSession: AssistantSessionView | null
  lastFailedTurn: {
    turnId: string
    message: string
  } | null
}

export type AssistantSessionStreamState = AssistantSessionStreamApplicationState & {
  lastStreamEventId: string | null
  streamedEventIds: Set<string>
}

export function createAssistantSessionStreamState(): AssistantSessionStreamState {
  return {
    streamingAssistantText: '',
    activeStreamingTurnId: null,
    completedTurnIds: new Set<string>(),
    latestSession: null,
    lastFailedTurn: null,
    lastStreamEventId: null,
    streamedEventIds: new Set<string>(),
  }
}

export function applyAssistantSessionStreamEvent(
  state: AssistantSessionStreamApplicationState,
  event: AssistantSessionStreamEvent,
) {
  const nextState: AssistantSessionStreamApplicationState = {
    streamingAssistantText: state.streamingAssistantText,
    activeStreamingTurnId: state.activeStreamingTurnId,
    completedTurnIds: new Set(state.completedTurnIds),
    latestSession: state.latestSession,
    lastFailedTurn: state.lastFailedTurn,
  }

  if (event.type === 'session_updated') {
    nextState.latestSession = event.session
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

  if (event.type === 'turn_completed') {
    nextState.completedTurnIds.add(event.turnId)
    nextState.activeStreamingTurnId = null
    nextState.streamingAssistantText = ''
    nextState.latestSession = event.session
    nextState.lastFailedTurn = null
    return nextState
  }

  nextState.completedTurnIds.add(event.turnId)
  nextState.activeStreamingTurnId = null
  nextState.streamingAssistantText = ''
  nextState.latestSession = event.session
  nextState.lastFailedTurn = {
    turnId: event.turnId,
    message: event.message,
  }
  return nextState
}

export function applyAssistantSessionStreamStateEvent(
  state: AssistantSessionStreamState,
  event: AssistantSessionStreamEvent,
) {
  if (event.streamEventId && state.streamedEventIds.has(event.streamEventId)) {
    return {
      didApply: false,
      nextState: state,
      appliedState: null,
    }
  }

  const appliedState = applyAssistantSessionStreamEvent(
    {
      streamingAssistantText: state.streamingAssistantText,
      activeStreamingTurnId: state.activeStreamingTurnId,
      completedTurnIds: state.completedTurnIds,
      latestSession: state.latestSession,
      lastFailedTurn: state.lastFailedTurn,
    },
    event,
  )

  const nextState: AssistantSessionStreamState = {
    streamingAssistantText: appliedState.streamingAssistantText,
    activeStreamingTurnId: appliedState.activeStreamingTurnId,
    completedTurnIds: appliedState.completedTurnIds,
    latestSession: appliedState.latestSession,
    lastFailedTurn: appliedState.lastFailedTurn,
    lastStreamEventId: state.lastStreamEventId,
    streamedEventIds: new Set(state.streamedEventIds),
  }

  if (event.streamEventId) {
    nextState.streamedEventIds.add(event.streamEventId)
    nextState.lastStreamEventId = event.streamEventId
  }

  return {
    didApply: true,
    nextState,
    appliedState,
  }
}

export function parseAssistantSessionStreamFrames(buffer: string) {
  const normalizedBuffer = buffer.replace(/\r\n?/g, '\n')
  const frames = normalizedBuffer.split('\n\n')
  let remainder = frames.pop() ?? ''
  const events: AssistantSessionStreamEvent[] = []

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
    let event: AssistantSessionStreamEvent

    try {
      event = JSON.parse(payload) as AssistantSessionStreamEvent
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
