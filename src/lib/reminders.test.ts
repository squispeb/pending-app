import { describe, expect, it } from 'vitest'
import {
  getHabitReminderEventPayload,
  getReminderEventId,
  getTaskReminderEventPayload,
  isReminderVisible,
} from './reminders'
import type { Habit, HabitCompletion, Task } from '../db/schema'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'local-user',
    title: 'Review roadmap',
    notes: null,
    status: 'active',
    priority: 'medium',
    dueDate: '2026-04-01',
    dueTime: '10:00',
    reminderAt: new Date('2026-04-01T09:30:00'),
    estimatedMinutes: null,
    preferredStartTime: null,
    preferredEndTime: null,
    completedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-04-01T08:00:00'),
    updatedAt: new Date('2026-04-01T08:00:00'),
    ...overrides,
  }
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    userId: 'local-user',
    title: 'Read',
    cadenceType: 'daily',
    cadenceDays: null,
    targetCount: 1,
    preferredStartTime: null,
    preferredEndTime: null,
    reminderAt: new Date('2026-04-01T07:30:00'),
    archivedAt: null,
    createdAt: new Date('2026-04-01T07:00:00'),
    updatedAt: new Date('2026-04-01T07:00:00'),
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-1',
    habitId: 'habit-1',
    userId: 'local-user',
    completionDate: '2026-04-01',
    completedAt: new Date('2026-04-01T08:00:00'),
    createdAt: new Date('2026-04-01T08:00:00'),
    ...overrides,
  }
}

describe('reminder helpers', () => {
  it('creates a stable reminder event id', () => {
    expect(
      getReminderEventId('task', 'task-1', new Date('2026-04-01T09:30:00Z')),
    ).toContain('task:task-1:')
  })

  it('builds a task reminder payload when a task has reminderAt', () => {
    const payload = getTaskReminderEventPayload(makeTask())

    expect(payload?.sourceType).toBe('task')
    expect(payload?.title).toBe('Review roadmap')
  })

  it('builds a habit reminder payload for due-today uncompleted habits', () => {
    const payload = getHabitReminderEventPayload(makeHabit(), [], new Date('2026-04-01T08:00:00'))

    expect(payload?.sourceType).toBe('habit')
    expect(payload?.scheduledFor).toBeInstanceOf(Date)
  })

  it('does not build a habit reminder payload when habit is already completed today', () => {
    const payload = getHabitReminderEventPayload(
      makeHabit(),
      [makeCompletion()],
      new Date('2026-04-01T08:00:00'),
    )

    expect(payload).toBeNull()
  })

  it('hides dismissed reminders', () => {
    expect(
      isReminderVisible(
        {
          id: 'r1',
          sourceType: 'task',
          sourceId: 'task-1',
          title: 'Review roadmap',
          scheduledFor: new Date('2026-04-01T09:30:00'),
          dueNow: true,
          deliveredInAppAt: null,
          deliveredBrowserAt: null,
          snoozedUntil: null,
          dismissedAt: new Date('2026-04-01T09:35:00'),
          completedViaReminderAt: null,
          timingLabel: 'Task reminder',
        },
        new Date('2026-04-01T09:40:00'),
      ),
    ).toBe(false)
  })
})
