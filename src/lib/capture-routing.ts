import type { CandidateType } from './capture'

export type RouteContext = {
  defaultType: CandidateType | 'auto'
  allowed: Array<CandidateType>
}

export function routeContext(pathname: string): RouteContext {
  if (pathname === '/tasks') return { defaultType: 'task', allowed: ['task'] }
  if (pathname === '/habits') return { defaultType: 'habit', allowed: ['habit'] }
  if (pathname === '/ideas' || /^\/ideas\/[^/]+$/.test(pathname)) return { defaultType: 'idea', allowed: ['idea'] }
  if (pathname === '/') return { defaultType: 'auto', allowed: ['task', 'habit', 'idea'] }
  return { defaultType: 'task', allowed: ['task'] }
}

export function getRouteIntent(pathname: string): 'tasks' | 'habits' | 'ideas' | 'auto' {
  if (pathname === '/tasks') return 'tasks'
  if (pathname === '/habits') return 'habits'
  if (pathname === '/ideas' || /^\/ideas\/[^/]+$/.test(pathname)) return 'ideas'
  return 'auto'
}

export function getIdeaThreadTarget(pathname: string) {
  const match = pathname.match(/^\/ideas\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
