import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createDashboardService } from './dashboard-service'

const dashboardService = createDashboardService(db)

export const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return dashboardService.getDashboardData(user.id)
})
