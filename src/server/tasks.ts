import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { taskCreateSchema, taskUpdateSchema } from '../lib/tasks'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createTasksService } from './tasks-service'

const tasksService = createTasksService(db)

export const listTasks = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return tasksService.listTasksWithCalendarLinks(user.id)
})

export const createTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskCreateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.createTask(user.id, data)
  })

export const updateTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskUpdateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.updateTask(user.id, data)
  })

export const completeTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.completeTask(data.id, user.id)
  })

export const reopenTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.reopenTask(data.id, user.id)
  })

export const archiveTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.archiveTask(data.id, user.id)
  })

export const deferTaskReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return tasksService.deferTaskReminder(data.id, user.id, data.minutes)
  })
