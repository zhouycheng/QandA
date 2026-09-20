const {
  PROGRESS_STORAGE_KEY,
  createEmptyProgress,
  mergeScopeRecords,
  normalizeProgress
} = require('../utils/practice-progress.js')

/**
 * 仓储层：只负责把进度表读写到本地存储，计算逻辑在 utils/practice-progress.js。
 * storage 由页面注入（微信端传 wx 适配器），未注入时退化为空实现，便于在 Node 中测试。
 */
function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getStorageAdapter(storage) {
  return storage || createNullStorage()
}

function getProgress(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(PROGRESS_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeProgress(raw)
}

function saveScopeProgress(storage, scopeKey, records, total, timestamp) {
  const adapter = getStorageAdapter(storage)
  const nextProgress = mergeScopeRecords(getProgress(storage), scopeKey, records, total, timestamp)

  try {
    adapter.set(PROGRESS_STORAGE_KEY, nextProgress)
  } catch (error) {
    return nextProgress
  }

  return nextProgress
}

function clearProgress(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(PROGRESS_STORAGE_KEY)
  } catch (error) {
    return createEmptyProgress()
  }

  return createEmptyProgress()
}

module.exports = {
  clearProgress,
  getProgress,
  saveScopeProgress
}
