const {
  DAILY_LOG_STORAGE_KEY,
  MAX_KEEP_DAYS,
  addDailyResult,
  calcStreak,
  countActiveDays,
  getRecentDays,
  normalizeDailyLog,
  pruneDailyLog,
  summarizeRecentDays
} = require('../utils/daily-log.js')

/**
 * 仓储层：每日学习日志的读写，计算逻辑在 utils/daily-log.js。
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

function getDailyLog(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(DAILY_LOG_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeDailyLog(raw)
}

function saveDailyLog(storage, log) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizeDailyLog(log)

  try {
    adapter.set(DAILY_LOG_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

/**
 * 结算一次练习：累加到当天，并顺手裁掉超出保留期的记录。
 * 裁剪放在写入路径上而不是读取路径上，读取侧就永远不用做清理。
 */
function addDailyLog(storage, result, timestamp) {
  const merged = addDailyResult(getDailyLog(storage), result, timestamp)
  const pruned = pruneDailyLog(merged, timestamp, MAX_KEEP_DAYS)

  return saveDailyLog(storage, pruned)
}

function clearDailyLog(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    if (adapter.remove) {
      adapter.remove(DAILY_LOG_STORAGE_KEY)
    } else {
      adapter.set(DAILY_LOG_STORAGE_KEY, {})
    }
  } catch (error) {
    return {}
  }

  return {}
}

/** 统计页用的一次性读取：日志 + 逐日序列 + 近 N 天汇总 + 连续天数 */
function getDailySummary(storage, days, timestamp) {
  const log = getDailyLog(storage)
  const windowDays = Math.max(Number(days) || 7, 1)

  return {
    log,
    days: getRecentDays(log, windowDays, timestamp),
    recent: summarizeRecentDays(log, windowDays, timestamp),
    activeDays: countActiveDays(log, windowDays, timestamp),
    streak: calcStreak(log, timestamp)
  }
}

module.exports = {
  addDailyLog,
  clearDailyLog,
  getDailyLog,
  getDailySummary,
  saveDailyLog
}
