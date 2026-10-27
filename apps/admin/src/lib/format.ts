export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dateRange(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days + 1)
  return { start: localDate(start), end: localDate(end) }
}
export function formatDate(value?: string) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—'
}
