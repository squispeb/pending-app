import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { taskCreateSchema, taskUpdateSchema } from '../lib/tasks'
import { createTasksService } from './tasks-service'

const tasksService = createTasksService(db)

export const listTasks = createServerFn({ method: 'GET' }).handler(async () => {
  return tasksService.listTasksWithCalendarLinks()
})

export const createTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskCreateSchema.parse(input))
  .handler(async ({ data }) => {
    return tasksService.createTask(data)
  })

export const updateTask = createServerFn({ method: 'POST' })
  .inputValidator((input) => taskUpdateSchema.parse(input))
  .handler(async ({ data }) => {
    return tasksService.updateTask(data)
  })

export const completeTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return tasksService.completeTask(data.id)
  })

export const reopenTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return tasksService.reopenTask(data.id)
  })

export const archiveTask = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return tasksService.archiveTask(data.id)
  })

export const deferTaskReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    return tasksService.deferTaskReminder(data.id, data.minutes)
  })
