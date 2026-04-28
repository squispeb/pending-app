import { createFileRoute } from '@tanstack/react-router'
import { createError } from 'evlog'
import { useRequest } from 'nitro/context'
import { proxyAssistantAuthRequest } from '../../../server/auth-proxy'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { context } = useRequest()
        context.log.set({ route: '/api/auth/$', method: 'GET', authPath: params._splat ?? '' })

        try {
          return await proxyAssistantAuthRequest(request, params._splat ?? '')
        } catch (error) {
          context.log.set({ error: error instanceof Error ? error.message : 'Proxy auth request failed' })
          throw createError({
            message: 'Auth proxy request failed',
            status: 502,
            why: 'The assistant auth service could not be reached or returned an invalid response.',
            fix: 'Check ASSISTANT_SERVICE_URL and the assistant service health.',
            link: 'https://www.evlog.dev/frameworks/tanstack-start',
          })
        }
      },
      POST: async ({ request, params }) => {
        const { context } = useRequest()
        context.log.set({ route: '/api/auth/$', method: 'POST', authPath: params._splat ?? '' })

        try {
          return await proxyAssistantAuthRequest(request, params._splat ?? '')
        } catch (error) {
          context.log.set({ error: error instanceof Error ? error.message : 'Proxy auth request failed' })
          throw createError({
            message: 'Auth proxy request failed',
            status: 502,
            why: 'The assistant auth service could not be reached or returned an invalid response.',
            fix: 'Check ASSISTANT_SERVICE_URL and the assistant service health.',
            link: 'https://www.evlog.dev/frameworks/tanstack-start',
          })
        }
      },
    },
  },
})
