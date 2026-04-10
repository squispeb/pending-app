import type { Database } from '../db/client'
import { createTasksService } from './tasks-service'
import { createHabitsService } from './habits-service'
import { createRemindersService } from './reminders-service'
import { applyTaskFilter, getTaskSummary, getTodayDateString, sortTasks } from '../lib/tasks'
import {
  applyHabitFilter,
  getHabitSummary,
  isHabitCompletedOnDate,
} from '../lib/habits'

export function createDashboardService(database: Database) {
  const tasksService = createTasksService(database)
  const habitsService = createHabitsService(database)
  const remindersService = createRemindersService(database)

  return {
    async getDashboardData(userId: string, now = new Date()) {
      const today = getTodayDateString(now)
      const completionStart = new Date(now)
      completionStart.setDate(completionStart.getDate() - 29)
      const completionStartDate = getTodayDateString(completionStart)

      const [tasks, habits, completions] = await Promise.all([
        tasksService.listTasksWithCalendarLinks(userId, now),
        habitsService.listHabitsWithCalendarLinks(userId, now),
        habitsService.listHabitCompletions(userId, completionStartDate, today),
      ])

      const overdueTasks = sortTasks(applyTaskFilter(tasks, 'overdue', now), 'due-asc')
      const dueTodayTasks = sortTasks(applyTaskFilter(tasks, 'today', now), 'due-asc')
      const todayHabits = applyHabitFilter(habits, completions, 'due-today', now).map((habit) => ({
        habit,
        completedToday: isHabitCompletedOnDate(habit, completions, today),
      }))

      const dueReminders = await remindersService.syncReminderEvents(userId, now)

      return {
        today,
        taskSummary: getTaskSummary(tasks, now),
        habitSummary: getHabitSummary(habits, completions, now),
        overdueTasks,
        dueTodayTasks,
        todayHabits,
        dueReminders,
      }
    },
  }
}
