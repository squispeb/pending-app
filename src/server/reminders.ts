import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { createRemindersService } from './reminders-service'

const remindersService = createRemindersService(db)

export const syncReminderEvents = createServerFn({ method: 'GET' }).handler(async () => {
  return remindersService.syncReminderEvents()
})

export const listDueReminders = createServerFn({ method: 'GET' }).handler(async () => {
  return remindersService.listDueReminders()
})

export const snoozeReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; minutes?: number }) => input)
  .handler(async ({ data }) => {
    return remindersService.snoozeReminder(data.id, data.minutes)
  })

export const dismissReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return remindersService.dismissReminder(data.id)
  })

export const markReminderDelivered = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; channel: 'in-app' | 'browser' }) => input)
  .handler(async ({ data }) => {
    return remindersService.markReminderDelivered(data.id, data.channel)
  })

export const completeReminder = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return remindersService.completeReminder(data.id)
  })
