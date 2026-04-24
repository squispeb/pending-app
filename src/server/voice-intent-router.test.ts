import { describe, expect, it, vi } from 'vitest'
import {
  buildVoiceActionClarification,
  createRemoteVoiceIntentClassifier,
  createVoiceIntentRouter,
} from './voice-intent-router'

describe('voice intent router', () => {
  it('classifies task completion requests as task actions', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('Mark this task as done')).resolves.toEqual({
      family: 'task_action',
      kind: 'complete_task',
    })
  })

  it('classifies task status requests as task actions', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('What is the status of this task?')).resolves.toEqual({
      family: 'task_action',
      kind: 'task_status',
    })
  })

  it('classifies calendar creation requests as calendar actions', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('Schedule a meeting on my calendar for tomorrow')).resolves.toEqual({
      family: 'calendar_action',
      kind: 'create_calendar_event',
    })
  })

  it('falls back to creation for new task requests', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('Comprar focos para la sala mañana.')).resolves.toEqual({
      family: 'creation',
      kind: 'creation',
    })
  })

  it('builds task-action clarification copy', () => {
    expect(
      buildVoiceActionClarification({
        family: 'task_action',
        kind: 'edit_task',
      }),
    ).toEqual({
      message: 'I understood that as a task action, but voice task actions are not available yet.',
      questions: ['Do you want to create a new task instead?'],
    })
  })

  it('classifies unsupported task commands as task actions instead of creation', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('Archive this task')).resolves.toEqual({
      family: 'task_action',
      kind: 'unsupported_task_action',
    })
  })

  it('classifies unsupported planner commands as unsupported actions instead of creation', () => {
    const router = createVoiceIntentRouter({ classifier: null })

    return expect(router.classifyVoiceIntent('Edit this habit')).resolves.toEqual({
      family: 'unsupported_action',
      kind: 'unsupported_action',
    })
  })

  it('uses provider classification when the provider returns a valid intent', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  family: 'task_action',
                  kind: 'complete_task',
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

    const classifier = createRemoteVoiceIntentClassifier(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const router = createVoiceIntentRouter({ classifier })

    await expect(router.classifyVoiceIntent('Mark this task as done')).resolves.toEqual({
      family: 'task_action',
      kind: 'complete_task',
    })
  })

  it('falls back to regex when the provider fails', async () => {
    const classifier = {
      classify: vi.fn(async () => {
        throw new Error('provider failed')
      }),
    }

    const router = createVoiceIntentRouter({ classifier })

    await expect(router.classifyVoiceIntent('Archive this task')).resolves.toEqual({
      family: 'task_action',
      kind: 'unsupported_task_action',
    })
  })

  it('falls back to regex when provider output is invalid', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"family":"task_action","kind":"unknown"}',
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

    const classifier = createRemoteVoiceIntentClassifier(
      {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: 'secret-key',
        model: 'openrouter/lightweight-model',
        timeoutMs: 1000,
      },
      fetchMock,
    )

    const router = createVoiceIntentRouter({ classifier })

    await expect(router.classifyVoiceIntent('Edit this habit')).resolves.toEqual({
      family: 'unsupported_action',
      kind: 'unsupported_action',
    })
  })
})
