import { createContext, useContext } from 'react'

interface CaptureContextValue {
  openCapture: () => void
  openCaptureWithText: (text: string) => void
}

export const CaptureContext = createContext<CaptureContextValue>({
  openCapture: () => {},
  openCaptureWithText: () => {},
})

export function useCaptureContext() {
  return useContext(CaptureContext)
}
