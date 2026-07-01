import { ThemeToggle } from './ThemeToggle'

/**
 * Site header. Renders the app title on the left and the theme toggle on the
 * right. Sits at the top of `#root`, which is a flex column.
 */
export function Header() {
  return (
    <header className="site-header">
      <span className="site-header__title">agent-task-board</span>
      <ThemeToggle />
    </header>
  )
}