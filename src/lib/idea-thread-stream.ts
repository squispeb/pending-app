export type IdeaThreadStreamEvent =
  | { streamEventId?: string; type: 'turn_started'; turnId: string }
  | { streamEventId?: string; type: 'assistant_chunk'; turnId: string; textDelta: string }
  | { streamEventId?: string; type: 'working_idea_updated'; thread: unknown }
  | { streamEventId?: string; type: 'turn_completed'; turnId: string; thread: unknown }
  | { streamEventId?: string; type: 'turn_failed'; turnId: string; message: string; thread: unknown }

export function parseIdeaThreadStreamFrames(buffer: string) {
  const frames = buffer.split('\n\n')
  const remainder = frames.pop() ?? ''
  const events: IdeaThreadStreamEvent[] = []

  for (const frame of frames) {
    const idLine = frame
      .split('\n')
      .find((line) => line.startsWith('id: '))
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data: '))

    if (dataLines.length === 0) {
      continue
    }

    const payload = dataLines.map((line) => line.slice(6)).join('\n')
    const event = JSON.parse(payload) as IdeaThreadStreamEvent

    if (idLine && !('streamEventId' in event)) {
      ;(event as { streamEventId?: string }).streamEventId = idLine.slice(4)
    }

    events.push(event)
  }

  return {
    events,
    remainder,
  }
}
