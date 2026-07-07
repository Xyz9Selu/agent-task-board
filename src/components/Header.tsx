import { NavLink } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

/**
 * Site header. Renders the app title on the left, the primary nav in the
 * middle, and the theme toggle on the right. Sits at the top of `#root`,
 * which is a flex column.
 */
export function Header() {
  return (
    <header className="site-header">
      <span className="site-header__title">agent-task-board</span>
      <nav className="site-header__nav" aria-label="Primary">
        <NavLink
          to="/contact"
          className={({ isActive }) =>
            'site-header__nav-link' + (isActive ? ' is-active' : '')
          }
        >
          Contact
        </NavLink>
      </nav>
      <ThemeToggle />
    </header>
  )
}