import { NavLink } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

function navClass({ isActive }: { isActive: boolean }): string {
  return `site-header__link${isActive ? ' is-active' : ''}`
}

/**
 * Site header. Renders the app title and primary nav on the left and the
 * theme toggle on the right. The active route gets an accent border via the
 * `.is-active` class so users can see which page they're on.
 */
export function Header() {
  return (
    <header className="site-header">
      <nav className="site-header__nav">
        <span className="site-header__title">agent-task-board</span>
        <NavLink to="/" end className={navClass}>
          Home
        </NavLink>
        <NavLink to="/habits" className={navClass}>
          Habits
        </NavLink>
      </nav>
      <ThemeToggle />
    </header>
  )
}