/**
 * 用户学习偏好：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaPreferences）：平铺的键值对，便于增量合并与向后兼容。
 * 新增字段时只要在 DEFAULT_PREFERENCES 里补默认值，
 * normalizePreferences 会把老数据补齐，不需要写迁移脚本。
 */

const PREFERENCE_STORAGE_KEY = 'qandaPreferences'

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'normal', label: '标准' },
  { value: 'large', label: '大' }
]

/**
 * 发音音色：题库当前没有音频内容，先把选项与存储位留好，
 * 接入音频后只需在答题页读取取值，界面不用再改。
 */
const VOICE_OPTIONS = [
  { value: 'standard', label: '标准女声' },
  { value: 'gentle', label: '温柔女声' },
  { value: 'steady', label: '沉稳男声' }
]

const DEFAULT_PREFERENCES = {
  // 答题后是否直接展开解析：关闭后只看对错与正确答案，解析留到回顾页
  autoShowExplanation: true,
  // 答错是否自动进错题本
  autoAddWrongBook: true,
  // 答对是否自动翻到下一题（仅单选、仅练习模式）
  autoNextWhenCorrect: false,
  // 答题页顶部是否显示答题卡入口
  showOverviewEntry: true,
  // 作答时是否轻微震动。**默认关闭**：vibrateShort 会让整台设备震一下，
  // 答题时被感知成「整个页面在颤抖」，且只有点选项会触发（其它按钮没有），
  // 用户很难把它和「点击动效」区分开。想开的人可在「我的 · 学习偏好」里打开。
  vibrateOnAnswer: false,
  fontSize: 'normal',
  voice: 'standard'
}

/** 布尔型偏好，设置页按这个列表渲染开关，新增一项只需加一行 */
const PREFERENCE_SWITCHES = [
  {
    key: 'autoShowExplanation',
    label: '答题后自动显示解析',
    description: '关闭后只标记对错与正确答案，解析留到交卷回顾'
  },
  {
    key: 'autoAddWrongBook',
    label: '答错自动加入错题本',
    description: '关闭后错题需手动收藏，错题本不再自动收集'
  },
  {
    key: 'autoNextWhenCorrect',
    label: '答对后自动进入下一题',
    description: '单选题答对后约 0.8 秒自动翻页，多选与测试模式不受影响'
  },
  {
    key: 'showOverviewEntry',
    label: '显示答题卡入口',
    description: '答题页顶部显示题号胶囊，可随时跳题'
  },
  {
    key: 'vibrateOnAnswer',
    label: '答题震动反馈',
    description: '作答时轻微震动，部分机型或系统设置下不生效'
  }
]

/** 选择型偏好 */
const PREFERENCE_CHOICES = [
  {
    key: 'fontSize',
    label: '题目字号',
    description: '影响题干、选项与解析的字号',
    options: FONT_SIZE_OPTIONS,
    available: true
  },
  {
    key: 'voice',
    label: '发音音色',
    description: '朗读题目与选项的音色，接入音频后生效',
    options: VOICE_OPTIONS,
    available: false
  }
]

function cloneDefaultPreferences() {
  return Object.assign({}, DEFAULT_PREFERENCES)
}

function isBoolean(value) {
  return typeof value === 'boolean'
}

function pickOptionValue(options, value, fallback) {
  const matched = (options || []).find((option) => option.value === value)

  return matched ? matched.value : fallback
}

/**
 * 规范化偏好：非法值一律回落到默认值，
 * 保证页面拿到的永远是一份完整可用的配置。
 */
function normalizePreferences(rawPreferences) {
  const raw = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {}
  const next = cloneDefaultPreferences()

  Object.keys(DEFAULT_PREFERENCES).forEach((key) => {
    const value = raw[key]

    if (key === 'fontSize') {
      next[key] = pickOptionValue(FONT_SIZE_OPTIONS, value, DEFAULT_PREFERENCES[key])
      return
    }

    if (key === 'voice') {
      next[key] = pickOptionValue(VOICE_OPTIONS, value, DEFAULT_PREFERENCES[key])
      return
    }

    if (isBoolean(DEFAULT_PREFERENCES[key])) {
      next[key] = isBoolean(value) ? value : DEFAULT_PREFERENCES[key]
    }
  })

  return next
}

/** 开关型偏好的更新：只接受布尔值 */
function setPreferenceSwitch(preferences, key, value) {
  const current = normalizePreferences(preferences)

  if (!isBoolean(value) || !isBoolean(current[key])) {
    return current
  }

  current[key] = value

  return current
}

/** 选择型偏好的更新：只接受选项内已有的值 */
function setPreferenceChoice(preferences, key, value) {
  const current = normalizePreferences(preferences)
  const definition = PREFERENCE_CHOICES.find((item) => item.key === key)

  if (!definition || !definition.available) {
    return current
  }

  current[key] = pickOptionValue(definition.options, value, current[key])

  return current
}

/**
 * 构造设置页需要渲染的分组。
 * 把「有哪些开关 / 有哪些选项」收敛在一处，
 * 新增偏好只需改这个文件，页面模板不用动。
 */
function buildPreferenceView(preferences) {
  const current = normalizePreferences(preferences)

  return {
    switches: PREFERENCE_SWITCHES.map((item) => Object.assign({}, item, {
      value: !!current[item.key]
    })),
    choices: PREFERENCE_CHOICES.map((item) => Object.assign({}, item, {
      value: current[item.key],
      options: item.options.map((option) => Object.assign({}, option, {
        selected: option.value === current[item.key]
      }))
    }))
  }
}

module.exports = {
  DEFAULT_PREFERENCES,
  FONT_SIZE_OPTIONS,
  PREFERENCE_CHOICES,
  PREFERENCE_STORAGE_KEY,
  PREFERENCE_SWITCHES,
  VOICE_OPTIONS,
  buildPreferenceView,
  cloneDefaultPreferences,
  normalizePreferences,
  setPreferenceChoice,
  setPreferenceSwitch
}
