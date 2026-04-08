import { createContext, useContext } from 'react'

interface CaptureContextValue {
  openCapture: () => void
}

export const CaptureContext = createContext<CaptureContextValue>({
  openCapture: () => {},
})

export function useCaptureContext() {
  return useContext(CaptureContext)
}
