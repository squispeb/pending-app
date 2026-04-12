import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createRemindersService } from './reminders-service'

const remindersService = createRemindersService(db)

export const syncReminderEvents = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return remindersService.syncReminderEvents(user.id)
})

export const listDueReminders = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return remindersService.listDueReminders(user.id)
})

export const snoozeReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return remindersService.snoozeReminder(data.id, user.id, data.minutes)
  })

export const dismissReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return remindersService.dismissReminder(data.id, user.id)
  })

export const deferReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return remindersService.deferReminder(data.id, user.id, data.minutes)
  })

export const markRemindersDelivered = createServerFn({ method: 'POST' })
  .inputValidator((input: { ids: Array<string>; channel: 'in-app' | 'browser' }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return remindersService.markRemindersDelivered(data.ids, user.id, data.channel)
  })

export const completeReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return remindersService.completeReminder(data.id, user.id)
  })
