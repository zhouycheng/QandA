/**
 * 邮箱提醒设置：纯计算模块，不依赖微信 API，可在 Node 中直接测试。
 *
 * 设计稿 Figma 781:2043。存储结构（qandaReminder）与偏好一样平铺，
 * 新增字段只要在 DEFAULT_REMINDER 里补默认值，normalizeReminder 会自动补齐老数据。
 *
 * 注意：**这里只负责「用户想收到什么提醒」，不负责真的发信**。
 * 真正发信要后端定时任务 + 邮箱服务，端上只把设置存下来；
 * 后端没接入时页面照常可配（与登录降级同一套思路），不会假装发出去了。
 */

const REMINDER_STORAGE_KEY = 'qandaReminder'

const EXAM_NAME_MAX_LENGTH = 20
const MAX_EXAMS = 10

/** 重复频率：与设计稿 picker 对应 */
const FREQUENCY_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekday', label: '工作日' },
  { value: 'weekly', label: '每周' }
]

/** 提前提醒天数：设计稿的 7天前 / 3天前 / 当天 */
const ADVANCE_OPTIONS = [
  { value: 7, label: '7天前' },
  { value: 3, label: '3天前' },
  { value: 0, label: '当天' }
]

const DEFAULT_REMINDER = {
  enabled: true,
  reviewEnabled: true,
  reviewTime: '20:00',
  frequency: 'daily',
  examEnabled: true,
  // 设计稿默认勾选 7天前 与 当天，3天前 不勾
  advanceDays: [7, 0],
  exams: []
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

function isBoolean(value) {
  return typeof value === 'boolean'
}

function pickOptionValue(options, value, fallback) {
  const matched = (options || []).find((option) => option.value === value)

  return matched ? matched.value : fallback
}

/** 'HH:MM'，24 小时制。非法值一律回落默认，避免存进 '25:99' 这种值 */
function normalizeTime(value, fallback) {
  if (typeof value !== 'string') {
    return fallback
  }

  const matched = value.match(/^(\d{1,2}):(\d{1,2})$/)

  if (!matched) {
    return fallback
  }

  const hour = Number(matched[1])
  const minute = Number(matched[2])

  if (hour > 23 || minute > 59) {
    return fallback
  }

  return `${pad2(hour)}:${pad2(minute)}`
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（设计稿里日期是斜杠写法） */
function toSlashDate(dateKey) {
  return typeof dateKey === 'string' ? dateKey.replace(/-/g, '/') : ''
}

/** 天数差：用本地日历天，不用毫秒差，否则「今天」会被算成 0.98 天 */
function daysBetween(fromTimestamp, toTimestamp) {
  const from = new Date(Number(fromTimestamp) || 0)
  const to = new Date(Number(toTimestamp) || 0)
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()

  return Math.round((toDay - fromDay) / 86400000)
}

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

  const timestamp = new Date(year, month - 1, day).getTime()

  return Number.isFinite(timestamp) ? timestamp : 0
}

/** 单条考试记录：名称截断、日期必须能解析，脏数据整条丢弃 */
function normalizeExamItem(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, EXAM_NAME_MAX_LENGTH) : ''
  const date = typeof source.date === 'string' ? source.date : ''

  if (!name || parseDateKey(date) <= 0) {
    return null
  }

  return {
    id: typeof source.id === 'string' && source.id ? source.id : '',
    name,
    date
  }
}

function normalizeExams(raw) {
  const list = Array.isArray(raw) ? raw : []
  const seen = {}

  return list
    .map(normalizeExamItem)
    .filter((item) => {
      if (!item || seen[item.id || `${item.name}@${item.date}`]) {
        return false
      }

      seen[item.id || `${item.name}@${item.date}`] = true

      return true
    })
    .slice(0, MAX_EXAMS)
}

function normalizeAdvanceDays(raw) {
  const list = Array.isArray(raw) ? raw : DEFAULT_REMINDER.advanceDays
  const allowed = ADVANCE_OPTIONS.map((option) => option.value)
  const picked = list.filter((value, index) => allowed.indexOf(value) >= 0 && list.indexOf(value) === index)

  // 一个都不勾等于「考试提醒开着但永远不提前通知」，按默认补回来
  return picked.length ? picked : DEFAULT_REMINDER.advanceDays.slice()
}

function normalizeReminder(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const next = {
    enabled: isBoolean(source.enabled) ? source.enabled : DEFAULT_REMINDER.enabled,
    reviewEnabled: isBoolean(source.reviewEnabled) ? source.reviewEnabled : DEFAULT_REMINDER.reviewEnabled,
    reviewTime: normalizeTime(source.reviewTime, DEFAULT_REMINDER.reviewTime),
    frequency: pickOptionValue(FREQUENCY_OPTIONS, source.frequency, DEFAULT_REMINDER.frequency),
    examEnabled: isBoolean(source.examEnabled) ? source.examEnabled : DEFAULT_REMINDER.examEnabled,
    advanceDays: normalizeAdvanceDays(source.advanceDays),
    exams: normalizeExams(source.exams)
  }

  return next
}

/** 开关白名单：只有这三个是布尔开关，传别的键不改数据 */
const REMINDER_SWITCH_KEYS = ['enabled', 'reviewEnabled', 'examEnabled']

function setReminderSwitch(reminder, key, value) {
  const current = normalizeReminder(reminder)

  if (REMINDER_SWITCH_KEYS.indexOf(key) < 0 || !isBoolean(value)) {
    return current
  }

  current[key] = value

  return current
}

function setReminderTime(reminder, time) {
  const current = normalizeReminder(reminder)
  const next = normalizeTime(time, '')

  if (next) {
    current.reviewTime = next
  }

  return current
}

