import { createContext, useContext } from 'react'

/**
 * Minimal task summary shape used by voice resolution.
 * Matches the server-side ResolvedVoiceTaskTarget fields needed for task actions.
 */
export type VisibleTaskSummaryItem = {
  id: string
  title: string
  status: 'active' | 'completed' | 'archived'
  dueDate: string | null
  dueTime: string | null
  priority: 'low' | 'medium' | 'high'
  completedAt: string | null
}

export type CaptureOpenOptions = {
  contextTaskId?: string | null
  bypassThreadReply?: boolean
  /**
   * Structured window of currently rendered/visible tasks.
   * Passed as fallback context for voice resolution when no specific
   * contextTaskId is provided. Individual task row/card voice actions
   * should still prefer contextTaskId — this is surface-level context only.
   */
  visibleTaskWindow?: VisibleTaskSummaryItem[] | null
}

export function resolveCaptureOpenTargets(currentIdeaThreadTarget: string | null, options?: CaptureOpenOptions) {
  const shouldBypassThreadReply = !!options?.bypassThreadReply && !!currentIdeaThreadTarget

  return {
    captureThreadIdeaId: shouldBypassThreadReply ? null : currentIdeaThreadTarget,
    captureContextIdeaId: shouldBypassThreadReply ? currentIdeaThreadTarget : null,
  }
}

interface CaptureContextValue {
  openCapture: (options?: CaptureOpenOptions) => void
  openCaptureWithText: (text: string, options?: CaptureOpenOptions) => void
  registerVisibleTaskWindow: (visibleTaskWindow: VisibleTaskSummaryItem[] | null) => void
  clearVisibleTaskWindow: () => void
}

export const CaptureContext = createContext<CaptureContextValue>({
  openCapture: () => {},
  openCaptureWithText: () => {},
  registerVisibleTaskWindow: () => {},
  clearVisibleTaskWindow: () => {},
})

export function useCaptureContext() {
  return useContext(CaptureContext)
}
