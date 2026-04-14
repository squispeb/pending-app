import { describe, expect, it } from 'vitest'
import { parseIdeaThreadStreamFrames } from './idea-thread-stream'

describe('idea thread stream parser', () => {
  it('parses assistant chunk and completion events from SSE frames', () => {
    const parsed = parseIdeaThreadStreamFrames([
      'id: event-1',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello "}',
      '',
      'id: event-2',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"world"}',
      '',
      'id: event-3',
      'data: {"type":"turn_completed","turnId":"turn-1","thread":{"status":"idle"}}',
      '',
    ].join('\n'))

    expect(parsed.remainder).toBe('id: event-3\ndata: {"type":"turn_completed","turnId":"turn-1","thread":{"status":"idle"}}\n')
    expect(parsed.events).toEqual([
      { streamEventId: 'event-1', type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'Hello ' },
      { streamEventId: 'event-2', type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'world' },
    ])

    const completed = parseIdeaThreadStreamFrames(`${parsed.remainder}\n`)
    expect(completed.remainder).toBe('')
    expect(completed.events).toEqual([
      { streamEventId: 'event-3', type: 'turn_completed', turnId: 'turn-1', thread: { status: 'idle' } },
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

  it('ignores keepalive lines and preserves invalid trailing json for retry', () => {
    const parsed = parseIdeaThreadStreamFrames([
      ': keepalive',
      'id: event-1',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}',
      '',
      'id: event-2',
      'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"partial"',
      '',
    ].join('\n'))

    expect(parsed.events).toEqual([
      { streamEventId: 'event-1', type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'Hello' },
    ])
    expect(parsed.remainder).toBe('id: event-2\ndata: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"partial"\n')
  })

  it('parses carriage-return separated SSE frames', () => {
    const parsed = parseIdeaThreadStreamFrames('id: event-1\r\ndata: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\r\n\r\n')

    expect(parsed.remainder).toBe('')
    expect(parsed.events).toEqual([
      { streamEventId: 'event-1', type: 'assistant_chunk', turnId: 'turn-1', textDelta: 'Hello' },
    ])
  })
})
