import { describe, expect, it } from 'vitest'
import { getIdeaThreadTarget, getRouteIntent, routeContext } from './capture-routing'

describe('capture routing', () => {
  it('treats idea detail routes as idea capture context', () => {
    expect(routeContext('/ideas/idea-123')).toEqual({
      defaultType: 'idea',
      allowed: ['idea'],
    })
    expect(getRouteIntent('/ideas/idea-123')).toBe('ideas')
  })

  it('extracts the active idea thread target from the route', () => {
    expect(getIdeaThreadTarget('/ideas/idea-123')).toBe('idea-123')
    expect(getIdeaThreadTarget('/ideas/idea%20123')).toBe('idea 123')
  })

  it('does not treat the ideas index as a thread target', () => {
    expect(getIdeaThreadTarget('/ideas')).toBeNull()
    expect(getIdeaThreadTarget('/tasks/task-123')).toBeNull()
  })
})
