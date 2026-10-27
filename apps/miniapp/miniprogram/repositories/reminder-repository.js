const {
  REMINDER_STORAGE_KEY,
  addExam,
  normalizeReminder,
  removeExam,
  setReminderFrequency,
  setReminderSwitch,
  setReminderTime,
  toggleAdvanceDay
} = require('../utils/reminder-settings.js')

/**
 * 仓储层：只负责邮箱提醒设置的读写，取值 / 校验规则在 utils/reminder-settings.js。
 * storage 由页面注入，未注入时退化为默认设置，便于在 Node 中测试。
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

function getReminder(storage) {
  let raw = null

  try {
    raw = getStorageAdapter(storage).get(REMINDER_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeReminder(raw)
}

function saveReminder(storage, reminder) {
  const normalized = normalizeReminder(reminder)

  try {
    getStorageAdapter(storage).set(REMINDER_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

function updateReminderSwitch(storage, key, value) {
  return saveReminder(storage, setReminderSwitch(getReminder(storage), key, value))
}

function updateReminderTime(storage, time) {
  return saveReminder(storage, setReminderTime(getReminder(storage), time))
}

function updateReminderFrequency(storage, frequency) {
  return saveReminder(storage, setReminderFrequency(getReminder(storage), frequency))
}

function toggleAdvance(storage, day) {
  return saveReminder(storage, toggleAdvanceDay(getReminder(storage), day))
}

/**
 * 添加考试。
 * 返回 `{ ok, reason }` 而不是抛错：页面要拿 reason 直接 toast，
 * 校验规则仍只在 utils 里写一份。
 */
function addReminderExam(storage, payload) {
  const outcome = addExam(getReminder(storage), payload)

  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason }
  }

  saveReminder(storage, outcome.reminder)

  return { ok: true, reminder: outcome.reminder }
}

function removeReminderExam(storage, id) {
  return saveReminder(storage, removeExam(getReminder(storage), id))
}

module.exports = {
  REMINDER_STORAGE_KEY,
  addReminderExam,
  getReminder,
  removeReminderExam,
  saveReminder,
  toggleAdvance,
  updateReminderFrequency,
  updateReminderSwitch,
  updateReminderTime
}
