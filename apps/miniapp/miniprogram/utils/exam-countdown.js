/**
 * 考试倒计时：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 首页倒计时卡需要三样东西：标题、剩余天数、进度。三者都由「考试名称 + 考试日期」
 * 推出，用户没设置时不能显示「还有 NaN 天」，而要退化成一句可点击的设置引导。
 *
 * 日期统一按**本地日历天**算，不做毫秒差——
 * 用 (结束 - 现在) / 86400000 会让「明天考试」在晚上 23:59 显示成 0 天、凌晨 00:01 又跳成 1 天，
 * 用户看到的就是「明明还有一天，却显示今天」。
 */

const EXAM_NAME_MAX_LENGTH = 20

/** 进度条:从设置那一刻算「剩余 100%」，到考试当天归零 */
const DEFAULT_PREPARE_DAYS = 30

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** '2026-12-10' → 本地零点的时间戳；格式不对返回 0 */
function parseDateKey(dateKey) {
  if (typeof dateKey !== 'string') {
    return 0
  }

  const matched = dateKey.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

  if (!matched) {
    return 0
  }

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return 0
  }

  const date = new Date(year, month - 1, day, 0, 0, 0, 0)

  // 2 月 31 日这种会被 Date 顺延到下个月，回头校验一次
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return 0
  }

  return date.getTime()
}

function toDateKey(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 两个时间戳之间相差多少个本地日历天（后者减前者） */
function diffCalendarDays(fromTimestamp, toTimestamp) {
  const from = new Date(Number(fromTimestamp) || 0)
  const to = new Date(Number(toTimestamp) || 0)

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return 0
  }

  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()

  return Math.round((toDay - fromDay) / 86400000)
}

function normalizeExam(raw) {
  const source = raw || {}
  const dateTimestamp = parseDateKey(source.examDate)

  return {
    examName: typeof source.examName === 'string'
      ? source.examName.trim().slice(0, EXAM_NAME_MAX_LENGTH)
      : '',
    examDate: dateTimestamp > 0 ? source.examDate : '',
    examDateTimestamp: dateTimestamp
  }
}

/**
 * 倒计时视图。
 *
 * @param {object} exam { examName, examDate }
 * @param {number} now 当前时间戳（便于测试固定时间）
 * @returns {object} 首页倒计时卡直接可用的字段
 */
function buildExamCountdown(exam, now) {
  const normalized = normalizeExam(exam)
  const current = Number(now) > 0 ? Number(now) : Date.now()

  if (normalized.examDateTimestamp <= 0) {
    return {
      configured: false,
      examName: normalized.examName,
      examDate: '',
      daysLeft: 0,
      title: normalized.examName ? `${normalized.examName} · 待设置日期` : '设置考试倒计时',
      // 未设置时给一句固定文案，别让卡片空着
      note: '设置考试名称与日期，首页会每天提醒你还剩几天',
      dayText: '',
      statusText: '去设置',
      progressPercent: 0,
      isExamDay: false,
      isPast: false
    }
  }

  const daysLeft = diffCalendarDays(current, normalized.examDateTimestamp)

  /**
   * 有日期没名称：同样算「没设置完」。
   *
   * 设置页是「先选日期、后填名称」的顺序，中间态会在 storage 里留一个没名字的日期。
   * 若这里放行，首页就会显示「距离 考试 考试还有 51 天」——两个「考试」叠在一起，
   * 比不显示更糟。宁可退回引导态，让用户补完名称。
   */
  if (!normalized.examName) {
    return {
      configured: false,
      examName: '',
      examDate: normalized.examDate,
      daysLeft,
      title: `${normalized.examDate.replace(/-/g, '/')} · 待填写名称`,
      note: '再填一个考试名称，倒计时就会出现在首页',
      dayText: '',
      statusText: '去补名称',
      progressPercent: 0,
      isExamDay: false,
      isPast: false
    }
  }

  const examName = normalized.examName
  const isExamDay = daysLeft === 0
  const isPast = daysLeft < 0
  // 剩余比例按「设置时默认 30 天准备期」折算，超出即 100%
  const progressPercent = isPast
    ? 0
    : Math.max(0, Math.min(100, Math.round((daysLeft / DEFAULT_PREPARE_DAYS) * 100)))

  return {
    configured: true,
    examName,
    examDate: normalized.examDate,
    daysLeft,
    title: `${examName} · ${normalized.examDate.replace(/-/g, '/')}`,
    note: '',
    dayText: isPast ? '已结束' : isExamDay ? '就是今天' : String(daysLeft),
    statusText: isPast ? '已结束' : isExamDay ? '今天考试' : '天',
    progressPercent,
    isExamDay,
    isPast
  }
}

/** 设置页输入校验：返回 { ok, reason }，ok 时带上可直接落盘的值 */
function validateExamInput(examName, examDate, now) {
  const name = typeof examName === 'string' ? examName.trim() : ''
  const dateTimestamp = parseDateKey(examDate)
  const current = Number(now) > 0 ? Number(now) : Date.now()

  if (!name) {
    return { ok: false, reason: '请填写考试名称' }
  }

  if (dateTimestamp <= 0) {
    return { ok: false, reason: '请选择考试日期' }
  }

  if (diffCalendarDays(current, dateTimestamp) < 0) {
    return { ok: false, reason: '考试日期不能早于今天' }
  }

  return {
    ok: true,
    reason: '',
    value: {
      examName: name.slice(0, EXAM_NAME_MAX_LENGTH),
      examDate
    }
  }
}

module.exports = {
  DEFAULT_PREPARE_DAYS,
  EXAM_NAME_MAX_LENGTH,
  buildExamCountdown,
  diffCalendarDays,
  normalizeExam,
  parseDateKey,
  toDateKey,
  validateExamInput
}
