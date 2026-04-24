import { createContext, useContext } from 'react'

export type CaptureOpenOptions = {
  contextTaskId?: string | null
  bypassThreadReply?: boolean
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
}

export const CaptureContext = createContext<CaptureContextValue>({
  openCapture: () => {},
  openCaptureWithText: () => {},
})

export function useCaptureContext() {
  return useContext(CaptureContext)
}
