import { describe, expect, it } from 'vitest'
import { getTaskSummary, isStepLinkedTask, isTaskDueToday, isTaskOverdue, taskFormSchema } from './tasks'
import type { Task } from '../db/schema'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'local-user',
    title: 'Test task',
    notes: null,
    status: 'active',
    priority: 'medium',
    dueDate: null,
    dueTime: null,
    reminderAt: null,
    estimatedMinutes: null,
    preferredStartTime: null,
    preferredEndTime: null,
    completedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-04-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T09:00:00Z'),
    ...overrides,
  }
}

describe('task date helpers', () => {
  const now = new Date('2026-04-01T12:30:00')

  it('marks a task due today when the date matches and it is still active', () => {
    expect(isTaskDueToday(makeTask({ dueDate: '2026-04-01' }), now)).toBe(true)
  })

  it('marks a timed task overdue when the due time has passed', () => {
    expect(
      isTaskOverdue(makeTask({ dueDate: '2026-04-01', dueTime: '09:30' }), now),
    ).toBe(true)
  })

  it('does not mark an untimed task overdue until the next day', () => {
    expect(isTaskOverdue(makeTask({ dueDate: '2026-04-01' }), now)).toBe(false)
  })

  it('summarizes active, due-today, overdue, and completed counts', () => {
    const summary = getTaskSummary(
      [
        makeTask({ id: '1', dueDate: '2026-04-01' }),
        makeTask({ id: '2', dueDate: '2026-03-31' }),
        makeTask({ id: '3', status: 'completed', completedAt: now }),
      ],
      now,
    )

    expect(summary).toEqual({
      active: 2,
      dueToday: 1,
      overdue: 1,
      completed: 1,
    })
  })
})

describe('task form schema', () => {
  it('requires both preferred window values together', () => {
    const result = taskFormSchema.safeParse({
      title: 'Write spec',
      priority: 'medium',
      preferredStartTime: '09:00',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a valid task payload', () => {
    const result = taskFormSchema.safeParse({
      title: 'Write spec',
      notes: '',
      priority: 'high',
      dueDate: '2026-04-02',
      dueTime: '11:30',
      estimatedMinutes: 45,
      preferredStartTime: '10:00',
      preferredEndTime: '12:00',
    })

    expect(result.success).toBe(true)
  })
})

describe('step-linked task detection', () => {
  it('detects accepted breakdown step markers from task notes', () => {
    expect(isStepLinkedTask(makeTask({ notes: 'Accepted breakdown step #2 from idea.' }))).toBe(true)
    expect(isStepLinkedTask(makeTask({ notes: 'Accepted task conversion from developed idea.' }))).toBe(false)
    expect(isStepLinkedTask(makeTask({ notes: null }))).toBe(false)
  })
})
