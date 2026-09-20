/**
 * 首页学习数据 / 学习时长 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/home-dashboard.check.js
 *
 * 小程序运行在微信沙箱内，纯计算层（utils / models / viewmodels / repositories）
 * 可以直接在 Node 中 require 验证，避免每次改动都要在开发者工具里点一遍。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const studyTimeUtils = require(path.join(MINIPROGRAM, 'utils/study-time.js'))
const homeContent = require(path.join(MINIPROGRAM, 'utils/home-content.js'))
const { SubjectListViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/subject-list-viewmodel.js'))
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

/** 固定本地时间的毫秒值，避免测试受运行机器时区/时钟影响 */
function localTime(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

// ---------- 一、学习时长的纯计算 ----------
function checkStudyTimeUtils() {
  const empty = studyTimeUtils.createEmptyStudyTime()

  assert('时长 - 空值归一化为 0',
    studyTimeUtils.normalizeStudyTime(null).totalSeconds === 0,
    JSON.stringify(studyTimeUtils.normalizeStudyTime(null)))

  assert('时长 - 非法与负数被夹到 0',
    studyTimeUtils.normalizeStudyTime({ totalSeconds: -50, sessionCount: -3 }).totalSeconds === 0 &&
    studyTimeUtils.normalizeStudyTime({ totalSeconds: -50, sessionCount: -3 }).sessionCount === 0)

  assert('时长 - 字符串数字可被识别',
    studyTimeUtils.normalizeStudyTime({ totalSeconds: '600', sessionCount: '2' }).totalSeconds === 600)

  const once = studyTimeUtils.addStudySession(empty, 300, 1000)

  assert('时长 - 累加一次', once.totalSeconds === 300 && once.sessionCount === 1, JSON.stringify(once))

  const twice = studyTimeUtils.addStudySession(once, 200, 2000)

  assert('时长 - 累计叠加', twice.totalSeconds === 500 && twice.sessionCount === 2, JSON.stringify(twice))

  // 不足 1 秒的练习不应污染累计值，也不该让「完成次数」虚增
  const zero = studyTimeUtils.addStudySession(once, 0, 3000)

  assert('时长 - 0 秒不累加也不计次数',
    zero.totalSeconds === 300 && zero.sessionCount === 1,
    JSON.stringify(zero))

  const overflow = studyTimeUtils.addStudySession(empty, 5 * 60 * 60, 4000)

  assert('时长 - 单次超过 2 小时被截断',
    overflow.totalSeconds === studyTimeUtils.MAX_SESSION_SECONDS,
    `实际 ${overflow.totalSeconds}`)

  assert('时长 - 0 秒显示「尚未开始」',
    studyTimeUtils.formatStudyDuration(0) === '尚未开始',
    studyTimeUtils.formatStudyDuration(0))

  assert('时长 - 不足 1 分钟',
    studyTimeUtils.formatStudyDuration(30) === '不到1分钟',
    studyTimeUtils.formatStudyDuration(30))

  assert('时长 - 分钟级',
    studyTimeUtils.formatStudyDuration(25 * 60) === '25分钟',
    studyTimeUtils.formatStudyDuration(25 * 60))

  assert('时长 - 时+分（对齐参考稿的 3时35分）',
    studyTimeUtils.formatStudyDuration(3 * 3600 + 35 * 60) === '3时35分',
    studyTimeUtils.formatStudyDuration(3 * 3600 + 35 * 60))

  assert('时长 - 整小时不带零分',
    studyTimeUtils.formatStudyDuration(2 * 3600) === '2小时',
    studyTimeUtils.formatStudyDuration(2 * 3600))
}

// ---------- 二、首页文案层 ----------
function checkHomeContent() {
  assert('文案 - 早上好',
    homeContent.getGreetingText(localTime(2026, 9, 19, 8)) === '早上好')

  assert('文案 - 中午好',
    homeContent.getGreetingText(localTime(2026, 9, 19, 12)) === '中午好')

  assert('文案 - 下午好',
    homeContent.getGreetingText(localTime(2026, 9, 19, 16)) === '下午好')

  assert('文案 - 晚上好',
    homeContent.getGreetingText(localTime(2026, 9, 19, 20)) === '晚上好')

  assert('文案 - 凌晨落到「夜深了」',
    homeContent.getGreetingText(localTime(2026, 9, 19, 2)) === '夜深了',
    homeContent.getGreetingText(localTime(2026, 9, 19, 2)))

  // 时段边界：11 点整应进入「中午好」而不是「早上好」
  assert('文案 - 11:00 属于中午',
    homeContent.getGreetingText(localTime(2026, 9, 19, 11)) === '中午好')

  assert('文案 - 日期格式',
    homeContent.getDateText(localTime(2026, 9, 19, 16)) === '9 月 19 日 周六',
    homeContent.getDateText(localTime(2026, 9, 19, 16)))

  const withWrong = homeContent.getGreetingAdvice({ pendingWrong: 7, answered: 30, accuracyText: '82%' })

  assert('文案 - 有错题时优先提错题',
    withWrong.indexOf('7') >= 0 && withWrong.indexOf('错题') >= 0,
    withWrong)

  const withProgress = homeContent.getGreetingAdvice({ pendingWrong: 0, answered: 30, accuracyText: '82%' })

  assert('文案 - 无错题但有进度时提进度',
    withProgress.indexOf('30') >= 0 && withProgress.indexOf('82%') >= 0,
    withProgress)

  const fresh = homeContent.getGreetingAdvice({ pendingWrong: 0, answered: 0 })

  assert('文案 - 全新用户给起步建议',
    fresh.indexOf('10 道题') >= 0,
    fresh)

  const tipWrong = homeContent.buildHomeTip({ pendingWrong: 12, masteredWrong: 4, answered: 60, total: 234 })

  assert('公告 - 有错题时指向错题本',
    tipWrong.action === homeContent.TIP_ACTIONS.WRONG_BOOK && tipWrong.text.indexOf('12') >= 0,
    `${tipWrong.action} / ${tipWrong.text}`)

  assert('公告 - 有错题时详情提到攻克规则',
    tipWrong.detail.indexOf('连续答对 2 次') >= 0,
    tipWrong.detail)

  const tipGoing = homeContent.buildHomeTip({ pendingWrong: 0, answered: 100, total: 234 })

  assert('公告 - 进行中时指向题库',
    tipGoing.action === homeContent.TIP_ACTIONS.BANK && tipGoing.text.indexOf('134') >= 0,
    `${tipGoing.action} / ${tipGoing.text}`)

  const tipDone = homeContent.buildHomeTip({ pendingWrong: 0, answered: 234, total: 234 })

  assert('公告 - 做满后建议重做而非提示剩余',
    tipDone.text.indexOf('都做过') >= 0,
    tipDone.text)

  const tipFresh = homeContent.buildHomeTip({ pendingWrong: 0, answered: 0, total: 234 })

  assert('公告 - 全新用户显示题库总量',
    tipFresh.tag === '新手上路' && tipFresh.text.indexOf('234') >= 0,
    `${tipFresh.tag} / ${tipFresh.text}`)

  const content = homeContent.buildHomeContent({ pendingWrong: 0, answered: 0, total: 234 }, localTime(2026, 9, 19, 16))

  assert('文案 - 总入口返回四段内容',
    !!content.greeting && !!content.dateText && !!content.advice && !!content.tip)
}

// ---------- 三、每日语录 ----------
function checkDailyQuotes() {
  const quotes = require(path.join(MINIPROGRAM, 'utils/daily-quotes.js'))
  const total = quotes.QUOTES.length

  assert('语录 - 池子至少 30 条', total >= 30, `实际 ${total}`)

  assert('语录 - 每条都是非空文本',
    quotes.QUOTES.every((text) => typeof text === 'string' && text.trim().length > 0))

  const morning = localTime(2026, 9, 19, 10)
  const evening = localTime(2026, 9, 19, 22)

  assert('语录 - 同一天不同时刻取到同一条',
    quotes.getDailyQuote(morning).text === quotes.getDailyQuote(evening).text,
    `${quotes.getDailyQuote(morning).text} / ${quotes.getDailyQuote(evening).text}`)

  const nextDay = localTime(2026, 9, 20, 10)

  assert('语录 - 次日自动更换',
    quotes.getDailyQuote(morning).text !== quotes.getDailyQuote(nextDay).text,
    `${quotes.getDailyQuote(morning).text} / ${quotes.getDailyQuote(nextDay).text}`)

  const week = []

  for (let i = 0; i < 7; i += 1) {
    week.push(quotes.getDailyQuote(localTime(2026, 9, 19 + i, 10)).text)
  }

  assert('语录 - 连续 7 天互不重复', new Set(week).size === 7, week.join(' | '))

  assert('语录 - 1 月 1 日是第 1 天',
    quotes.getDayOfYear(localTime(2026, 1, 1, 10)) === 1,
    String(quotes.getDayOfYear(localTime(2026, 1, 1, 10))))

  assert('语录 - 跨年同日回到同一条',
    quotes.getDailyQuote(localTime(2026, 9, 19, 10)).text ===
    quotes.getDailyQuote(localTime(2027, 9, 19, 10)).text)

  assert('语录 - 取值下标始终落在池子范围内',
    quotes.getDailyQuote(localTime(2026, 12, 31, 10)).index < total)

  const content = homeContent.buildHomeContent(
    { pendingWrong: 0, answered: 0, total: 234 },
    localTime(2026, 9, 19, 16)
  )

  assert('语录 - 首页文案总入口带语录',
    !!content.quote && content.quote === quotes.getDailyQuote(localTime(2026, 9, 19, 16)).text,
    content.quote)
}

// ---------- 四、首页 ViewModel 集成 ----------
function checkSubjectListViewModel() {
  const storage = createMemoryStorage()
  const vm = new SubjectListViewModel({ storage })
  const data = vm.load().data

  // 科目列表已归位到「题库」tab，首页不再下发它：
  // 这条断言是防止有人「顺手」把科目卡再加回首页，让两个页面又重复一次
  assert('首页 - 不再下发科目列表', data.subjects === undefined, JSON.stringify(data.subjects))
  assert('首页 - 题目总数等于题库总量', data.overall.total > 0, `实际 ${data.overall.total}`)
  assert('首页 - 汇总带完成度', typeof data.overall.progressPercent === 'number')
  assert('首页 - 问候语非空', !!data.home.greeting, JSON.stringify(data.home))
  assert('首页 - 日期非空', !!data.home.dateText)
  assert('首页 - 建议非空', !!data.home.advice)
  assert('首页 - 每日语录非空', !!data.home.quote, JSON.stringify(data.home.quote))
  assert('首页 - 公告带跳转目标', !!(data.home.tip && data.home.tip.action), JSON.stringify(data.home.tip))
  assert('首页 - 初始错题为 0', data.home.wrongCount === 0, `实际 ${data.home.wrongCount}`)
  assert('首页 - 初始时长为「尚未开始」',
    data.home.studyTimeText === '尚未开始',
    data.home.studyTimeText)

  const toWrong = vm.openTipAction(homeContent.TIP_ACTIONS.WRONG_BOOK)

  assert('首页 - 公告去复习走错题本页',
    toWrong.command.type === 'openRouteWithLoading' &&
    toWrong.command.payload.url.indexOf('/page/wrong-book/index') === 0,
    JSON.stringify(toWrong.command))

  const toBank = vm.openTipAction(homeContent.TIP_ACTIONS.BANK)

  assert('首页 - 公告去刷题切到题库 tab',
    toBank.command.type === 'switchTab' && toBank.command.url === '/page/bank-detail/index',
    JSON.stringify(toBank.command))

  const stats = vm.openStats()

  assert('首页 - 详情切到统计 tab',
    stats.command.type === 'switchTab' && stats.command.url === '/page/stats/index',
    JSON.stringify(stats.command))

  // 「去刷题」不得携带科目，否则会把题库页重置回第一个科目
  const bank = vm.openBank()

  assert('首页 - 去刷题不带科目参数',
    bank.command.type === 'switchTab' && !bank.command.payload,
    JSON.stringify(bank.command))

  // 学习数据卡的「待复习错题」格 → 错题本
  const wrongBox = vm.openWrongBook()

  assert('首页 - 错题格走错题本页',
    wrongBox.command.type === 'openRouteWithLoading' &&
    wrongBox.command.payload.url.indexOf('/page/wrong-book/index') === 0,
    JSON.stringify(wrongBox.command))
}

// ---------- 四、答题 → 时长结算 的端到端 ----------
function answerAll(vm, wrongFirstN) {
  const questions = vm.session.state.questions

  questions.forEach((question, index) => {
    const correctIndex = question.options.findIndex((option) => question.answerKeys.indexOf(option.key) >= 0)
    const wrongIndex = question.options.findIndex((option) => question.answerKeys.indexOf(option.key) < 0)
    const target = index < wrongFirstN && wrongIndex >= 0 ? wrongIndex : correctIndex

    vm.selectOption(target)
    vm.goNext()
  })
}

function checkStudyTimeEndToEnd() {
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })

  vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const session = vm.session

  assert('时长 - 会话创建后立即计时', typeof session.getElapsedSeconds() === 'number')

  // 把时钟往前拨 90 秒，模拟一次真实练习的耗时
  session.accumulatedMs = 90 * 1000
  session.startedAt = Date.now()

  answerAll(vm, 2)
  vm.forceSubmit()

  const afterFirst = vm.repository.getStudyTime(storage)

  assert('时长 - 交卷后写入累计时长',
    afterFirst.totalSeconds >= 90 && afterFirst.totalSeconds < 120,
    `实际 ${afterFirst.totalSeconds}`)

  assert('时长 - 交卷后计入一次练习', afterFirst.sessionCount === 1, `实际 ${afterFirst.sessionCount}`)

  // 重复交卷不应重复结算（模拟交卷弹窗与超时自动交卷同时触发）
  vm.forceSubmit()

  const afterSecond = vm.repository.getStudyTime(storage)

  assert('时长 - 重复交卷不重复累加',
    afterSecond.totalSeconds === afterFirst.totalSeconds &&
    afterSecond.sessionCount === afterFirst.sessionCount,
    JSON.stringify(afterSecond))

  // 答题页写入的数据，首页应当立刻读到
  const homeVm = new SubjectListViewModel({ storage })
  const home = homeVm.load().data

  assert('首页 - 练习后时长不再是「尚未开始」',
    home.home.studyTimeText !== '尚未开始',
    home.home.studyTimeText)

  assert('首页 - 练习后错题数与错题本一致',
    home.home.wrongCount === homeVm.repository.summarizeWrongBook(homeVm.repository.getWrongBook(storage)).pending,
    `首页 ${home.home.wrongCount}`)

  assert('首页 - 错题数为答错的题数',
    home.home.wrongCount === 2,
    `实际 ${home.home.wrongCount}`)

  // 暂停 / 恢复：切后台的等待时间不得计入
  const fresh = new PracticeViewModel({ storage: createMemoryStorage() })

  fresh.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const probe = fresh.session

  probe.accumulatedMs = 10000
  probe.startedAt = Date.now()
  probe.pauseStudy()

  const pausedAt = probe.getElapsedSeconds()

  probe.pausedAt -= 60000

  assert('时长 - 暂停期间不计时',
    probe.getElapsedSeconds() === pausedAt,
    `暂停前 ${pausedAt}，等待 60 秒后 ${probe.getElapsedSeconds()}`)

  probe.resumeStudy()

  assert('时长 - 恢复后不补算后台时间',
    probe.getElapsedSeconds() === pausedAt,
    `实际 ${probe.getElapsedSeconds()}`)

  // 背题模式也属于学习时间
  const viewVm = new PracticeViewModel({ storage: createMemoryStorage() })

  viewVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'view' })
  viewVm.session.accumulatedMs = 60 * 1000
  viewVm.session.startedAt = Date.now()
  viewVm.forceSubmit()

  assert('时长 - 背题模式同样计入',
    viewVm.repository.getStudyTime(viewVm.storage).totalSeconds >= 60,
    JSON.stringify(viewVm.repository.getStudyTime(viewVm.storage)))

  assert('时长 - 背题模式仍不写做题进度',
    Object.keys(viewVm.repository.getProgress(viewVm.storage)).length === 0,
    JSON.stringify(viewVm.repository.getProgress(viewVm.storage)))
}

