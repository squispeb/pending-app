import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PwaLifecycle() {
  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW()

  useEffect(() => {
    if (offlineReady[0]) {
      console.info('Pending App is ready for offline use.')
    }
  }, [offlineReady])

  if (!needRefresh[0]) {
    return null
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl">
      <p className="m-0 text-sm font-semibold text-[var(--ink-strong)]">
        A new version of Pending App is available.
      </p>
      <div className="mt-3 flex gap-2 text-sm font-semibold">
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="primary-pill cursor-pointer border-0"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