function setReminderFrequency(reminder, value) {
  const current = normalizeReminder(reminder)
  const matched = FREQUENCY_OPTIONS.find((option) => option.value === value)

  if (matched) {
    current.frequency = matched.value
  }

  return current
}

/** 提前提醒是多选：点一下勾上，再点一下取消，至少要留一个 */
function toggleAdvanceDay(reminder, day) {
  const current = normalizeReminder(reminder)
  const value = Number(day)
  const exists = current.advanceDays.indexOf(value) >= 0

  if (exists) {
    if (current.advanceDays.length <= 1) {
      return current
    }

    current.advanceDays = current.advanceDays.filter((item) => item !== value)

    return current
  }

  if (ADVANCE_OPTIONS.some((option) => option.value === value)) {
    current.advanceDays = current.advanceDays.concat(value).sort((left, right) => right - left)
  }

  return current
}

/**
 * 添加考试。
 * 允许过去的日期：设计稿里「已结束」就是要展示状态，直接拒绝反而解释不通。
 */
function validateExamInput(name, date) {
  const examName = typeof name === 'string' ? name.trim() : ''

  if (!examName) {
    return { ok: false, reason: '请填写考试名称' }
  }

  if (parseDateKey(date) <= 0) {
    return { ok: false, reason: '请选择考试日期' }
  }

  return {
    ok: true,
    value: {
      name: examName.slice(0, EXAM_NAME_MAX_LENGTH),
      date
    }
  }
}

function buildExamId(seed) {
  const stamp = (Number(seed) > 0 ? Number(seed) : Date.now()).toString(36)

  return `ex_${stamp}${Math.floor(Math.random() * 1e6).toString(36)}`
}

function addExam(reminder, payload, now) {
  const current = normalizeReminder(reminder)
  const input = payload || {}
  const check = validateExamInput(input.name, input.date)

  if (!check.ok) {
    return { ok: false, reason: check.reason, reminder: current }
  }

  if (current.exams.length >= MAX_EXAMS) {
    return { ok: false, reason: `最多添加 ${MAX_EXAMS} 个考试`, reminder: current }
  }

  const duplicated = current.exams.some(
    (item) => item.name === check.value.name && item.date === check.value.date
  )

  if (duplicated) {
    return { ok: false, reason: '这个考试已经添加过了', reminder: current }
  }

  current.exams = current.exams.concat({
    id: buildExamId(now),
    name: check.value.name,
    date: check.value.date
  })

  // 按日期升序：最近要考的排在前面，用户一眼看到下一个考试
  current.exams.sort((left, right) => parseDateKey(left.date) - parseDateKey(right.date))

  return { ok: true, reminder: current, exam: current.exams.find((item) => item.name === check.value.name && item.date === check.value.date) }
}

function removeExam(reminder, id) {
  const current = normalizeReminder(reminder)

  if (!id) {
    return current
  }

  current.exams = current.exams.filter((item) => item.id !== id)

  return current
}

/** 单条考试的状态文案：已结束 / 今天 / N天后 */
function buildExamStatus(dateKey, now) {
  const timestamp = parseDateKey(dateKey)

  if (timestamp <= 0) {
    return { text: '', tone: 'past' }
  }

  const days = daysBetween(Number(now) > 0 ? Number(now) : Date.now(), timestamp)

  if (days < 0) {
    return { text: '已结束', tone: 'past' }
  }

  if (days === 0) {
    return { text: '今天', tone: 'today' }
  }

  return { text: `${days}天后`, tone: 'upcoming' }
}

/**
 * 页面视图。
 * 右侧摘要（每天 / 20:00 / 已开启）也从这里出，
 * 避免「我的」页和提醒页各写一份格式化逻辑。
 */
function buildReminderView(reminder, options) {
  const current = normalizeReminder(reminder)
  const settings = options || {}
  const now = Number(settings.now) > 0 ? Number(settings.now) : Date.now()
  const frequency = FREQUENCY_OPTIONS.find((option) => option.value === current.frequency)

  return {
    enabled: current.enabled,
    reviewEnabled: current.reviewEnabled,
    examEnabled: current.examEnabled,
    reviewTime: current.reviewTime,
    frequency: current.frequency,
    frequencyLabel: frequency ? frequency.label : '',
    // picker 需要「文案数组 + 当前下标」，映射放这里，页面不用再认一遍选项表
    frequencyOptions: FREQUENCY_OPTIONS.map((option) => option.label),
    frequencyIndex: Math.max(0, FREQUENCY_OPTIONS.findIndex((option) => option.value === current.frequency)),
    summaryLabel: current.enabled ? '已开启' : '已关闭',
    emailMasked: settings.emailMasked || '',
    exams: current.exams.map((item) => {
      const status = buildExamStatus(item.date, now)

      return {
        id: item.id,
        name: item.name,
        date: item.date,
        dateText: toSlashDate(item.date),
        statusText: status.text,
        statusTone: status.tone
      }
    }),
    examCount: current.exams.length,
    advanceOptions: ADVANCE_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      checked: current.advanceDays.indexOf(option.value) >= 0
    }))
  }
}

module.exports = {
  ADVANCE_OPTIONS,
  DEFAULT_REMINDER,
  EXAM_NAME_MAX_LENGTH,
  FREQUENCY_OPTIONS,
  MAX_EXAMS,
  REMINDER_STORAGE_KEY,
  REMINDER_SWITCH_KEYS,
  addExam,
  buildExamStatus,
  buildReminderView,
  normalizeExamItem,
  normalizeReminder,
  normalizeTime,
  removeExam,
  setReminderFrequency,
  setReminderSwitch,
  setReminderTime,
  toggleAdvanceDay,
  toSlashDate,
  validateExamInput
}
