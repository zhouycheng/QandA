import { NavLink, Outlet } from 'react-router-dom'
import { Brand } from './brand'

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/subjects" className="brand-link"><Brand /></NavLink>
        <nav aria-label="主导航">
          <NavLink to="/subjects">开始练习</NavLink>
          {import.meta.env.DEV && <NavLink to="/playground">Playground</NavLink>}
        </nav>
      </header>
      <main className="site-main"><Outlet /></main>
    </div>
  )
}
