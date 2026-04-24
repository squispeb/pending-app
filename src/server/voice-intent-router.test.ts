import { describe, expect, it } from 'vitest'
import { buildVoiceActionClarification, classifyVoiceIntent } from './voice-intent-router'

describe('voice intent router', () => {
  it('classifies task completion requests as task actions', () => {
    expect(classifyVoiceIntent('Mark this task as done')).toEqual({
      family: 'task_action',
      kind: 'complete_task',
    })
  })

  it('classifies task status requests as task actions', () => {
    expect(classifyVoiceIntent('What is the status of this task?')).toEqual({
      family: 'task_action',
      kind: 'task_status',
    })
  })

  it('classifies calendar creation requests as calendar actions', () => {
    expect(classifyVoiceIntent('Schedule a meeting on my calendar for tomorrow')).toEqual({
      family: 'calendar_action',
      kind: 'create_calendar_event',
    })
  })

  it('falls back to creation for new task requests', () => {
    expect(classifyVoiceIntent('Comprar focos para la sala mañana.')).toEqual({
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
    expect(classifyVoiceIntent('Archive this task')).toEqual({
      family: 'task_action',
      kind: 'unsupported_task_action',
    })
  })

  it('classifies unsupported planner commands as unsupported actions instead of creation', () => {
    expect(classifyVoiceIntent('Edit this habit')).toEqual({
      family: 'unsupported_action',
      kind: 'unsupported_action',
    })
  })
})
