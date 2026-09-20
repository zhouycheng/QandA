/**
 * 学习偏好 / 每日日志 / 图表 / 统计页 / 设置页 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/settings-charts.check.js
 *
 * 覆盖三件容易「看起来对、其实没接上」的事：
 *   1. 偏好开关是否真的改变了答题行为（而不是只存了值）；
 *   2. 每日日志的数据是否能一路走到统计页的图表 SVG；
 *   3. 未开放的选项（发音音色）是否真的不改数据。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const base64Utils = require(path.join(MINIPROGRAM, 'utils/base64.js'))
const preferenceUtils = require(path.join(MINIPROGRAM, 'utils/preferences.js'))
const dailyLogUtils = require(path.join(MINIPROGRAM, 'utils/daily-log.js'))
const insightUtils = require(path.join(MINIPROGRAM, 'utils/study-insight.js'))
const chartSvg = require(path.join(MINIPROGRAM, 'utils/chart-svg.js'))
const { SettingsViewModel, ACCOUNT_ACTIONS } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
const { StatsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/stats-viewmodel.js'))
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function createMemoryStorage(initial) {
  const map = Object.assign({}, initial || {})

  return {
    get(key) {
      return map[key] === undefined ? null : map[key]
    },

    set(key, value) {
      map[key] = value
    },

    remove(key) {
      delete map[key]
    },

    keys() {
      return Object.keys(map)
    },

    raw: map
  }
}

/** 固定本地时间，避免测试受运行机器时区与当前时钟影响 */
function localTime(year, month, day, hour) {
  return new Date(year, month - 1, day, hour || 10, 0, 0, 0).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000
const TODAY = localTime(2026, 9, 19, 16)

// ---------- 一、base64 ----------
function checkBase64() {
  const samples = [
    '<svg></svg>',
    '完成度 62',
    'a',
    'ab',
    'abc',
    '语音·测试✓',
    '🎯 目标'
  ]

  samples.forEach((sample) => {
    const mine = base64Utils.encodeBase64Utf8(sample)
    const node = Buffer.from(sample, 'utf8').toString('base64')

    assert(`base64 - 与 Node Buffer 一致（${sample}）`, mine === node, `${mine} / ${node}`)
  })

  assert('base64 - 空串输出空串', base64Utils.encodeBase64Utf8('') === '')
  assert('base64 - 不含换行', base64Utils.encodeBase64Utf8('完成度'.repeat(50)).indexOf('\n') === -1)
}

// ---------- 二、偏好规范化 ----------
function checkPreferences() {
  const defaults = preferenceUtils.normalizePreferences(null)

  // vibrateOnAnswer 默认必须是 false：vibrateShort 会让整台设备震一下，
  // 答题时被感知成「整个页面在颤抖」，用户无法与「点击动效」区分开。
  assert('偏好 - 空值给全套默认', defaults.autoShowExplanation === true &&
    defaults.autoAddWrongBook === true &&
    defaults.autoNextWhenCorrect === false &&
    defaults.showOverviewEntry === true &&
    defaults.vibrateOnAnswer === false &&
    defaults.fontSize === 'normal' &&
    defaults.voice === 'standard',
    JSON.stringify(defaults))

  const dirty = preferenceUtils.normalizePreferences({
    fontSize: 'huge',
    voice: 'unknown',
    autoShowExplanation: 'yes',
    autoNextWhenCorrect: true
  })

  assert('偏好 - 非法枚举回落默认', dirty.fontSize === 'normal' && dirty.voice === 'standard')
  assert('偏好 - 非布尔值回落默认', dirty.autoShowExplanation === true)
  assert('偏好 - 合法布尔被采纳', dirty.autoNextWhenCorrect === true)

  const usingSwitch = preferenceUtils.setPreferenceSwitch(defaults, 'autoNextWhenCorrect', true)

  assert('偏好 - 开关可改', usingSwitch.autoNextWhenCorrect === true)
  assert('偏好 - 开关拒绝非布尔值',
    preferenceUtils.setPreferenceSwitch(defaults, 'autoNextWhenCorrect', 1).autoNextWhenCorrect === false)

  const choice = preferenceUtils.setPreferenceChoice(defaults, 'fontSize', 'large')

  assert('偏好 - 字号可改', choice.fontSize === 'large')
  assert('偏好 - 字号拒绝非法值',
    preferenceUtils.setPreferenceChoice(defaults, 'fontSize', 'xxl').fontSize === 'normal')

  // 发音音色尚未开放：连存储都不该被写
  const voice = preferenceUtils.setPreferenceChoice(defaults, 'voice', 'gentle')

  assert('偏好 - 未开放的音色不可改', voice.voice === 'standard')

  const view = preferenceUtils.buildPreferenceView({ fontSize: 'large' })
  const fontChoice = view.choices.find((item) => item.key === 'fontSize')
  const voiceChoice = view.choices.find((item) => item.key === 'voice')

  assert('偏好 - 设置视图含 5 个开关', view.switches.length === 5, `实际 ${view.switches.length}`)
  assert('偏好 - 设置视图含 2 个选择项', view.choices.length === 2, `实际 ${view.choices.length}`)
  assert('偏好 - 字号选中态唯一',
    fontChoice.options.filter((option) => option.selected).length === 1)
  assert('偏好 - 音色标记为未开放', voiceChoice.available === false)
}

// ---------- 三、每日日志 ----------
function checkDailyLog() {
  assert('日志 - 空值归一化', Object.keys(dailyLogUtils.normalizeDailyLog(null)).length === 0)

  assert('日志 - 丢弃非法键',
    dailyLogUtils.normalizeDailyLog({ 'not-a-date': { answered: 1 } })['not-a-date'] === undefined)

  let log = null

  log = dailyLogUtils.addDailyResult(log, { answered: 20, correct: 16, seconds: 600 }, TODAY)
  log = dailyLogUtils.addDailyResult(log, { answered: 10, correct: 5, seconds: 300 }, TODAY)
  log = dailyLogUtils.addDailyResult(log, { answered: 8, correct: 8, seconds: 200 }, TODAY - 3 * DAY_MS)
  log = dailyLogUtils.addDailyResult(log, { answered: 12, correct: 6, seconds: 400 }, TODAY - DAY_MS)

  const todayKey = dailyLogUtils.formatDateKey(TODAY)

  assert('日志 - 同一天累加而不是覆盖',
    log[todayKey].answered === 30 && log[todayKey].correct === 21 && log[todayKey].seconds === 900,
    JSON.stringify(log[todayKey]))

  assert('日志 - 答对数不超过答题数',
    dailyLogUtils.addDailyResult(null, { answered: 3, correct: 9 }, TODAY)[todayKey].correct === 3)

  assert('日志 - 全零结果不写库',
    Object.keys(dailyLogUtils.addDailyResult(null, { answered: 0, correct: 0, seconds: 0 }, TODAY)).length === 0)

  const recent = dailyLogUtils.getRecentDays(log, 7, TODAY)

  assert('日志 - 近 7 天刚好 7 个点', recent.length === 7, `实际 ${recent.length}`)
  assert('日志 - 序列按时间正序且末位是今天',
    recent[6].key === todayKey && recent[6].isToday === true, JSON.stringify(recent[6]))
  assert('日志 - 空缺日期补 0 而不是缺项',
    recent[0].answered === 0 && recent[0].key === dailyLogUtils.formatDateKey(TODAY - 6 * DAY_MS))

  assert('日志 - 连续天数（今天+昨天）', dailyLogUtils.calcStreak(log, TODAY) === 2,
    `实际 ${dailyLogUtils.calcStreak(log, TODAY)}`)
  assert('日志 - 今天还没练时从昨天回溯',
    dailyLogUtils.calcStreak(log, TODAY + DAY_MS) === 2,
    `实际 ${dailyLogUtils.calcStreak(log, TODAY + DAY_MS)}`)
  assert('日志 - 活跃天数', dailyLogUtils.countActiveDays(log, 7, TODAY) === 3,
    `实际 ${dailyLogUtils.countActiveDays(log, 7, TODAY)}`)

  const summary = dailyLogUtils.summarizeRecentDays(log, 7, TODAY)

  assert('日志 - 汇总题量', summary.answered === 50, `实际 ${summary.answered}`)
  assert('日志 - 汇总正确率', summary.accuracyText === '70%', summary.accuracyText)
  assert('日志 - 汇总峰值日', summary.peakAnswered === 30, `实际 ${summary.peakAnswered}`)

  // 保留期裁剪：只留最近 3 天
  const pruned = dailyLogUtils.pruneDailyLog(log, TODAY, 3)

  assert('日志 - 裁剪丢弃过期记录',
    Object.keys(pruned).length === 2 && pruned[dailyLogUtils.formatDateKey(TODAY - 3 * DAY_MS)] === undefined,
    Object.keys(pruned).join(','))
}

// ---------- 四、雷达维度与趋势序列 ----------
function checkInsight() {
  const axes = insightUtils.buildRadarAxes({
    progressPercent: 62,
    accuracy: 78,
    masteredCount: 4,
    pendingWrongCount: 6,
    recentAnswered: 50,
    recentActiveDays: 4,
    studyMinutes: 95
  })

  assert('雷达 - 六维', axes.length === 6, `实际 ${axes.length}`)
  assert('雷达 - 完成度等于原始百分比',
    axes[0].value === 62 && axes[0].valueText === '62%', JSON.stringify(axes[0]))
  assert('雷达 - 错题攻克按已攻克/总量',
    axes[2].value === 40 && axes[2].valueText === '4/10', JSON.stringify(axes[2]))
  assert('雷达 - 刷题量按目标 140 归一',
    axes[3].value === 36, JSON.stringify(axes[3]))
  assert('雷达 - 坚持度按 7 天归一',
    axes[4].value === 57, JSON.stringify(axes[4]))

  const overflow = insightUtils.buildRadarAxes({
    progressPercent: 100,
    accuracy: 100,
    masteredCount: 500,
    pendingWrongCount: 0,
    recentAnswered: 9999,
    recentActiveDays: 99,
    studyMinutes: 99999
  })

  assert('雷达 - 上限封顶 100', overflow.every((axis) => axis.value === 100),
    JSON.stringify(overflow.map((axis) => axis.value)))

  const empty = insightUtils.buildRadarAxes(null)

  assert('雷达 - 空数据不报错且全 0', empty.every((axis) => axis.value === 0))
  assert('雷达 - 空数据均分为 0', insightUtils.calcRadarScore(empty) === 0)
  assert('雷达 - 均分取六维平均', insightUtils.calcRadarScore(axes) === 48,
    `实际 ${insightUtils.calcRadarScore(axes)}`)

  const zeroSeries = insightUtils.buildTrendSeries(dailyLogUtils.getRecentDays(null, 7, TODAY))

  assert('趋势 - 纵轴下限为 5，避免空的图看着像有数据',
    zeroSeries.maxValue === 5, `实际 ${zeroSeries.maxValue}`)
  assert('趋势 - 无数据标记', zeroSeries.hasData === false)

  const series = insightUtils.buildTrendSeries(dailyLogUtils.getRecentDays(
    dailyLogUtils.addDailyResult(null, { answered: 12, correct: 9 }, TODAY),
    7,
    TODAY
  ))

  assert('趋势 - 有数据时纵轴跟随峰值', series.maxValue === 12 && series.hasData === true,
    JSON.stringify(series.maxValue))
}

// ---------- 五、图表 SVG ----------
function checkChartSvg() {
  const axes = insightUtils.buildRadarAxes({
    progressPercent: 62, accuracy: 78, masteredCount: 4, pendingWrongCount: 6,
    recentAnswered: 50, recentActiveDays: 4, studyMinutes: 95
  })
  const radar = chartSvg.buildRadarSvg(axes)

  assert('图表 - 雷达图输出合法 SVG',
    radar.indexOf('<svg') === 0 && radar.indexOf('</svg>') === radar.length - 6,
    radar.slice(0, 60))
  assert('图表 - 雷达图含六个维度标签',
    axes.every((axis) => radar.indexOf(axis.label) >= 0))
  assert('图表 - 维度不足 3 个不画雷达', chartSvg.buildRadarSvg(axes.slice(0, 2)) === '')

  const series = insightUtils.buildTrendSeries(dailyLogUtils.getRecentDays(
    dailyLogUtils.addDailyResult(null, { answered: 12, correct: 9 }, TODAY),
    7,
    TODAY
  ))
  const trend = chartSvg.buildTrendSvg(series)

  assert('图表 - 趋势图输出合法 SVG',
    trend.indexOf('<svg') === 0 && trend.indexOf('</svg>') === trend.length - 6)
  assert('图表 - 趋势图含七日标签',
    series.points.every((point) => trend.indexOf(`>${point.label}<`) >= 0))

  const emptyTrend = chartSvg.buildTrendSvg(
    insightUtils.buildTrendSeries(dailyLogUtils.getRecentDays(null, 7, TODAY))
  )

  assert('图表 - 空数据趋势图带说明文案', emptyTrend.indexOf('还没有练习记录') > 0)
  assert('图表 - 点数不足不画趋势图',
    chartSvg.buildTrendSvg(insightUtils.buildTrendSeries([{ isToday: true, answered: 1 }])) === '')

  const ring = chartSvg.buildRingSvg({ percent: 62, size: 240 })

  assert('图表 - 环形图输出合法 SVG',
    ring.indexOf('<svg') === 0 && ring.indexOf('</svg>') === ring.length - 6)
  assert('图表 - 环形图显示百分比', ring.indexOf('62%') > 0)

  const zeroRing = chartSvg.buildRingSvg({ percent: 0 })

  assert('图表 - 0% 不画弧只留轨道', zeroRing.indexOf('stroke-dasharray') === -1)

  const uri = chartSvg.toDataUri(radar)

  assert('图表 - dataURI 前缀正确', uri.indexOf('data:image/svg+xml;base64,') === 0)
  assert('图表 - dataURI 可被还原成原 SVG',
    Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8') === radar)
  assert('图表 - XML 特殊字符被转义',
    chartSvg.escapeXml('a<b&"c') === 'a&lt;b&amp;&quot;c')
}

// ---------- 六、设置页 ViewModel ----------
function checkSettingsViewModel() {
  const storage = createMemoryStorage()
  const vm = new SettingsViewModel({ storage })
  const initial = vm.load()

  assert('设置 - 初始开关非空', initial.data.switches.length === 5)
  assert('设置 - 初始目录统计带题量', initial.data.catalog.questionCount > 0,
    `实际 ${initial.data.catalog.questionCount}`)
  assert('设置 - 账户项均为待接入',
    ACCOUNT_ACTIONS.length === 3 && ACCOUNT_ACTIONS.every((item) => item.available === false))

  vm.toggleSwitch('autoShowExplanation', false)

  const stored = storage.get(preferenceUtils.PREFERENCE_STORAGE_KEY)

  assert('设置 - 开关切换落盘', stored.autoShowExplanation === false, JSON.stringify(stored))

  const afterToggle = vm.toggleSwitch('autoShowExplanation', false)

  assert('设置 - 切换后回传最新视图',
    afterToggle.data.switches.find((item) => item.key === 'autoShowExplanation').value === false)

  assert('设置 - 非法 key 返回空', vm.toggleSwitch('', true) === null)

  const fontSize = vm.selectChoice('fontSize', 'large')

  assert('设置 - 字号选择落盘',
    fontSize.data.choices.find((item) => item.key === 'fontSize').value === 'large')

  const voice = vm.selectChoice('voice', 'gentle')

  assert('设置 - 未开放的音色只提示不改数据',
    !voice.data && voice.command.type === 'toast', JSON.stringify(voice))
  assert('设置 - 音色提示说明原因', voice.command.title.indexOf('题目朗读') > 0, voice.command.title)

  const reset = vm.resetPreferences()

  assert('设置 - 恢复默认把字号还原',
    reset.data.choices.find((item) => item.key === 'fontSize').value === 'normal')
  assert('设置 - 恢复默认带提示', reset.command.type === 'toast')

  const password = vm.openAccountAction('password')

  assert('设置 - 账户项给出说明而非静默',
    password.command.type === 'toast' && password.command.title.indexOf('账号体系') >= 0,
    JSON.stringify(password))
  assert('设置 - 未知账户项返回空', vm.openAccountAction('unknown') === null)
}

// ---------- 七、统计页 ViewModel ----------
function seedPractice(storage, options) {
  const config = options || {}
  const vm = new PracticeViewModel({ storage })

  vm.load({ subjectId: config.subjectId || 'subject-chinese', bankId: config.bankId || 'chinese-ch001', mode: 'order' })

  // 自动化跑得比人快，真实用时会接近 0 秒；把时钟往前拨，
  // 模拟一次「做了若干题」的练习，否则时长与每日日志都不会落盘
  vm.session.accumulatedMs = (config.seconds || 180) * 1000
  vm.session.startedAt = Date.now()

  const questions = vm.session.state.questions
  const wrongFirstN = config.wrongFirstN || 0

  questions.forEach((question, index) => {
    const correctIndex = question.options.findIndex((option) => question.answerKeys.indexOf(option.key) >= 0)
    const wrongIndex = question.options.findIndex((option) => question.answerKeys.indexOf(option.key) < 0)
    const target = index < wrongFirstN && wrongIndex >= 0 ? wrongIndex : correctIndex

    vm.selectOption(target)
    vm.goNext()
  })

  return vm
}

function checkStatsViewModel() {
  const freshStorage = createMemoryStorage()
  const fresh = new StatsViewModel({ storage: freshStorage }).load().data

  assert('统计 - 全新用户雷达不出图', fresh.radar.hasData === false && fresh.radar.dataUri === '')
  assert('统计 - 全新用户趋势不出图', fresh.trend.hasData === false)
  assert('统计 - 全新用户环形图仍可用', fresh.hero.ringDataUri.indexOf('data:image/svg+xml') === 0)
  assert('统计 - 全新用户标题给引导语',
    fresh.hero.headline.indexOf('第一次练习') > 0, fresh.hero.headline)

  const storage = createMemoryStorage()
  const practiceVm = seedPractice(storage, { wrongFirstN: 4 })
  const practiceData = practiceVm.session.getViewData()
  const correctCount = practiceData.correctCount

  const stats = new StatsViewModel({ storage }).load().data

  assert('统计 - 已做题目数与交卷一致',
    stats.overall.answered === practiceData.total, `${stats.overall.answered} / ${practiceData.total}`)
  assert('统计 - 正确率与交卷一致',
    stats.overall.accuracy === Math.round((correctCount / practiceData.total) * 100),
    `${stats.overall.accuracy} vs ${correctCount}/${practiceData.total}`)
  assert('统计 - 错题数与答错题数一致', stats.wrongCount === 4, `实际 ${stats.wrongCount}`)
  assert('统计 - 雷达出图且有综合分',
    stats.radar.hasData === true && stats.radar.dataUri.indexOf('data:image/svg+xml') === 0)
  assert('统计 - 雷达长短项存在',
    !!stats.radar.strongest && !!stats.radar.weakest &&
    stats.radar.strongest.value >= stats.radar.weakest.value)
  assert('统计 - 趋势图出图', stats.trend.dataUri.indexOf('data:image/svg+xml') === 0)
  assert('统计 - 趋势今天有答题数', stats.trend.points[6].answered === practiceData.total,
    JSON.stringify(stats.trend.points[6]))
  assert('统计 - 每日汇总与趋势一致',
    stats.daily.answered === stats.trend.points.reduce((sum, point) => sum + point.answered, 0))
  assert('统计 - 连续天数至少 1', stats.daily.streak >= 1, `实际 ${stats.daily.streak}`)
  assert('统计 - 科目进度按主题色', stats.subjectStats.every((item) => !!item.theme))
  assert('统计 - 科目正确率分级有效',
    stats.subjectStats.every((item) => ['good', 'mid', 'low', 'none'].indexOf(item.accuracyLevel) >= 0))
  assert('统计 - 学习时长已结算', stats.studyTimeText !== '尚未开始', stats.studyTimeText)
}

// ---------- 八、偏好是否真的改变了答题行为 ----------
function checkPreferenceEffects() {
  // 1) 关闭「答题后自动显示解析」
  const noExplanation = createMemoryStorage({
    [preferenceUtils.PREFERENCE_STORAGE_KEY]: preferenceUtils.normalizePreferences({ autoShowExplanation: false })
  })
  const vm1 = new PracticeViewModel({ storage: noExplanation })

  vm1.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const question1 = vm1.session.state.questions[0]
  const correctIndex1 = question1.options.findIndex((option) => question1.answerKeys.indexOf(option.key) >= 0)

  vm1.selectOption(correctIndex1)

  assert('偏好 - 关闭解析后仍标记对错', vm1.session.state.shouldRevealAnswer === true)
  assert('偏好 - 关闭解析后不展开解析', vm1.session.state.shouldShowExplanation === false)
  assert('偏好 - 关闭解析仍给出正确答案', !!vm1.session.state.currentCorrectAnswerText)

  // 默认开启时应当展开
  const defaultStorage = createMemoryStorage()
  const vm2 = new PracticeViewModel({ storage: defaultStorage })

  vm2.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const question2 = vm2.session.state.questions[0]
  const correctIndex2 = question2.options.findIndex((option) => question2.answerKeys.indexOf(option.key) >= 0)

  vm2.selectOption(correctIndex2)

  assert('偏好 - 默认展开解析', vm2.session.state.shouldShowExplanation === true)

  // 2) 关闭「答错自动加入错题本」
  const noWrongBook = createMemoryStorage({
    [preferenceUtils.PREFERENCE_STORAGE_KEY]: preferenceUtils.normalizePreferences({ autoAddWrongBook: false })
  })
  const vm3 = new PracticeViewModel({ storage: noWrongBook })

  vm3.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const questions3 = vm3.session.state.questions

  questions3.forEach((question) => {
    const wrongIndex = question.options.findIndex((option) => question.answerKeys.indexOf(option.key) < 0)
    vm3.selectOption(wrongIndex)
    vm3.goNext()
  })

  assert('偏好 - 关闭后错题本为空',
    Object.keys(noWrongBook.get('qandaWrongBook') || {}).length === 0,
    JSON.stringify(noWrongBook.get('qandaWrongBook')))
  const progressAfter = noWrongBook.get('qandaProgress') || {}

  assert('偏好 - 关闭错题本不影响做题进度',
    !!progressAfter['chinese-ch001'] &&
    Object.keys(progressAfter['chinese-ch001'].answers).length === questions3.length,
    JSON.stringify(progressAfter))

  // 3) 打开「答对自动进入下一题」
  const autoNext = createMemoryStorage({
    [preferenceUtils.PREFERENCE_STORAGE_KEY]: preferenceUtils.normalizePreferences({ autoNextWhenCorrect: true })
  })
  const vm4 = new PracticeViewModel({ storage: autoNext })

  vm4.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const questions4 = vm4.session.state.questions
  const first4 = questions4[0]
  const correctIndex4 = first4.options.findIndex((option) => first4.answerKeys.indexOf(option.key) >= 0)
  const singleChoice = !first4.isMultiple

  const result4 = vm4.selectOption(correctIndex4)

  assert('偏好 - 答对单选出自动翻页标记',
    singleChoice ? result4.autoAdvance === true : result4.autoAdvance === undefined,
    `${first4.typeText} autoAdvance=${result4.autoAdvance}`)

  // 答错不应自动翻页。注意 autoAdvance 只是「标记」，真正翻页由页面做，
  // 所以这里必须手动 goNext 到下一题再作答
  vm4.goNext()

  const wrongQuestion = vm4.session.state.questions[vm4.session.state.currentIndex]
  const wrongIndex4 = wrongQuestion.options.findIndex(
    (option) => wrongQuestion.answerKeys.indexOf(option.key) < 0
  )
  const resultWrong = vm4.selectOption(wrongIndex4)

  assert('偏好 - 答错不自动翻页', !!resultWrong && resultWrong.autoAdvance === undefined,
    JSON.stringify(resultWrong && resultWrong.autoAdvance))

  // 默认关闭时答对也不翻页
  const vm5 = new PracticeViewModel({ storage: createMemoryStorage() })

  vm5.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const question5 = vm5.session.state.questions[0]
  const correctIndex5 = question5.options.findIndex((option) => question5.answerKeys.indexOf(option.key) >= 0)
  const result5 = vm5.selectOption(correctIndex5)

  assert('偏好 - 默认不自动翻页', result5.autoAdvance === undefined)

  // 4) 偏好随会话下发到页面
  const viewData = vm5.session.getViewData()

  assert('偏好 - 会话视图带偏好对象',
    !!viewData.preferences && viewData.preferences.fontSize === 'normal',
    JSON.stringify(viewData.preferences))
  assert('偏好 - 初始视图数据自带默认偏好',
    !!PracticeViewModel.getInitialData().preferences)
}

// ---------- 输出 ----------
checkBase64()
checkPreferences()
checkDailyLog()
checkInsight()
checkChartSvg()
checkSettingsViewModel()
checkStatsViewModel()
checkPreferenceEffects()

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  if (!item.passed) {
    console.log(`FAIL  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
  }
})

console.log('')

if (failed.length) {
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)
  process.exitCode = 1
} else {
  console.log(`总计 ${results.length} 项，通过 ${results.length} 项，失败 0 项`)
}
