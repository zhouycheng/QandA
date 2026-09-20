const {
  WRONG_BOOK_STORAGE_KEY,
  createEmptyWrongBook,
  getMasteredIds,
  getPendingIds,
  mergeResults,
  normalizeWrongBook,
  removeIds,
  summarizeWrongBook
} = require('../utils/wrong-book.js')

/**
 * 仓储层：错题本读写。计算逻辑在 utils/wrong-book.js。
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

function getWrongBook(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(WRONG_BOOK_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeWrongBook(raw)
}

function saveWrongBook(storage, wrongBook) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizeWrongBook(wrongBook)

  try {
    adapter.set(WRONG_BOOK_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

/**
 * 交卷后写入逐题结果。
 * @param {Array} records [{ id, answered, correct }]
 */
function saveResults(storage, records) {
  if (!records || !records.length) {
    return getWrongBook(storage)
  }

  return saveWrongBook(storage, mergeResults(getWrongBook(storage), records, Date.now()))
}

function removeQuestions(storage, questionIds) {
  return saveWrongBook(storage, removeIds(getWrongBook(storage), questionIds, Date.now()))
}

function clearWrongBook(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(WRONG_BOOK_STORAGE_KEY)
  } catch (error) {
    return createEmptyWrongBook()
  }

  return createEmptyWrongBook()
}

module.exports = {
  clearWrongBook,
  getMasteredIds,
  getPendingIds,
  getWrongBook,
  removeQuestions,
  saveResults,
  saveWrongBook,
  summarizeWrongBook
}
