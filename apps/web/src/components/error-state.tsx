export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="state-view state-error" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <h2>暂时无法完成请求</h2>
      <p>{message}</p>
      {onRetry && <button className="button button-danger" onClick={onRetry}>重新加载</button>}
    </section>
  )
}
