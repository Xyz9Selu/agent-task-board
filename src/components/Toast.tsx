import { useEffect } from 'react'

const TOAST_DURATION_MS = 3000

export interface ToastProps {
  message: string
  /** Called when the auto-dismiss timer fires. */
  onDone: () => void
}

/**
 * In-house toast. Renders a fixed bottom-right element that auto-dismisses
 * after ~3s. Re-triggering the toast (via a new `key` on the parent) resets
 * the timer.
 */
export function Toast({ message, onDone }: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDone, TOAST_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [onDone])

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}