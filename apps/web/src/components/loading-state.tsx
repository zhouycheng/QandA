export function LoadingState({ fullPage = false, label = '正在加载…' }: { fullPage?: boolean; label?: string }) {
  return (
    <div className={fullPage ? 'state-view state-view-full' : 'state-view'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <strong>{label}</strong>
      <div className="skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
    </div>
  )
}
