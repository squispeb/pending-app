import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createDashboardService } from './dashboard-service'

const dashboardService = createDashboardService(db)

export const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  const now = new Date()
  const dashboard = await dashboardService.getDashboardData(user.id, now)

  return {
    ...dashboard,
    renderedAt: now.toISOString(),
    timezone: user.timezone,
  }
})
