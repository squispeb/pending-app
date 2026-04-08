import { describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_INTERPRETATION_SYSTEM_PROMPT,
  CaptureInterpreterError,
  createRemoteCaptureInterpreter,
} from './capture-interpreter'

describe('capture interpreter', () => {
  it('sends an OpenRouter-style chat completion request and parses the draft from assistant content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidateType: 'task',
                  title: 'Deal with taxes',
                  dueDate: '2026-04-09',
                  interpretationNotes: ['Provider inferred a cleaner title.'],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const result = await interpreter?.interpretTypedTask({
      normalizedInput: 'Need to deal with taxes tomorrow',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'en',
    })

    expect(result).toEqual({
      candidateType: 'task',
      title: 'Deal with taxes',
      dueDate: '2026-04-09',
      interpretationNotes: ['Provider inferred a cleaner title.'],
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-key',
      'X-Title': 'Pending App',
    })

    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('openrouter/lightweight-model')
    expect(body.temperature).toBe(0)
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: CAPTURE_INTERPRETATION_SYSTEM_PROMPT,
    })
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toContain('typed-task-capture')
    expect(body.messages[1].content).toContain('Need to deal with taxes tomorrow')
  })

  it('parses habit candidate output with cadence fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidateType: 'habit',
                  title: 'Meditar',
                  cadenceType: 'selected_days',
                  cadenceDays: ['mon', 'thu'],
                  targetCount: 1,
                  interpretationNotes: ['Detected recurring cadence from weekdays.'],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const result = await interpreter?.interpretTypedTask({
      normalizedInput: 'Meditar cada lunes y jueves',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result).toEqual({
      candidateType: 'habit',
      title: 'Meditar',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'thu'],
      targetCount: 1,
      interpretationNotes: ['Detected recurring cadence from weekdays.'],
    })
  })

  it('accepts assistant content wrapped in json code fences', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n{"title":"Comprar focos","priority":"medium"}\n```',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const result = await interpreter?.interpretTypedTask({
      normalizedInput: 'Comprar focos mañana',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
    })

    expect(result).toEqual({
      title: 'Comprar focos',
      priority: 'medium',
    })
  })

  it('throws a request error when the provider times out', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })

    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 10,
      },
      fetchMock,
    )

    await expect(
      interpreter?.interpretTypedTask({
        normalizedInput: 'Need to deal with taxes tomorrow',
        currentDate: '2026-04-08',
        timezone: 'America/Lima',
        languageHint: 'en',
      }),
    ).rejects.toMatchObject({
      name: 'CaptureInterpreterError',
      code: 'REQUEST',
      message: 'Capture interpretation timed out after 10ms.',
    } satisfies Partial<CaptureInterpreterError>)
  })

  it('throws an invalid response error for malformed model output', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{not-valid-json}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    await expect(
      interpreter?.interpretTypedTask({
        normalizedInput: 'Need to deal with taxes tomorrow',
        currentDate: '2026-04-08',
        timezone: 'America/Lima',
        languageHint: 'en',
      }),
    ).rejects.toMatchObject({
      name: 'CaptureInterpreterError',
      code: 'INVALID_RESPONSE',
      message: 'Capture interpretation returned invalid JSON.',
    } satisfies Partial<CaptureInterpreterError>)
  })

  it('throws a config error when the model is missing', async () => {
    const interpreter = createRemoteCaptureInterpreter(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        timeoutMs: 1000,
      },
      vi.fn<typeof fetch>(),
    )

    await expect(
      interpreter?.interpretTypedTask({
        normalizedInput: 'Need to deal with taxes tomorrow',
        currentDate: '2026-04-08',
        timezone: 'America/Lima',
        languageHint: 'en',
      }),
    ).rejects.toMatchObject({
      name: 'CaptureInterpreterError',
      code: 'CONFIG',
      message: 'Capture interpretation model is missing.',
    } satisfies Partial<CaptureInterpreterError>)
  })
})
