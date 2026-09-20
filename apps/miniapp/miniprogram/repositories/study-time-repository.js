const {
  STUDY_TIME_STORAGE_KEY,
  addStudySession,
  createEmptyStudyTime,
  normalizeStudyTime
} = require('../utils/study-time.js')

/**
 * 仓储层：只负责学习时长的读写，计算逻辑在 utils/study-time.js。
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

function getStudyTime(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(STUDY_TIME_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeStudyTime(raw)
}

function saveStudyTime(storage, studyTime) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizeStudyTime(studyTime)

  try {
    adapter.set(STUDY_TIME_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

/**
 * 结算一次练习：读取累计值 → 累加本次秒数 → 写回。
 * @returns {object} 结算后的累计时长
 */
function addStudyTime(storage, seconds, timestamp) {
  const next = addStudySession(getStudyTime(storage), seconds, timestamp)

  return saveStudyTime(storage, next)
}

function clearStudyTime(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(STUDY_TIME_STORAGE_KEY)
  } catch (error) {
    return createEmptyStudyTime()
  }

  return createEmptyStudyTime()
}

module.exports = {
  addStudyTime,
  clearStudyTime,
  getStudyTime,
  saveStudyTime
}
