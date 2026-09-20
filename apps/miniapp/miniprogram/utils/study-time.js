/**
 * 学习时长：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaStudyTime）：
 * {
 *   totalSeconds: 12600,   // 累计学习秒数
 *   sessionCount: 18,      // 累计完成的练习次数
 *   updatedAt: 1758000000000
 * }
 *
 * 时长在「交卷」时结算，按本次练习的实际在场时间累加。
 * 答题页切到后台会暂停计时，避免挂机把时长算虚。
 */

const STUDY_TIME_STORAGE_KEY = 'qandaStudyTime'

// 单次练习最多按 2 小时结算：正常做一套题不会超过这个量，
// 超出基本是忘记关页面，直接截断避免污染累计值。
const MAX_SESSION_SECONDS = 2 * 60 * 60

function createEmptyStudyTime() {
  return {
    totalSeconds: 0,
    sessionCount: 0,
    updatedAt: 0
  }
}

function normalizeStudyTime(rawStudyTime) {
  if (!rawStudyTime || typeof rawStudyTime !== 'object') {
    return createEmptyStudyTime()
  }

  return {
    totalSeconds: Math.max(Math.floor(Number(rawStudyTime.totalSeconds) || 0), 0),
    sessionCount: Math.max(Math.floor(Number(rawStudyTime.sessionCount) || 0), 0),
    updatedAt: Number(rawStudyTime.updatedAt) || 0
  }
}

/**
 * 结算一次练习时长。
 * @param {object} currentStudyTime 已规范化的累计时长
 * @param {number} seconds 本次练习实际用时（秒）
 * @param {number} timestamp 结算时间戳
 * @returns {object} 新的累计时长；本次为 0 秒时原样返回，避免写入无意义的更新
 */
function addStudySession(currentStudyTime, seconds, timestamp) {
  const normalized = normalizeStudyTime(currentStudyTime)
  const safeSeconds = Math.min(Math.max(Math.round(Number(seconds) || 0), 0), MAX_SESSION_SECONDS)

  if (safeSeconds <= 0) {
    return normalized
  }

  return {
    totalSeconds: normalized.totalSeconds + safeSeconds,
    sessionCount: normalized.sessionCount + 1,
    updatedAt: Number(timestamp) || Date.now()
  }
}

/**
 * 格式化成中文可读时长，供首页 / 统计页展示。
 * 0 秒不显示「0 分钟」，而是给一句更有引导性的文案。
 */
function formatStudyDuration(totalSeconds) {
  const safeSeconds = Math.max(Math.floor(Number(totalSeconds) || 0), 0)

  if (safeSeconds <= 0) {
    return '尚未开始'
  }

  if (safeSeconds < 60) {
    return '不到1分钟'
  }

  const totalMinutes = Math.floor(safeSeconds / 60)

  if (totalMinutes < 60) {
    return `${totalMinutes}分钟`
  }

  // 单位连写，避免在首页的指标格子里被挤成两行
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return minutes ? `${hours}时${minutes}分` : `${hours}小时`
}

module.exports = {
  MAX_SESSION_SECONDS,
  STUDY_TIME_STORAGE_KEY,
  addStudySession,
  createEmptyStudyTime,
  formatStudyDuration,
  normalizeStudyTime
}
