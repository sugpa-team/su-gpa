import { useState } from 'react'

const STORAGE_KEY = 'su-gpa-tour-v1'

export function useOnboardingTour() {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY) }
    catch { return true }
  })

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') }
    catch { /* localStorage unavailable (private mode / quota) — ignore */ }
    setVisible(false)
  }

  return { visible, dismiss }
}
