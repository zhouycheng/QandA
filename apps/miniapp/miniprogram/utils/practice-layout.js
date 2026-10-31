const DEFAULT_ORDER = ['info', 'stem', 'response', 'analysis', 'tools']
const LABELS = { info: '题目信息', stem: '题干', response: '作答区', analysis: '答案解析', tools: '工具栏' }
function normalizeOrder(order, legacy) {
  if (Array.isArray(order) && order.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every(id => order.filter(value => value === id).length === 1)) return order.slice()
  return legacy === 'above' ? ['info', 'response', 'stem', 'analysis', 'tools'] : DEFAULT_ORDER.slice()
}
function ranks(order) { const result = {}; normalizeOrder(order).forEach((id, index) => { result[id] = index }); return result }
function move(order, id, index) {
  const next = normalizeOrder(order)
  if (!next.includes(id) || !Number.isInteger(index) || index < 0 || index >= next.length) return next
  next.splice(next.indexOf(id), 1)
  next.splice(index, 0, id)
  return next
}
module.exports = { DEFAULT_ORDER, LABELS, normalizeOrder, ranks, move }
