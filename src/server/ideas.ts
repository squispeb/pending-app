import { createServerFn } from '@tanstack/react-start'
import { db } from '../db/client'
import { ideaCreateSchema, ideaToggleStarSchema } from '../lib/ideas'
import { createAssistantThreadService } from './assistant-thread-service'
import { resolveAuthenticatedPlannerUser } from './authenticated-user'
import { createIdeasService } from './ideas-service'

const ideasService = createIdeasService(db)
const assistantThreadService = createAssistantThreadService(db)

type CreateIdeaAndThreadDependencies = {
  resolveUser: () => Promise<{
    user: { id: string }
    authHeaders: HeadersInit
  }>
  createIdea: (userId: string, data: Parameters<typeof ideaCreateSchema.parse>[0]) => Promise<{
    ok: true
    id: string
  }>
  bootstrapIdeaThread: (
    ideaId: string,
    options: {
      requestHeaders: HeadersInit
    },
  ) => Promise<{
    threadId: string
    initialSnapshotId: string
  }>
}

export async function createIdeaAndBootstrapThread(
  data: Parameters<typeof ideaCreateSchema.parse>[0],
  dependencies: CreateIdeaAndThreadDependencies,
) {
  const { user, authHeaders } = await dependencies.resolveUser()
  const createdIdea = await dependencies.createIdea(user.id, data)
  const thread = await dependencies.bootstrapIdeaThread(createdIdea.id, {
    requestHeaders: authHeaders,
  })

  return {
    ...createdIdea,
    threadId: thread.threadId,
    initialSnapshotId: thread.initialSnapshotId,
  }
}

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
    return createIdeaAndBootstrapThread(data, {
      resolveUser: () => resolveAuthenticatedPlannerUser(db),
      createIdea: (userId, input) => ideasService.createIdea(userId, input),
      bootstrapIdeaThread: (ideaId, options) => assistantThreadService.bootstrapIdeaThread(ideaId, {
        requestHeaders: options.requestHeaders,
      }),
    })
  })

export const toggleIdeaStar = createServerFn({ method: 'POST' })
  .inputValidator((input) => ideaToggleStarSchema.parse(input))
  .handler(async ({ data }) => {
    const { user } = await resolveAuthenticatedPlannerUser(db)
    return ideasService.toggleIdeaStar(data.id, user.id)
  })

export const resolveIdeaThread = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return assistantThreadService.resolveIdeaThread(data.id)
  })
