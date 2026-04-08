import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { habitCreateSchema, habitUpdateSchema } from '../lib/habits'
import { createHabitsService } from './habits-service'

const habitsService = createHabitsService(db)

export const listHabits = createServerFn({ method: 'GET' }).handler(async () => {
  return habitsService.listHabitsWithCalendarLinks()
})

export const listHabitCompletions = createServerFn({ method: 'GET' })
  .inputValidator((input: { startDate?: string; endDate?: string } | undefined) => input)
  .handler(async ({ data }) => {
    return habitsService.listHabitCompletions(data?.startDate, data?.endDate)
  })

export const createHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => habitCreateSchema.parse(input))
  .handler(async ({ data }) => {
    return habitsService.createHabit(data)
  })

export const updateHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => habitUpdateSchema.parse(input))
  .handler(async ({ data }) => {
    return habitsService.updateHabit(data)
  })

export const archiveHabit = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return habitsService.archiveHabit(data.id)
  })

export const completeHabitForDate = createServerFn({ method: 'POST' })
  .inputValidator((input: { habitId: string; date?: string }) => input)
  .handler(async ({ data }) => {
    return habitsService.completeHabitForDate(data)
  })

export const uncompleteHabitForDate = createServerFn({ method: 'POST' })
  .inputValidator((input: { habitId: string; date?: string }) => input)
  .handler(async ({ data }) => {
    return habitsService.uncompleteHabitForDate(data)
  })
