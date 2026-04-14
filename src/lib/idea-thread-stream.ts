export type IdeaThreadStreamEvent =
  | { type: 'turn_started'; turnId: string }
  | { type: 'assistant_chunk'; turnId: string; textDelta: string }
  | { type: 'working_idea_updated'; thread: unknown }
  | { type: 'turn_completed'; turnId: string; thread: unknown }
  | { type: 'turn_failed'; turnId: string; message: string; thread: unknown }

export function parseIdeaThreadStreamFrames(buffer: string) {
  const frames = buffer.split('\n\n')
  const remainder = frames.pop() ?? ''
  const events: IdeaThreadStreamEvent[] = []

  for (const frame of frames) {
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data: '))

    if (dataLines.length === 0) {
      continue
    }

    const payload = dataLines.map((line) => line.slice(6)).join('\n')
    events.push(JSON.parse(payload) as IdeaThreadStreamEvent)
  }

  return {
    events,
    remainder,
  }
}
