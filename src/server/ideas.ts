import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { ideaCreateSchema, ideaToggleStarSchema } from '../lib/ideas'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'

const ideasService = createIdeasService(db)

export const listIdeas = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await resolveAuthenticatedPlannerUser(db)
  return ideasService.listIdeas(user.id)
})

export const getIdea = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.getIdea(data.id, user.id)
  })

export const createIdea = createServerFn({ method: 'POST' })
  .inputValidator((input) => ideaCreateSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.createIdea(user.id, data)
  })

export const toggleIdeaStar = createServerFn({ method: 'POST' })
  .inputValidator((input) => ideaToggleStarSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.toggleIdeaStar(data.id, user.id)
  })
