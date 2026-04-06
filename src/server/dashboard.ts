import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { createDashboardService } from './dashboard-service'

const dashboardService = createDashboardService(db)

export const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  return dashboardService.getDashboardData()
})
