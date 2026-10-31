const { observable, runInAction } = require('mobx-miniprogram')

function createResourceCache() {
  const entries = observable.map({}, { deep: false })
  const pending = new Map()
  let generation = 0
  function clear() { generation += 1; pending.clear(); runInAction(() => entries.clear()) }
  function invalidate(prefix) {
    runInAction(() => entries.forEach((entry, key) => {
      if (key.indexOf(prefix) === 0) {
        entries.set(key, Object.assign({}, entry, { at: 0, revision: (entry.revision || 0) + 1 }))
        pending.delete(key)
      }
    }))
  }
  function read(key) { return entries.get(key) || { status: 'idle', data: null, error: '', at: 0 } }
  function load(key, ttl, request, publish, force) {
    if (pending.has(key)) return pending.get(key)
    const entry = read(key)
    if (!force && entry.at && Date.now() - entry.at < ttl) return Promise.resolve(entry.data)
    const revision = generation
    runInAction(() => entries.set(key, Object.assign({}, entry, { status: 'loading', error: '' })))
    const promise = Promise.resolve().then(request).then(data => {
      if (generation !== revision || (read(key).revision || 0) !== (entry.revision || 0)) return null
      runInAction(() => {
        if (publish) publish(data)
        entries.set(key, { data, status: 'ready', error: '', at: Date.now(), revision: entry.revision || 0 })
      })
      return data
    }).catch(error => {
      if (generation !== revision || (read(key).revision || 0) !== (entry.revision || 0)) return null
      runInAction(() => entries.set(key, Object.assign({}, entry, { status: 'error', error: error.message })))
      throw error
    }).finally(() => { if (pending.get(key) === promise) pending.delete(key) })
    pending.set(key, promise)
    return promise
  }
  return { read, load, clear, invalidate }
}
function queryKey(name, query) {
  return name + ':' + JSON.stringify(Object.keys(query || {}).sort().reduce((out, key) => {
    if (query[key] !== undefined && query[key] !== '') out[key] = query[key]
    return out
  }, {}))
}
module.exports = { createResourceCache, queryKey }
