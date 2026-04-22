import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createIdeaThreadStreamSessionState } from './idea-thread-stream'
import { applyIdeaThreadStreamResponse, shouldEnableIdeaThreadFallbackPolling } from './idea-thread-streaming'

describe('idea thread fallback polling', () => {
  it('stays disabled while the stream is healthy', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: true,
      streamFallbackPollEnabled: false,
    })).toBe(false)
  })

  it('enables polling only when the thread is busy and the stream fallback is active', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: true,
      streamFallbackPollEnabled: true,
    })).toBe(true)
  })

  it('stays disabled when the thread is idle even if fallback was enabled', () => {
    expect(shouldEnableIdeaThreadFallbackPolling({
      isThreadBusy: false,
      streamFallbackPollEnabled: true,
    })).toBe(false)
  })
})

function createIdeaThreadStreamResponse(frames: string[]) {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  }), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('idea thread stream response application', () => {
  it('patches thread snapshots and clears streaming text on terminal events', async () => {
    const queryClient = new QueryClient()
    const threadKey = ['idea-thread', 'idea-1']
    queryClient.setQueryData(threadKey, {
      status: 'processing',
      workingIdea: { provisionalTitle: null, currentSummary: null },
      lastTurn: null,
    })

    let sessionState = createIdeaThreadStreamSessionState()
    const setStreamingAssistantText = vi.fn()
    const setActiveStructuredAction = vi.fn()
    const setLastStructuredActionError = vi.fn()

    await applyIdeaThreadStreamResponse({
      response: createIdeaThreadStreamResponse([
        'id: event-1\n',
        'data: {"type":"working_idea_updated","thread":{"status":"streaming","workingIdea":{"provisionalTitle":"Live title","currentSummary":"Live summary"}}}\n\n',
        'id: event-2\n',
        'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\n\n',
        'id: event-3\n',
        'data: {"type":"turn_completed","turnId":"turn-1","thread":{"status":"idle","workingIdea":{"provisionalTitle":"Live title","currentSummary":"Final summary"},"lastTurn":{"state":"completed"}}}\n\n',
      ]),
      sessionState,
      onSessionState: (nextState) => {
        sessionState = nextState
      },
      onThreadSnapshot: (snapshot) => {
        queryClient.setQueryData(threadKey, snapshot)
      },
      onStreamingAssistantText: setStreamingAssistantText,
      onActiveStructuredAction: setActiveStructuredAction,
      onLastStructuredActionError: setLastStructuredActionError,
    })

    expect(queryClient.getQueryData(threadKey)).toEqual({
      status: 'idle',
      workingIdea: { provisionalTitle: 'Live title', currentSummary: 'Final summary' },
      lastTurn: { state: 'completed' },
    })
    expect(setStreamingAssistantText).toHaveBeenLastCalledWith('')
    expect(setActiveStructuredAction).toHaveBeenLastCalledWith(null)
    expect(setLastStructuredActionError).toHaveBeenLastCalledWith(null)
    expect(sessionState.lastStreamEventId).toBe('event-3')
  })

  it('deduplicates replayed events and resumes from the latest stream event id', async () => {
    let sessionState = createIdeaThreadStreamSessionState()
    const setStreamingAssistantText = vi.fn()

    await applyIdeaThreadStreamResponse({
      response: createIdeaThreadStreamResponse([
        'id: event-1\n',
        'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\n\n',
      ]),
      sessionState,
      onSessionState: (nextState) => {
        sessionState = nextState
      },
      onThreadSnapshot: () => {},
      onStreamingAssistantText: setStreamingAssistantText,
      onActiveStructuredAction: () => {},
      onLastStructuredActionError: () => {},
    })

    await applyIdeaThreadStreamResponse({
      response: createIdeaThreadStreamResponse([
        'id: event-1\n',
        'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":"Hello"}\n\n',
        'id: event-2\n',
        'data: {"type":"assistant_chunk","turnId":"turn-1","textDelta":" world"}\n\n',
      ]),
      sessionState,
      onSessionState: (nextState) => {
        sessionState = nextState
      },
      onThreadSnapshot: () => {},
      onStreamingAssistantText: setStreamingAssistantText,
      onActiveStructuredAction: () => {},
      onLastStructuredActionError: () => {},
    })

    expect(setStreamingAssistantText).toHaveBeenLastCalledWith('Hello world')
    expect(sessionState.lastStreamEventId).toBe('event-2')
    expect(sessionState.streamedEventIds.has('event-1')).toBe(true)
    expect(sessionState.streamedEventIds.has('event-2')).toBe(true)
  })
})
