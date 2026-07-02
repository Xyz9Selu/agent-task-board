import { useTheme } from '../hooks/useTheme'

/**
 * Button that toggles between light and dark themes.
 *
 * Renders the opposite icon (sun when the app is dark, moon when light) so the
 * visible glyph is the action that will happen on click. Exposes state via
 * `aria-pressed` and a dynamic `aria-label` so screen readers announce both
 * the current state and the action.
 */
export function ThemeToggle() {
  const { resolved, togglePreference } = useTheme()
  const isDark = resolved === 'dark'
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      className={`theme-toggle${isDark ? ' is-dark' : ''}`}
      onClick={togglePreference}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      <svg
        className="theme-toggle__icon theme-toggle__icon--sun"
        role="presentation"
        aria-hidden="true"
      >
        <use href="/icons.svg#sun-icon"></use>
      </svg>
      <svg
        className="theme-toggle__icon theme-toggle__icon--moon"
        role="presentation"
        aria-hidden="true"
      >
        <use href="/icons.svg#moon-icon"></use>
      </svg>
    </button>
  )
}