import { createFileRoute } from '@tanstack/react-router'
import { proxyAssistantAuthRequest } from '../../../server/auth-proxy'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxyAssistantAuthRequest(request, params._splat ?? ''),
      POST: async ({ request, params }) => proxyAssistantAuthRequest(request, params._splat ?? ''),
    },
  },
})
