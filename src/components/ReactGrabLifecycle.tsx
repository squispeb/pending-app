import { useEffect } from 'react'

export default function ReactGrabLifecycle() {
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    void import('react-grab')
  }, [])

  return null
}
