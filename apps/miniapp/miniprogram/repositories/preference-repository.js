const {
  PREFERENCE_STORAGE_KEY,
  normalizePreferences,
  setPreferenceChoice,
  setPreferenceSwitch
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

  try {
    adapter.set(PREFERENCE_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

function updatePreferenceSwitch(storage, key, value) {
  return savePreferences(storage, setPreferenceSwitch(getPreferences(storage), key, value))
}

function updatePreferenceChoice(storage, key, value) {
  return savePreferences(storage, setPreferenceChoice(getPreferences(storage), key, value))
}

/** 恢复默认：偏好属于「设置」，清空学习数据时不该一并抹掉，因此单独提供重置入口 */
function resetPreferences(storage) {
  return savePreferences(storage, normalizePreferences(null))
}

module.exports = {
  getPreferences,
  resetPreferences,
  savePreferences,
  updatePreferenceChoice,
  updatePreferenceSwitch
}
