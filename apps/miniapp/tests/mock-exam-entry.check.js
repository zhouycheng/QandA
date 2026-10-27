/**
 * 首页「模拟考试」一键开考 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/mock-exam-entry.check.js
 *
 * 起因：入口原本只弹一句「在题库中选科目后点模拟测试」，用户点两次才进得去。
 * 现在改成点一下直接开考，这里锁住三件事：
 *
 *   1. 不再吐 toast，必须给出跳转 command；
 *   2. 链接参数齐全且自洽（scope=subject / mode=test / count / duration / seed）；
 *   3. 这条链接真能被答题页吃下 —— 开的就是测试模式、题量与倒计时都对得上。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const catalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
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

function parseQuery(url) {
  const queryIndex = String(url).indexOf('?')

  if (queryIndex < 0) {
    return {}
  }

  return String(url).slice(queryIndex + 1).split('&').reduce((acc, pair) => {
    const segments = pair.split('=')
    acc[segments[0]] = segments.slice(1).join('=')
    return acc
  }, {})
}

function openPractice(query) {
  const vm = new PracticeViewModel({ storage: createMemoryStorage() })
  vm.load(query)
  return vm
}

// ---------- 一、点了就开考 ----------

const homeVm = new SubjectListViewModel({ storage: createMemoryStorage() })
homeVm.load()
const fresh = homeVm.openEntry('mock')

assert('一键开考 - 不再是提示 toast',
  fresh && fresh.command && fresh.command.type === 'openRouteWithLoading',
  fresh && fresh.command ? fresh.command.type : String(fresh))
assert('一键开考 - 给出跳转链接',
  !!(fresh && fresh.command.payload && fresh.command.payload.url),
  'payload.url 为空')
assert('一键开考 - 加载文案是生成试卷',
  fresh.command.payload.title === '正在生成试卷', fresh.command.payload.title)

const freshQuery = parseQuery(fresh.command.payload.url)

assert('链接 - 走整科抽题', freshQuery.scope === 'subject', freshQuery.scope)
assert('链接 - 测试模式', freshQuery.mode === 'test', freshQuery.mode)
assert('链接 - 带题量', Number(freshQuery.count) > 0, String(freshQuery.count))
assert('链接 - 带时长', Number(freshQuery.duration) > 0, String(freshQuery.duration))
assert('链接 - 每次新种子', !!freshQuery.seed, String(freshQuery.seed))
assert('链接 - 不带 bankId（整科不是单章）', !freshQuery.bankId, String(freshQuery.bankId))

const firstSubject = catalog.getSubjectSummaries().find((item) => Number(item.questionCount) > 0)
assert('新用户 - 落在题库第一个科目',
  freshQuery.subjectId === firstSubject.id,
  `${freshQuery.subjectId} ≠ ${firstSubject.id}`)

// ---------- 二、题量与时长落的住 ----------

const subjectTotal = catalog.getSubjectQuiz(firstSubject.id).questions.length
const expectCount = Math.min(20, subjectTotal)

assert('题量 - 抽一套而不是整科全背', Number(freshQuery.count) === expectCount,
  `${freshQuery.count} ≠ ${expectCount}`)
assert('题量 - 不超过该科实际题数',
  Number(freshQuery.count) <= subjectTotal,
  `${freshQuery.count} > ${subjectTotal}`)
assert('时长 - 是 5 分钟的整数倍',
  Number(freshQuery.duration) % 5 === 0, String(freshQuery.duration))
assert('时长 - 不少于 10 分钟', Number(freshQuery.duration) >= 10, String(freshQuery.duration))
assert('提示语 - 题量与时长都写给用户看',
  /题/.test(fresh.command.payload.description) && /分钟/.test(fresh.command.payload.description),
  fresh.command.payload.description)

// ---------- 三、这条链接真能开考 ----------

const mockVm = openPractice(freshQuery)
const viewData = mockVm.session.getViewData()

assert('答题页 - 吃下首页给的链接', mockVm.session.state.total > 0,
  String(mockVm.session.state.total))
assert('答题页 - 题量对得上抽题数', mockVm.session.state.total === expectCount,
  `${mockVm.session.state.total} ≠ ${expectCount}`)
assert('答题页 - 进入测试模式', viewData.isTestMode === true)
assert('答题页 - 不是背题模式', viewData.isViewMode === false)
assert('答题页 - 倒计时按给的时长起算',
  /^\d+:\d{2}$/.test(viewData.timerText) || /^\d{2}:\d{2}$/.test(viewData.timerText),
  viewData.timerText)
assert('答题页 - 第一题立即可选', !!mockVm.session.state.questions[0])

// ---------- 四、练过别的科目就考那科 ----------

const practicedStorage = createMemoryStorage()
const englishProgress = {}
englishProgress['subject-english'] = {
  answers: {},
  total: catalog.getSubjectQuiz('subject-english').questions.length,
  updatedAt: Date.now()
}
practicedStorage.set('qandaProgress', englishProgress)

const practicedVm = new SubjectListViewModel({ storage: practicedStorage })
practicedVm.load()
const practicedQuery = parseQuery(practicedVm.openEntry('mock').command.payload.url)

assert('有历史 - 考的是上次练过的科目',
  practicedQuery.subjectId === 'subject-english',
  practicedQuery.subjectId)

// ---------- 五、空题库不崩 ----------

const bareVm = new SubjectListViewModel({
  repository: {
    getSubjectSummaries: () => [],
    getProgress: () => ({}),
    getPreferences: () => ({}),
    getSubjectQuiz: () => null
  },
  storage: createMemoryStorage()
})

let threw = false
let bareResult = null

try {
  bareResult = bareVm.openEntry('mock')
} catch (error) {
  threw = true
}

assert('空题库 - 不抛错', threw === false)
assert('空题库 - 退化成一句提示',
  bareResult && bareResult.command && bareResult.command.type === 'toast',
  bareResult && bareResult.command ? bareResult.command.type : String(bareResult))

// ---------- 输出 ----------

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  if (!item.passed) {
    console.log(`FAIL  ${item.name}${item.detail ? ` —— ${item.detail}` : ''}`)
  }
})

console.log(`\n模拟考试入口自检：总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exitCode = 1
}
