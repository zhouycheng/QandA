/**
 * 每日学习日志：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaDailyLog）：
 * {
 *   "2026-09-19": { answered: 20, correct: 16, seconds: 640 },
 *   "2026-09-18": { answered: 10, correct: 7,  seconds: 300 }
 * }
 *
 * 为什么要单独记一份：
 *   - 做题进度（qandaProgress）是按题目覆盖的，只能反映「到目前为至」的快照，
 *     无法画出「最近七天每天做了多少」这种时间序列；
 *   - 学习时长只累计总数，同样没有分布。
 * 因此交卷时额外按天累加一份，供统计页的趋势图与连续天数使用。
 *
 * 只保留最近 MAX_KEEP_DAYS 天，避免本地存储无限增长。
 */

const DAILY_LOG_STORAGE_KEY = 'qandaDailyLog'
const MAX_KEEP_DAYS = 90
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function toTimestamp(timestamp) {
  const time = Number(timestamp)

  return Number.isFinite(time) && time > 0 ? time : Date.now()
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

/** 本地时区的 YYYY-MM-DD。和用户看到的「今天」保持一致，不用 UTC。 */
function formatDateKey(timestamp) {
  const date = new Date(toTimestamp(timestamp))

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfDay(timestamp) {
  const date = new Date(toTimestamp(timestamp))

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function shiftDays(timestamp, delta) {
  const date = new Date(toTimestamp(timestamp))

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta).getTime()
}

function createEmptyDailyLog() {
  return {}
}

function toSafeCount(value) {
  return Math.max(Math.floor(Number(value) || 0), 0)
}

function normalizeDailyEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {}

  return {
    answered: toSafeCount(entry.answered),
    correct: toSafeCount(entry.correct),
    seconds: toSafeCount(entry.seconds)
  }
}

function normalizeDailyLog(rawLog) {
  if (!rawLog || typeof rawLog !== 'object') {
    return createEmptyDailyLog()
  }

  return Object.keys(rawLog).reduce((result, key) => {
    // 只保留形如 2026-09-19 的键，脏数据直接丢掉
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      return result
    }

    result[key] = normalizeDailyEntry(rawLog[key])

    return result
  }, {})
}

/** 是否算「当天有学习」：答过题或累计过时长都算 */
function hasActivity(log, dateKey) {
  const entry = log[dateKey]

  if (!entry) {
    return false
  }

  return entry.answered > 0 || entry.seconds > 0
}

/**
 * 累加一次交卷结果。
 * @param {object} log 已规范化的日志
 * @param {object} result { answered, correct, seconds }
 * @param {number} timestamp 结算时间
 */
function addDailyResult(log, result, timestamp) {
  const current = normalizeDailyLog(log)
  const payload = result && typeof result === 'object' ? result : {}
  const answered = toSafeCount(payload.answered)
  const correct = Math.min(toSafeCount(payload.correct), answered)
  const seconds = toSafeCount(payload.seconds)

  if (answered <= 0 && seconds <= 0) {
    return current
  }

  const dateKey = formatDateKey(timestamp)
  const entry = current[dateKey] || { answered: 0, correct: 0, seconds: 0 }
  const next = Object.assign({}, current)

  next[dateKey] = {
    answered: entry.answered + answered,
    correct: entry.correct + correct,
    seconds: entry.seconds + seconds
  }

  return next
}

/** 丢弃超过保留期的记录 */
function pruneDailyLog(log, timestamp, keepDays) {
  const current = normalizeDailyLog(log)
  const days = Math.max(Number(keepDays) || MAX_KEEP_DAYS, 1)
  const earliest = shiftDays(timestamp, -(days - 1))
  const next = {}

  Object.keys(current).forEach((key) => {
    // 字符串比较即可，YYYY-MM-DD 天然按字典序等于时间序
    if (key >= formatDateKey(earliest)) {
      next[key] = current[key]
    }
  })

  return next
}

/**
 * 取最近 N 天（含今天），按时间正序返回 —— 直接就是折线图的 X 轴。
 */
function getRecentDays(log, days, timestamp) {
  const current = normalizeDailyLog(log)
  const count = Math.max(Math.floor(Number(days) || 0), 1)
  const end = startOfDay(timestamp)

  return new Array(count).fill(null).map((item, index) => {
    const offset = index - (count - 1)
    const dayTs = shiftDays(end, offset)
    const dateKey = formatDateKey(dayTs)
    const entry = current[dateKey] || { answered: 0, correct: 0, seconds: 0 }
    const date = new Date(dayTs)
    const accuracy = entry.answered ? Math.round((entry.correct / entry.answered) * 100) : 0

    return {
      key: dateKey,
      dayText: `${date.getDate()}`,
      monthDayText: `${date.getMonth() + 1}/${date.getDate()}`,
      weekdayText: WEEKDAYS[date.getDay()],
      isToday: offset === 0,
      answered: entry.answered,
      correct: entry.correct,
      seconds: entry.seconds,
      accuracy,
      accuracyText: `${accuracy}%`
    }
  })
}

/** 最近 N 天里有学习的天数 */
function countActiveDays(log, days, timestamp) {
  const current = normalizeDailyLog(log)

  return getRecentDays(current, days, timestamp).filter((day) => hasActivity(current, day.key)).length
}

/**
 * 连续学习天数：今天有记录就从今天往回数，今天还没有则从昨天回溯
 * —— 否则每天清晨打开应用都会看到连续天数被清零，体验很挫败。
 */
function calcStreak(log, timestamp) {
  const current = normalizeDailyLog(log)
  let cursor = startOfDay(timestamp)

  if (!hasActivity(current, formatDateKey(cursor))) {
    cursor = shiftDays(cursor, -1)
  }

  let streak = 0

  while (streak < MAX_KEEP_DAYS && hasActivity(current, formatDateKey(cursor))) {
    streak += 1
    cursor = shiftDays(cursor, -1)
  }

  return streak
}

/**
 * 最近 N 天的汇总，供趋势卡片的说明行使用。
 */
function summarizeRecentDays(log, days, timestamp) {
  const points = getRecentDays(log, days, timestamp)
  const answered = points.reduce((sum, day) => sum + day.answered, 0)
  const correct = points.reduce((sum, day) => sum + day.correct, 0)
  const seconds = points.reduce((sum, day) => sum + day.seconds, 0)
  const activeDays = points.filter((day) => day.answered > 0 || day.seconds > 0).length
  const peak = points.reduce((max, day) => (day.answered > max.answered ? day : max), points[0])

  return {
    answered,
    correct,
    seconds,
    activeDays,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    accuracyText: `${answered ? Math.round((correct / answered) * 100) : 0}%`,
    peakAnswered: peak ? peak.answered : 0,
    peakDayText: peak && peak.answered > 0 ? peak.monthDayText : '',
    hasData: answered > 0 || seconds > 0
  }
}

module.exports = {
  DAILY_LOG_STORAGE_KEY,
  MAX_KEEP_DAYS,
  addDailyResult,
  calcStreak,
  countActiveDays,
  createEmptyDailyLog,
  formatDateKey,
  getRecentDays,
  hasActivity,
  normalizeDailyLog,
  pruneDailyLog,
  summarizeRecentDays
}
