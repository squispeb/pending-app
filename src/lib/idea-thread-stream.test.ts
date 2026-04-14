import { describe, expect, it } from 'vitest'
import { parseIdeaThreadStreamFrames } from './idea-thread-stream'

describe('idea thread stream parser', () => {
  it('parses assistant chunk and completion events from SSE frames', () => {
    const parsed = parseIdeaThreadStreamFrames([
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello "}',
      '',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"world"}',
      '',
      'data: {"type":"turn_completed","turnId":"turn-1","thread":{"status":"idle"}}',
      '',
    ].join('\n'))

    expect(parsed.remainder).toBe('data: {"type":"turn_completed","turnId":"turn-1","thread":{"status":"idle"}}\n')
    expect(parsed.events).toEqual([
      { type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'Hello ' },
      { type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'world' },
    ])

    const completed = parseIdeaThreadStreamFrames(`${parsed.remainder}\n`)
    expect(completed.remainder).toBe('')
    expect(completed.events).toEqual([
      { type: 'turn_completed', turnId: 'turn-1', thread: { status: 'idle' } },
    ])
  })

  it('keeps incomplete trailing frames as remainder', () => {
    const parsed = parseIdeaThreadStreamFrames([
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}',
      '',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"partial"}',
    ].join('\n'))

    expect(parsed.events).toEqual([
      { type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'Hello' },
    ])
    expect(parsed.remainder).toBe('data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"partial"}')
  })
})
