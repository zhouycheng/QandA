const {
  PREFERENCE_STORAGE_KEY,
  normalizePreferences,
  setPreferenceChoice,
  setPreferenceSwitch,
  setPreferenceText
} = require('../utils/preferences.js')

/**
 * 仓储层：只负责学习偏好的读写，取值规则在 utils/preferences.js。
 * storage 由页面注入，未注入时退化为默认偏好，便于在 Node 中测试。
 */
function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {}
  }
}

function getStorageAdapter(storage) {
  return storage || createNullStorage()
}

function getPreferences(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(PREFERENCE_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizePreferences(raw)
}

function savePreferences(storage, preferences) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizePreferences(preferences)

  adapter.set(PREFERENCE_STORAGE_KEY, normalized)

  return normalized
}

function updatePreferenceSwitch(storage, key, value) {
  return savePreferences(storage, setPreferenceSwitch(getPreferences(storage), key, value))
}

function updatePreferenceChoice(storage, key, value) {
  return savePreferences(storage, setPreferenceChoice(getPreferences(storage), key, value))
}

/** 文本型偏好：考试名称 / 考试日期（首页倒计时卡用） */
function updatePreferenceText(storage, key, value) {
  return savePreferences(storage, setPreferenceText(getPreferences(storage), key, value))
}

/** 答题偏好独立恢复默认，保留布局与考试倒计时。 */
function resetPreferences(storage) {
  const current = getPreferences(storage)
  return savePreferences(storage, Object.assign(normalizePreferences(null), { moduleOrder: current.moduleOrder, examName: current.examName, examDate: current.examDate }))
}

module.exports = {
  getPreferences,
  resetPreferences,
  savePreferences,
  updatePreferenceChoice,
  updatePreferenceSwitch,
  updatePreferenceText
}
