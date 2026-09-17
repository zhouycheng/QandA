import type { ReactNode } from 'react'

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <section className="state-view">
      <span className="state-symbol" aria-hidden="true">○</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}
