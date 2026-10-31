const { uuid } = require('./api-transport.js')
const PREFIX = 'qandaSync:v1:'
const copy = (value) => JSON.parse(JSON.stringify(value))
function createSyncQueue(options) {
  const { storage, userId, send } = options
  if (!userId || !storage || typeof send !== 'function') throw new Error('同步队列需要用户、存储和发送方法')
  const now = options.now || Date.now
  const random = options.random || Math.random
  const setTimer = options.setTimer || setTimeout
  const clearTimer = options.clearTimer || clearTimeout
  const indexKey = `${PREFIX}${userId}:index`
  const timers = {}
  const sending = {}
  let stopped = false
  function key(id) { return `${PREFIX}${userId}:${id}` }
  function ids() { const value = storage.get(indexKey); return Array.isArray(value) ? value : [] }
  function get(id) {
    const value = storage.get(key(id))
    if (!value) return null
    if (value.formatVersion !== 1 || value.userId !== userId || value.sessionId !== id) throw new Error('草稿格式不兼容，请保留本地记录后更新客户端')
    return copy(value)
  }
  function persist(id, value) {
    storage.set(key(id), value)
    const index = ids()
    if (index.indexOf(id) < 0) storage.set(indexKey, index.concat(id))
    if (options.onChange) options.onChange(id, copy(value))
  }
  function cancelTimer(id) { if (timers[id] !== undefined) { clearTimer(timers[id]); delete timers[id] } }
  function schedule(id, delay) {
    if (stopped || timers[id] !== undefined) return
    timers[id] = setTimer(() => { delete timers[id]; flush(id) }, delay)
  }
  function save(id, payload) {
    try {
      const previous = get(id)
      if (previous && JSON.stringify(previous.payload.progress || previous.payload) === JSON.stringify(payload.progress || payload)) return { ok: true, draft: previous, unchanged: true }
      const draft = Object.assign({ formatVersion: 1, userId, sessionId: id, sequence: 0, acknowledgedSequence: 0, pending: null, failures: 0, paused: false }, previous || {}, { sequence: (previous && previous.sequence || 0) + 1, payload: copy(payload), updatedAt: now() })
      persist(id, draft)
      if (!draft.paused && !sending[id]) schedule(id, Math.max(draft.nextAttemptAt ? draft.nextAttemptAt - now() : 0, 0, 5000 - (now() - (draft.lastAttemptAt || now()))))
      return { ok: true, draft: copy(draft) }
    } catch (error) { return { ok: false, storageError: true, reason: '答题数据保存失败，请检查设备存储空间' } }
  }
  function flush(id) {
    if (sending[id]) return sending[id]
    cancelTimer(id)
    let draft
    try {
      draft = get(id)
      if (!draft || (!draft.pending && draft.sequence <= draft.acknowledgedSequence)) return Promise.resolve({ ok: true, idle: true })
      if (draft.nextAttemptAt > now()) { schedule(id, draft.nextAttemptAt - now()); return Promise.resolve({ ok: false, deferred: true, retryAfter: draft.nextAttemptAt - now(), reason: draft.reason || '稍后重试同步' }) }
      if (draft.paused || stopped) return Promise.resolve({ ok: false, paused: true, reason: draft.reason || '同步已暂停' })
      if (!draft.pending) draft.pending = { sequence: draft.sequence, payload: copy(draft.payload), idempotencyKey: uuid() }
      draft.lastAttemptAt = now()
      persist(id, draft)
    } catch (error) { return Promise.resolve({ ok: false, storageError: true, reason: '答题数据保存失败，请检查设备存储空间' }) }
    const command = copy(draft.pending)
    sending[id] = Promise.resolve().then(() => send(id, command)).catch(() => ({ ok: false, statusCode: 0, reason: '网络请求失败' })).then((result) => {
      try {
        const current = get(id)
        if (result.ok) {
          current.acknowledgedSequence = Math.max(current.acknowledgedSequence, command.sequence)
          current.lastAcknowledgedKey = command.idempotencyKey
          current.pending = null
          current.failures = 0
          current.nextAttemptAt = 0
          current.reason = ''
          current.lastResponse = result
          persist(id, current)
          if (current.sequence > current.acknowledgedSequence) schedule(id, 5000)
        } else {
          current.failures += 1
          current.reason = result.reason || '等待联网同步'
          current.lastStatusCode = result.statusCode || 0
          const status = result.statusCode || 0
          current.paused = status === 401 || status === 403 || status === 409 || (status >= 400 && status < 500 && status !== 408 && status !== 429)
          const delay = Math.max(result.retryAfter || 0, Math.min(60000, 1000 * Math.pow(2, Math.min(current.failures - 1, 6))) * (0.5 + random() * 0.5))
          current.nextAttemptAt = current.paused ? 0 : now() + delay
          persist(id, current)
          cancelTimer(id)
          if (!current.paused) schedule(id, delay)
        }
        return result
      } catch (error) { return { ok: false, storageError: true, reason: '同步确认保存失败，本地答案仍保留' } }
    }).then((result) => { delete sending[id]; return result })
    return sending[id]
  }
  function resume(id) {
    try {
      const value = get(id)
      if (value) { value.paused = false; value.reason = ''; value.nextAttemptAt = 0; persist(id, value) }
      return flush(id)
    } catch (error) { return Promise.resolve({ ok: false, storageError: true, reason: '无法读取待同步答案' }) }
  }
  function removeConfirmed(id) {
    try {
      const draft = get(id)
      if (sending[id] || (draft && (draft.pending || draft.sequence > draft.acknowledgedSequence))) return false
      cancelTimer(id)
      storage.remove(key(id))
      storage.set(indexKey, ids().filter((value) => value !== id))
      return true
    } catch (error) { return false }
  }
  function resumeAuthOnly() { return Promise.all(ids().filter((id) => { const draft = get(id); return draft && draft.paused && (draft.lastStatusCode === 401 || draft.lastStatusCode === 403) }).map(resume)) }
  function flushAll() { return Promise.all(ids().map(flush)) }
  function stop() { stopped = true; Object.keys(timers).forEach(cancelTimer) }
  return { save, get, flush, flushAll, resume, resumeAuthOnly, removeConfirmed, stop, sessionIds: ids }
}
module.exports = { createSyncQueue }
