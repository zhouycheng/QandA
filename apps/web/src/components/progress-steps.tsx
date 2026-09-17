export function ProgressSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="progress-steps" aria-label={`准备进度：第 ${current} 步，共 3 步`}>
      {[1, 2, 3].map((step) => <i key={step} className={step <= current ? 'active' : ''} />)}
    </div>
  )
}
