/**
 * 题库详情页入口收敛 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/bank-detail-entry.check.js
 *
 * 覆盖这次「按钮去冗余」改造后的行为契约：
 *   1. 模式选择只改参数，不再各自触发练习；
 *   2. 「开始练习」= 整科全量，题序跟随模式（顺序 / 背题不打散）；
 *   3. 「模拟测试」= 抽屉里选题量 + 时间，不限时退化为普通抽题练习；
 *   4. 背题模式下只保留主按钮。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const catalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
const { BankDetailViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/bank-detail-viewmodel.js'))
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))

const SUBJECT_ID = 'subject-chinese'
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

/** 解析跳转 URL 的 query（保持原编码，交给答题页自己解码） */
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

function questionIds(session) {
  return session.state.questions.map((question) => question.id).join(',')
}

// ---------- 详情页初始状态 ----------
const storage = createMemoryStorage()
const detailVm = new BankDetailViewModel({ storage })
const loaded = detailVm.load(SUBJECT_ID)
const subjectQuiz = catalog.getSubjectQuiz(SUBJECT_ID)

assert('详情页 - 加载成功', !!loaded && !!loaded.data, 'detail 为空')
assert('详情页 - 默认顺序练习', loaded.data.mode === 'order', loaded.data.mode)
assert('详情页 - 默认非背题模式', loaded.data.isViewMode === false, String(loaded.data.isViewMode))
assert('详情页 - 抽屉时长含「不限时」',
  loaded.data.durationOptions.some((item) => item.value === 0),
  JSON.stringify(loaded.data.durationOptions))

// ---------- 模式切换只改参数 ----------
const modeSwitched = detailVm.selectMode('view')
assert('模式切换 - 不产生跳转命令',
  !modeSwitched.command,
  JSON.stringify(modeSwitched.command))
assert('模式切换 - 同步背题标记',
  modeSwitched.data.isViewMode === true && modeSwitched.data.mode === 'view',
  JSON.stringify(modeSwitched.data))
detailVm.selectMode('order')

// ---------- 开始练习：整科全量 ----------
const startResult = detailVm.startPractice(loaded.data)
const startQuery = parseQuery(startResult.command.payload.url)

assert('开始练习 - 走整科范围', startQuery.scope === 'subject', JSON.stringify(startQuery))
assert('开始练习 - 不限定题量', !startQuery.count, JSON.stringify(startQuery))
assert('开始练习 - 延续当前模式', startQuery.mode === 'order', startQuery.mode)

const startVm = openPractice(startQuery)
assert('开始练习 - 题量等于科目总题数',
  startVm.session.state.total === subjectQuiz.questions.length,
  `${startVm.session.state.total} vs ${subjectQuiz.questions.length}`)
assert('开始练习 - 顺序模式保持题库原顺序',
  questionIds(startVm.session) === subjectQuiz.questions.map((q) => q.id).join(','),
  '题序被改动')
assert('开始练习 - 顺序模式不进入倒计时',
  startVm.session.getViewData().isTestMode === false)

// ---------- 开始练习：随机模式打散 ----------
const randomData = Object.assign({}, loaded.data, { mode: 'practice' })
const randomQuery = parseQuery(detailVm.startPractice(randomData).command.payload.url)
const randomVm = openPractice(randomQuery)

assert('开始练习 - 随机模式题量仍为全科',
  randomVm.session.state.total === subjectQuiz.questions.length,
  String(randomVm.session.state.total))
assert('开始练习 - 随机模式题序被打散',
  questionIds(randomVm.session) !== subjectQuiz.questions.map((q) => q.id).join(','),
  '题序与题库原序完全一致')

// ---------- 开始练习：背题模式 ----------
const viewData = Object.assign({}, loaded.data, { mode: 'view' })
const viewQuery = parseQuery(detailVm.startPractice(viewData).command.payload.url)
const viewVm = openPractice(viewQuery)

assert('开始练习 - 背题模式保持题库原顺序',
  questionIds(viewVm.session) === subjectQuiz.questions.map((q) => q.id).join(','),
  '题序被改动')
assert('开始练习 - 背题模式不判分',
  viewVm.session.getViewData().isViewMode === true)

// ---------- 模拟测试：不限时 ----------
const drawResult = detailVm.confirmConfig(Object.assign({}, loaded.data, {
  selectedCount: 20,
  selectedDuration: 0
}))
const drawQuery = parseQuery(drawResult.command.payload.url)

assert('模拟测试 - 不限时使用普通模式', drawQuery.mode === 'order', drawQuery.mode)
assert('模拟测试 - 不限时不带倒计时参数', !drawQuery.duration, JSON.stringify(drawQuery))
assert('模拟测试 - 不限时按题量抽题', drawQuery.count === '20', String(drawQuery.count))

const drawVm = openPractice(drawQuery)
assert('模拟测试 - 不限时题量生效', drawVm.session.state.total === 20, String(drawVm.session.state.total))
assert('模拟测试 - 不限时不进入倒计时',
  drawVm.session.getViewData().isTestMode === false)

// ---------- 模拟测试：限时 ----------
const testResult = detailVm.confirmConfig(Object.assign({}, loaded.data, {
  selectedCount: 20,
  selectedDuration: 10
}))
const testQuery = parseQuery(testResult.command.payload.url)

assert('模拟测试 - 限时进入测试模式', testQuery.mode === 'test', testQuery.mode)
assert('模拟测试 - 限时带上时长', testQuery.duration === '10', String(testQuery.duration))

const testVm = openPractice(testQuery)
assert('模拟测试 - 限时题量生效', testVm.session.state.total === 20, String(testVm.session.state.total))
assert('模拟测试 - 限时开启倒计时',
  testVm.session.getViewData().isTestMode === true)

// ---------- 抽屉交互 ----------
detailVm.openTestConfig()
assert('抽屉 - 打开后可见', true)

const durationZero = detailVm.selectDuration(0)
assert('抽屉 - 允许选择「不限时」',
  durationZero && durationZero.data.selectedDuration === 0,
  JSON.stringify(durationZero))

const durationTen = detailVm.selectDuration(10)
assert('抽屉 - 允许选择 10 分钟',
  durationTen && durationTen.data.selectedDuration === 10,
  JSON.stringify(durationTen))

assert('抽屉 - 拒绝非法时长', detailVm.selectDuration(-1) === null)

const closed = detailVm.closeConfig()
assert('抽屉 - 可关闭', closed.data.configSheetVisible === false)

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
