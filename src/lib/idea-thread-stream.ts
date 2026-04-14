export type IdeaThreadStreamEvent =
  | { streamEventId?: string; type: 'turn_started'; turnId: string }
  | { streamEventId?: string; type: 'assistant_chunk'; turnId: string; textDelta: string }
  | { streamEventId?: string; type: 'working_idea_updated'; thread: unknown }
  | { streamEventId?: string; type: 'turn_completed'; turnId: string; thread: unknown }
  | { streamEventId?: string; type: 'turn_failed'; turnId: string; message: string; thread: unknown }

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