// ---------- 五、清除数据 ----------
function checkClearRecords() {
  const storage = createMemoryStorage()
  const practiceVm = new PracticeViewModel({ storage })

  practiceVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  practiceVm.session.accumulatedMs = 45 * 1000
  practiceVm.session.startedAt = Date.now()
  answerAll(practiceVm, 3)
  practiceVm.forceSubmit()

  practiceVm.repository.addQuestionFavorite(storage, practiceVm.session.state.questions[0].id)

  const homeVm = new SubjectListViewModel({ storage })

  assert('清除 - 清空前进度/错题/时长都有值',
    homeVm.load().data.home.wrongCount > 0 &&
    homeVm.load().data.home.studyTimeText !== '尚未开始',
    homeVm.load().data.home.studyTimeText)

  const { MyViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/my-viewmodel.js'))
  const myVm = new MyViewModel({ storage })
  const result = myVm.clearRecords()

  assert('清除 - 返回提示', result.command && result.command.type === 'toast', JSON.stringify(result.command))

  const after = homeVm.load().data

  assert('清除 - 进度被清空',
    Object.keys(homeVm.repository.getProgress(storage)).length === 0)

  assert('清除 - 错题本被清空',
    homeVm.repository.summarizeWrongBook(homeVm.repository.getWrongBook(storage)).total === 0)

  assert('清除 - 收藏被清空',
    homeVm.repository.getFavoriteIds(homeVm.repository.getFavorites(storage)).length === 0)

  assert('清除 - 学习时长归零',
    homeVm.repository.getStudyTime(storage).totalSeconds === 0,
    JSON.stringify(homeVm.repository.getStudyTime(storage)))

  assert('清除 - 首页回到全新状态',
    after.home.wrongCount === 0 &&
    after.home.studyTimeText === '尚未开始' &&
    after.overall.answered === 0,
    JSON.stringify({ wrong: after.home.wrongCount, time: after.home.studyTimeText, answered: after.overall.answered }))

  assert('清除 - 首页公告回到新手引导',
    after.home.tip.key === 'fresh-start',
    after.home.tip.key)
}

// ---------- 执行 ----------
checkStudyTimeUtils()
checkHomeContent()
checkDailyQuotes()
checkSubjectListViewModel()
checkStudyTimeEndToEnd()
checkClearRecords()

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
