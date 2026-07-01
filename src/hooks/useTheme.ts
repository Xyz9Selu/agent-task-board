import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark'
export type Theme = ThemePreference

const STORAGE_KEY = 'agent-task-board:theme'
const DATA_ATTRIBUTE = 'data-theme'

function isPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark'
}

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isPreference(stored) ? stored : null
  } catch {
    return null
  }
}

function readSystemPreference(): ThemePreference {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function resolveTheme(preference: ThemePreference | null): Theme {
  return preference ?? readSystemPreference()
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(DATA_ATTRIBUTE, theme)
}

/**
 * Manages the current theme (light/dark).
 *
 * - On first render, reads any stored preference from localStorage; if none,
 *   falls back to the OS `prefers-color-scheme`.
 * - `setPreference` writes to localStorage and updates the `data-theme`
 *   attribute on `<html>` so CSS picks up the change.
 * - The OS preference is captured at first visit; we do not subscribe to live
 *   OS-level theme changes (matches the design decision in docs/designs/2.md).
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference | null>(
    () => readStoredPreference(),
  )

  const resolved: Theme = resolveTheme(preference)

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage failures (Safari private mode, etc.)
    }
  }, [])

  const togglePreference = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setPreference])

  return {
    preference,
    resolved,
    setPreference,
    togglePreference,
  }
}