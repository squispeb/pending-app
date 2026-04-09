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
      calendarContext: [],
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
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
    })
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: CAPTURE_INTERPRETATION_SYSTEM_PROMPT,
    })
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toContain('typed-task-capture')
    expect(body.messages[1].content).toContain('Need to deal with taxes tomorrow')
    expect(body.messages[1].content).toContain('"calendarContext": []')
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
      calendarContext: [],
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
      calendarContext: [],
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
        calendarContext: [],
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
        calendarContext: [],
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
        calendarContext: [],
      }),
    ).rejects.toMatchObject({
      name: 'CaptureInterpreterError',
      code: 'CONFIG',
      message: 'Capture interpretation model is missing.',
    } satisfies Partial<CaptureInterpreterError>)
  })

  it('passes ranked calendar context and parses matchedCalendarContext from the model output', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidateType: 'task',
                  title: 'Entregar primera tarea de Cloud Computing',
                  matchedCalendarContext: {
                    calendarEventId: 'evt-cloud-1',
                    summary: 'Cloud Computing',
                    reason: 'Matched recurring event: Cloud Computing',
                  },
                  interpretationNotes: ['Matched recurring event: Cloud Computing'],
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
      normalizedInput: 'Tengo que entregar la primera tarea de Cloud Computing',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
      calendarContext: [
        {
          calendarEventId: 'evt-cloud-1',
          summary: 'Cloud Computing',
          calendarName: 'Primary',
          startsAt: '2026-04-09T15:00:00.000Z',
          recurring: true,
          reason: 'Matched recurring event: Cloud Computing',
        },
      ],
    })

    expect(result?.matchedCalendarContext).toEqual({
      calendarEventId: 'evt-cloud-1',
      summary: 'Cloud Computing',
      reason: 'Matched recurring event: Cloud Computing',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body.messages[1].content).toContain('evt-cloud-1')
    expect(body.messages[1].content).toContain('Cloud Computing')
  })

  it('coerces string interpretation notes and string matchedCalendarContext ids', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidateType: 'task',
                  title: 'Entregar primera tarea del curso Cloud Computing',
                  notes: 'Resolver lo antes posible.',
                  dueDate: '2026-04-12',
                  priority: 'high',
                  matchedCalendarContext: 'evt-cloud-1',
                  interpretationNotes:
                    'El domingo que viene respecto al 2026-04-08 se interpreta como 2026-04-12.',
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
        model: 'x-ai/grok-4.1-fast',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const result = await interpreter?.interpretTypedTask({
      normalizedInput:
        'Tengo que entregar para el domingo que viene la primera tarea del curso Cloud Computing, en este tengo que resolverlo lo antes posible.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
      calendarContext: [
        {
          calendarEventId: 'evt-cloud-1',
          summary: 'Cloud Computing',
          calendarName: 'Primary',
          startsAt: '2026-04-10T15:00:00.000Z',
          recurring: true,
          reason: 'Matched recurring event: Cloud Computing',
        },
      ],
    })

    expect(result).toEqual({
      candidateType: 'task',
      title: 'Entregar primera tarea del curso Cloud Computing',
      notes: 'Resolver lo antes posible.',
      dueDate: '2026-04-12',
      priority: 'high',
      matchedCalendarContext: {
        calendarEventId: 'evt-cloud-1',
        summary: 'Cloud Computing',
        reason: 'Matched recurring event: Cloud Computing',
      },
      interpretationNotes: [
        'El domingo que viene respecto al 2026-04-08 se interpreta como 2026-04-12.',
      ],
    })
  })

  it('coerces provider priority urgent to high', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidateType: 'task',
                  title: 'Tarea Cloud Computing',
                  notes: 'Tarea para el curso Cloud Computing.',
                  dueDate: '2026-04-12',
                  dueTime: null,
                  priority: 'urgent',
                  estimatedMinutes: null,
                  cadenceType: null,
                  cadenceDays: [],
                  targetCount: null,
                  matchedCalendarContext: null,
                  preferredStartTime: null,
                  preferredEndTime: null,
                  interpretationNotes: [],
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
        model: 'openai/gpt-5-mini',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const result = await interpreter?.interpretTypedTask({
      normalizedInput: 'Tarea para el curso de Cloud Computing con fecha del día domingo Prioridad Urente.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
      languageHint: 'es',
      calendarContext: [],
    })

    expect(result?.priority).toBe('high')
  })
})
