const {
  CUSTOM_QUIZ_STORAGE_KEY,
  createCustomQuiz,
  createEmptyCustomQuiz,
  normalizeCustomQuiz
} = require('../utils/custom-quiz.js')

/**
 * 仓储层：自定义练习（错题重练 / 收藏练习）的题目 id 列表。
 * 只保留最近一份，读完后不清空，便于答题页返回后再次进入。
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

function getCustomQuiz(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(CUSTOM_QUIZ_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeCustomQuiz(raw)
}

function saveCustomQuiz(storage, questionIds, title) {
  const adapter = getStorageAdapter(storage)
  const payload = createCustomQuiz(questionIds, title, Date.now())

  try {
    adapter.set(CUSTOM_QUIZ_STORAGE_KEY, payload)
  } catch (error) {
    return payload
  }

  return payload
}

function clearCustomQuiz(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(CUSTOM_QUIZ_STORAGE_KEY)
  } catch (error) {
    return createEmptyCustomQuiz()
  }

  return createEmptyCustomQuiz()
}

module.exports = {
  clearCustomQuiz,
  getCustomQuiz,
  saveCustomQuiz
}
