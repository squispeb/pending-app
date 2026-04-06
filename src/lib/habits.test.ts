import { describe, expect, it } from 'vitest'
import {
  habitFormSchema,
  isHabitCompletedOnDate,
  isHabitDueOnDate,
  parseCadenceDays,
  serializeCadenceDays,
} from './habits'
import type { Habit, HabitCompletion } from '../db/schema'

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
    reminderAt: null,
    archivedAt: null,
    createdAt: new Date('2026-04-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T09:00:00Z'),
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-1',
    habitId: 'habit-1',
    userId: 'local-user',
    completionDate: '2026-04-01',
    completedAt: new Date('2026-04-01T10:00:00Z'),
    createdAt: new Date('2026-04-01T10:00:00Z'),
    ...overrides,
  }
}

describe('habit recurrence helpers', () => {
  it('serializes and parses selected days', () => {
    const serialized = serializeCadenceDays(['mon', 'wed', 'fri'])

    expect(parseCadenceDays(serialized)).toEqual(['mon', 'wed', 'fri'])
  })

  it('marks daily habits due every day', () => {
    expect(isHabitDueOnDate(makeHabit(), new Date('2026-04-01'))).toBe(true)
  })

  it('marks selected-day habits due only on matching weekdays', () => {
    const habit = makeHabit({
      cadenceType: 'selected_days',
      cadenceDays: JSON.stringify(['tue', 'thu']),
    })

    expect(isHabitDueOnDate(habit, new Date('2026-04-01'))).toBe(true)
    expect(isHabitDueOnDate(habit, new Date('2026-04-02'))).toBe(false)
  })

  it('detects completion for a specific date', () => {
    expect(isHabitCompletedOnDate(makeHabit(), [makeCompletion()], '2026-04-01')).toBe(true)
    expect(isHabitCompletedOnDate(makeHabit(), [makeCompletion()], '2026-04-02')).toBe(false)
  })
})

describe('habit form schema', () => {
  it('requires selected days when cadence type is selected_days', () => {
    const result = habitFormSchema.safeParse({
      title: 'Workout',
      cadenceType: 'selected_days',
      cadenceDays: [],
      targetCount: 1,
      preferredStartTime: '',
      preferredEndTime: '',
      reminderAt: '',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a valid selected-day habit', () => {
    const result = habitFormSchema.safeParse({
      title: 'Workout',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'wed'],
      targetCount: 1,
      preferredStartTime: '07:00',
      preferredEndTime: '08:00',
      reminderAt: '2026-04-01T06:30',
    })

    expect(result.success).toBe(true)
  })
})
