import { Empty } from '@arco-design/web-react'

export function LineChart({
  data,
  percent = false,
  label,
}: {
  data: { label: string; value: number; secondary?: number }[]
  percent?: boolean
  label: string
}) {
  if (!data.length) return <Empty description="暂无统计数据" />
  const max = Math.max(1, ...data.map((d) => d.value))
  const ceiling = Math.ceil(max / 4) * 4
  const x = (i: number) => 48 + (i / Math.max(1, data.length - 1)) * 490
  const y = (n: number, secondary = false) => 220 - (n / (secondary && percent ? 100 : ceiling)) * 180
  const points = (secondary = false) =>
    data.map((d, i) => `${x(i)},${y(secondary ? (d.secondary ?? 0) : d.value, secondary)}`).join(' ')
  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 600 265" role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="48" y1={40 + i * 45} x2="540" y2={40 + i * 45} stroke="#dce8f8" strokeDasharray="5 5" />
            <text x="39" y={44 + i * 45} textAnchor="end">
              {Math.round(ceiling * (1 - i / 4))}
            </text>
            {percent && (
              <text x="550" y={44 + i * 45}>
                {100 - i * 25}%
              </text>
            )}
          </g>
        ))}
        <polyline points={points()} fill="none" stroke="#087bff" strokeWidth="2.5" strokeLinejoin="round" />
        {data.some((d) => d.secondary !== undefined) && (
          <polyline points={points(true)} fill="none" stroke="#9bc7ff" strokeWidth="2" />
        )}
        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={y(d.value)} r="3" fill="#087bff">
              <title>
                {d.label}：{d.value}
                {d.secondary !== undefined
                  ? `，${percent ? '正确率' : '对比值'} ${d.secondary}${percent ? '%' : ''}`
                  : ''}
              </title>
            </circle>
            {(i % Math.max(1, Math.ceil(data.length / 7)) === 0 || i === data.length - 1) && (
              <text x={x(i)} y="246" textAnchor="middle">
                {d.label.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function DonutChart({
  values,
  labels,
  center,
  caption,
}: {
  values: number[]
  labels: string[]
  center: string
  caption: string
}) {
  const total = values.reduce((a, b) => a + b, 0)
  const percent = total ? Math.round((values[0] / total) * 100) : 0
  return (
    <div className="donut-block">
      <div
        className="donut"
        role="img"
        aria-label={values.map((v, i) => `${labels[i]} ${v}`).join('，')}
        style={{
          background: total
            ? `conic-gradient(var(--primary) 0 ${percent}%, #95c3ff ${percent}% 100%)`
            : '#e8eef7',
        }}
      >
        <div>
          <strong>{center}</strong>
          <span>{caption}</span>
        </div>
      </div>
      <div className="chart-legend">
        {labels.map((l, i) => (
          <span key={l}>
            <i style={{ background: i ? '#95c3ff' : 'var(--primary)' }} />
            {l} {total ? Math.round((values[i] / total) * 100) : 0}%
          </span>
        ))}
      </div>
    </div>
  )
}

export function BarChart({
  data,
  label,
}: {
  data: { label: string; value: number; secondary?: number }[]
  label: string
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.secondary ?? 0]))
  if (!data.length) return <Empty description="暂无统计数据" />
  return (
    <div className="bar-chart" role="img" aria-label={label}>
      {data.map((d) => (
        <div className="bar-column" key={d.label}>
          <div className="bar-values">
            <div className="bar" style={{ height: `${(d.value / max) * 145}px` }}>
              <span>{d.value}</span>
            </div>
            {d.secondary !== undefined && (
              <div className="bar secondary" style={{ height: `${(d.secondary / max) * 145}px` }}>
                <span>{d.secondary}</span>
              </div>
            )}
          </div>
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  )
}
