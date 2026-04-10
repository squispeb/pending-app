import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { habitCreateSchema, habitUpdateSchema } from '../lib/habits'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createHabitsService } from './habits-service'

const habitsService = createHabitsService(db)

export const listHabits = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return habitsService.listHabitsWithCalendarLinks(user.id)
})

export const listHabitCompletions = createServerFn({ method: 'GET' })
  .inputValidator((input: { startDate?: string; endDate?: string } | undefined) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.listHabitCompletions(user.id, data?.startDate, data?.endDate)
  })

export const createHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => habitCreateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.createHabit(user.id, data)
  })

export const updateHabit = createServerFn({ method: 'POST' })
  .inputValidator((input) => habitUpdateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.updateHabit(user.id, data)
  })

export const archiveHabit = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.archiveHabit(data.id, user.id)
  })

export const completeHabitForDate = createServerFn({ method: 'POST' })
  .inputValidator((input: { habitId: string; date?: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.completeHabitForDate(user.id, data)
  })

export const uncompleteHabitForDate = createServerFn({ method: 'POST' })
  .inputValidator((input: { habitId: string; date?: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return habitsService.uncompleteHabitForDate(user.id, data)
  })
