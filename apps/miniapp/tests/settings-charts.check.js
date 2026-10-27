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
const chartSvg = require(path.join(MINIPROGRAM, 'utils/chart-svg.js'))
const { SettingsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
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
  assert('偏好 - 设置视图含 3 个选择项（字号 / 布局 / 音色）',
    view.choices.length === 3, `实际 ${view.choices.length}`)
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

// ---------- 四、图表 SVG ----------
function checkChartSvg() {
  const points = [
    { value: 2, label: '周一' },
    { value: 5, label: '周二' },
    { value: 1, label: '周三' }
  ]
  const trend = chartSvg.buildAreaTrendSvg(points)

  assert('图表 - 趋势图输出合法 SVG',
    trend.indexOf('<svg') === 0 && trend.indexOf('</svg>') === trend.length - 6)
  assert('图表 - 趋势图显示日期标签',
    points.every((point) => trend.indexOf(point.label) >= 0))
  assert('图表 - 趋势图少于两点不出图',
    chartSvg.buildAreaTrendSvg([]) === '' && chartSvg.buildAreaTrendSvg([{ value: 3 }]) === '')

  const uri = chartSvg.toDataUri(trend)

  assert('图表 - dataURI 前缀正确', uri.indexOf('data:image/svg+xml;base64,') === 0)
  assert('图表 - dataURI 可还原为原 SVG',
    Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8') === trend)
  assert('图表 - XML 特殊字符被转义',
    chartSvg.escapeXml('a<b&"c') === 'a&lt;b&amp;&quot;c')

  const heat = chartSvg.buildHeatmapSvg({
    columns: [[{ level: 0 }, { level: 4 }, null, null, null, null, null]],
    months: [{ col: 0, text: '10月' }]
  })

  assert('图表 - 热力图输出 SVG 且带月份标签',
    heat.indexOf('<svg') === 0 && heat.indexOf('10月') > 0)
  assert('图表 - 热力图忽略未来空格子',
    (heat.match(/<rect /g) || []).length === 2)
  assert('图表 - 空热力图不出图', chartSvg.buildHeatmapSvg({ columns: [] }) === '')
}

// ---------- 五、设置页 ViewModel ----------
function checkSettingsViewModel() {
  const storage = createMemoryStorage()
  const vm = new SettingsViewModel({ storage })
  const initial = vm.load()

  assert('设置 - 初始开关非空', initial.data.switches.length === 5)
  assert('设置 - 初始目录统计带题量', initial.data.catalog.questionCount > 0,
    `实际 ${initial.data.catalog.questionCount}`)
  // 改版后账户分组迁到「我的 → 账号管理」（设计稿 781:2123），设置页不该再有第二份账号状态
  assert('设置 - 账户分组已迁出',
    initial.data.accountActions === undefined && initial.data.auth === undefined,
    JSON.stringify(Object.keys(initial.data)))

  // 「自定义布局」是新增的可用选项（设计稿「我的 · 学习设置」的第二行）
  const layout = initial.data.choices.find((item) => item.key === 'answerLayout')

  assert('设置 - 自定义布局可选项齐全',
    !!layout && layout.available === true &&
      layout.options.map((option) => option.value).join(',') === 'below,above',
    JSON.stringify(layout))

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

  // 危险操作收到设置页底部：账号页只管身份资料，清数据仍归「设置」
  const cleared = vm.clearRecords()

  assert('设置 - 清空学习数据带提示', cleared.command.type === 'toast', JSON.stringify(cleared.command))
  assert('设置 - 清空学习数据不影响偏好视图',
    Array.isArray(cleared.data.choices) && cleared.data.choices.length > 0)
}

// ---------- 六、统计页 ViewModel ----------
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

  // 复盘页：区间切换 + 三个数字 + 热力图 + 趋势
  assert('复盘 - 默认区间是近 7 天', fresh.range === '7d', fresh.range)
  assert('复盘 - 三个区间齐全',
    fresh.rangeOptions.map((item) => item.value).join(',') === '7d,30d,all',
    fresh.rangeOptions.map((item) => item.value).join(','))
  assert('复盘 - 全新用户三个数字都是 0',
    fresh.metrics.answered === '0' && fresh.metrics.accuracy === '0' && fresh.metrics.duration === '0',
    JSON.stringify(fresh.metrics))
  assert('复盘 - 全新用户趋势不出图', fresh.trend.hasData === false && fresh.trend.dataUri === '')
  // 热力图即使没有记录也要画：一屏灰格子本身就是「还没开始」的信息
  assert('复盘 - 全新用户热力图仍然出图',
    fresh.activity.dataUri.indexOf('data:image/svg+xml') === 0 && fresh.activity.hasData === false)
  assert('复盘 - 未登录时身份行有兜底文案',
    fresh.identity.subtitle.length > 0, fresh.identity.subtitle)

  const storage = createMemoryStorage()
  const practiceVm = seedPractice(storage, { wrongFirstN: 4 })
  const practiceData = practiceVm.session.getViewData()
  const correctCount = practiceData.correctCount

  const stats = new StatsViewModel({ storage }).load().data

  assert('复盘 - 总览口径与交卷一致',
    stats.overall.answered === practiceData.total, `${stats.overall.answered} / ${practiceData.total}`)
  assert('复盘 - 正确率与交卷一致',
    stats.overall.accuracy === Math.round((correctCount / practiceData.total) * 100),
    `${stats.overall.accuracy} vs ${correctCount}/${practiceData.total}`)
  assert('复盘 - 错题数与答错题数一致', stats.wrongCount === 4, `实际 ${stats.wrongCount}`)

  // 错题本 / 收藏本两张入口卡：点进去是两个独立页面
  assert('复盘 - 入口卡齐全',
    stats.entries.wrong.title === '错题本' && stats.entries.favorite.title === '收藏本',
    JSON.stringify(stats.entries))
  assert('复盘 - 入口卡带 type 参数',
    stats.entries.wrong.url.indexOf('type=wrong') > 0 &&
    stats.entries.favorite.url.indexOf('type=favorite') > 0,
    JSON.stringify({ wrong: stats.entries.wrong.url, favorite: stats.entries.favorite.url }))
  assert('复盘 - 错题卡数字取待复习错题数',
    stats.entries.wrong.value === '4', stats.entries.wrong.value)
  assert('复盘 - 错题卡摘要是「近 7 天更新」而不是「新增」',
    stats.entries.wrong.caption.indexOf('近 7 天更新') === 0, stats.entries.wrong.caption)
  assert('复盘 - 没收藏时收藏卡给空态摘要',
    stats.entries.favorite.value === '0' && stats.entries.favorite.caption === '还没有收藏',
    JSON.stringify(stats.entries.favorite))
  assert('复盘 - 全新用户两个入口卡都是 0',
    fresh.entries.wrong.value === '0' && fresh.entries.favorite.value === '0',
    JSON.stringify(fresh.entries))
  assert('复盘 - 近 7 天答题量等于本次练习题量',
    stats.metrics.answered === `${practiceData.total}`,
    `${stats.metrics.answered} vs ${practiceData.total}`)
  assert('复盘 - 近 7 天正确率等于本次正确率',
    stats.metrics.accuracy === `${Math.round((correctCount / practiceData.total) * 100)}`,
    stats.metrics.accuracy)
  assert('复盘 - 学习时长已结算（分钟数 > 0）',
    Number(stats.metrics.duration) > 0, `实际 ${stats.metrics.duration} 分`)
  assert('复盘 - 趋势图出图', stats.trend.dataUri.indexOf('data:image/svg+xml') === 0)
  assert('复盘 - 热力图标记为有数据', stats.activity.hasData === true)

  // 区间切换：同一份存储，30 天与累计都应当不小于 7 天
  const vm = new StatsViewModel({ storage })

  vm.load()
  const thirty = vm.setRange('30d')
  const all = vm.setRange('all')

  assert('复盘 - 切到近 30 天返回新数据', !!thirty && thirty.data.range === '30d')
  assert('复盘 - 30 天答题量不少于 7 天',
    Number(thirty.data.metrics.answered) >= Number(new StatsViewModel({ storage }).load().data.metrics.answered),
    `${thirty.data.metrics.answered} vs 7 天`)
  assert('复盘 - 切到累计返回新数据', !!all && all.data.range === 'all')
  assert('复盘 - 累计答题量取全量而非日志',
    all.data.metrics.answered === `${stats.overall.answered}`,
    `${all.data.metrics.answered} vs ${stats.overall.answered}`)
  assert('复盘 - 重复点同一个区间不重算', vm.setRange('all') === null)

  // 切换区间不应该动热力图与身份（只重算数字与趋势）
  assert('复盘 - 切区间不返回热力图字段',
    thirty.data.activity === undefined && thirty.data.identity === undefined)

  // 图表：空数据 / 单点不出图，两列以上才画
  assert('图表 - 趋势图少于两点不出图',
    chartSvg.buildAreaTrendSvg([]) === '' && chartSvg.buildAreaTrendSvg([{ value: 3 }]) === '')
  assert('图表 - 趋势图有渐变面积与平滑曲线',
    /url\(#areaFill\)/.test(chartSvg.buildAreaTrendSvg([{ value: 1 }, { value: 4 }, { value: 2 }])) &&
    / C /.test(chartSvg.buildAreaTrendSvg([{ value: 1 }, { value: 4 }, { value: 2 }])))
  assert('图表 - 热力图列数为 0 时不出图', chartSvg.buildHeatmapSvg({ columns: [] }) === '')

  const heat = chartSvg.buildHeatmapSvg({
    columns: [[{ level: 0 }, { level: 4 }, null, null, null, null, null]],
    months: [{ col: 0, text: '10月' }]
  })

  assert('图表 - 热力图有空格子就不画（未来的日子）',
    (heat.match(/<rect /g) || []).length === 2, `实际 ${(heat.match(/<rect /g) || []).length} 个`)
  assert('图表 - 热力图带月份标签', heat.indexOf('10月') > 0)
}


// ---------- 七、偏好是否真的改变了答题行为 ----------
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
