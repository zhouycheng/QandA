/**
 * Playground / Mock 设计（PRD 第 7 节）+ Gateway 边界（PRD 第 8 节）—— Node 自检脚本。
 * 运行：node apps/miniapp/tests/playground.check.js
 *
 * 断言 PRD 7 要求「至少能够模拟」的八种情况：
 * 正常题库 / 空题库 / 练习完成一半 / 全部未答 / 提交成功 / 提交失败 / 网络延迟 / 100 题压力。
 *
 * 同时守住两条架构底线：
 * - 页面与 ViewModel 只认 Gateway 的四个方法（getSubjects / getQuestionBanks / createSession / submitSession）；
 * - Mock ⇄ HTTP 通过注入切换，切换后业务流程不变。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const fixtures = require(path.join(MINIPROGRAM, 'playground/playground-fixtures.js'))
const scenarios = require(path.join(MINIPROGRAM, 'playground/playground-scenarios.js'))
const mockGateway = require(path.join(MINIPROGRAM, 'playground/mock-gateway.js'))
const practiceGateway = require(path.join(MINIPROGRAM, 'repositories/practice-gateway.js'))
const httpGateway = require(path.join(MINIPROGRAM, 'repositories/http-gateway.js'))
const playgroundSwitch = require(path.join(MINIPROGRAM, 'utils/playground-switch.js'))
const mockScenario = require(path.join(MINIPROGRAM, 'utils/mock-scenario.js'))
const questionBankCatalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
const sessionRepository = require(path.join(MINIPROGRAM, 'repositories/session-repository.js'))
const practiceRepository = require(path.join(MINIPROGRAM, 'repositories/practice-repository.js'))
const { PlaygroundViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/playground-viewmodel.js'))
const { SYNC_STATUS } = require(path.join(MINIPROGRAM, 'models/practice-session-state.js'))

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

function createPlaygroundViewModel(storage) {
  return new PlaygroundViewModel({
    storage,
    repository: practiceRepository
  })
}

async function run() {
  // ---------- 1) fixtures ----------
  const normalQuestions = fixtures.getPlaygroundQuestions('playground-normal')
  const emptyQuestions = fixtures.getPlaygroundQuestions('playground-empty')
  const stressQuestions = fixtures.getPlaygroundQuestions('playground-stress')

  assert('fixtures - 正常题库 20 题', normalQuestions.length === 20, `实际 ${normalQuestions.length}`)
  assert('fixtures - 空题库真的是 0 题', emptyQuestions.length === 0, `实际 ${emptyQuestions.length}`)
  assert('fixtures - 压力场景 100 题', stressQuestions.length === 100, `实际 ${stressQuestions.length}`)
  assert(
    'fixtures - 三种题型都出现（单选/多选/判断）',
    ['single', 'multiple', 'judge'].every((type) => normalQuestions.some((item) => item.type === type)),
    normalQuestions.map((item) => item.type).join(',')
  )
  assert(
    'fixtures - 判断题只有两个选项',
    normalQuestions.filter((item) => item.type === 'judge').every((item) => item.options.length === 2),
    '判断题选项数不对'
  )
  assert(
    'fixtures - 多选题答案不止一个',
    normalQuestions.filter((item) => item.type === 'multiple').every((item) => item.answerKeys.length > 1),
    '多选题答案数不对'
  )
  assert(
    'fixtures - 题目 id 唯一',
    new Set(normalQuestions.concat(stressQuestions).map((item) => item.id)).size === 120,
    '存在重复 id'
  )
  assert(
    'fixtures - 同一题库重复取卷结果一致（生成规则可预测）',
    fixtures.getPlaygroundQuestions('playground-normal')[0].id === normalQuestions[0].id,
    '重复取卷不一致'
  )

  const halfSession = fixtures.buildHalfCompletedSession('playground-normal', 1700000000000)
  const halfAnswered = halfSession.answers.filter(Boolean).length

  assert('fixtures - 半完成会话答了一半', halfAnswered === 10, `实际 ${halfAnswered}`)
  assert('fixtures - 半完成会话停在第 11 题', halfSession.currentIndex === 10, `实际 ${halfSession.currentIndex}`)
  assert(
    'fixtures - 半完成会话 questionIds 按 id 排序（与出题顺序解耦）',
    halfSession.questionIds.slice().sort().join('|') === halfSession.questionIds.join('|'),
    '未排序'
  )
  assert(
    'fixtures - 半完成会话未答部分保留 null 占位',
    halfSession.answers.length === 20 && halfSession.answers.slice(10).every((item) => item === null),
    '占位缺失'
  )

  const resultFixture = fixtures.buildResultFixture(halfSession)
  assert('fixtures - 结果快照题量正确', resultFixture.totalCount === 20, `实际 ${resultFixture.totalCount}`)
  assert('fixtures - 结果快照已做 10', resultFixture.answeredCount === 10, `实际 ${resultFixture.answeredCount}`)
  assert('fixtures - 结果快照未答 10', resultFixture.unansweredCount === 10, `实际 ${resultFixture.unansweredCount}`)
  assert('fixtures - 结果快照正确率 100', resultFixture.accuracy === 100, `实际 ${resultFixture.accuracy}`)
  assert(
    'fixtures - 结果快照逐题字段齐全',
    resultFixture.questionResults.every((item) => (
      item.questionId && typeof item.status === 'string' && typeof item.explanation === 'string'
    )),
    '字段缺失'
  )

  // ---------- 2) 场景 ----------
  const scenarioList = scenarios.listScenarios()

  assert('场景 - 恰好 8 个（PRD 7 要求）', scenarioList.length === 8, `实际 ${scenarioList.length}`)
  assert(
    '场景 - 八种情况齐备',
    ['normal', 'empty', 'halfCompleted', 'allUnanswered', 'submitSuccess', 'submitFailed', 'slowNetwork', 'stress100']
      .every((key) => scenarioList.some((item) => item.key === key)),
    scenarioList.map((item) => item.key).join(',')
  )
  assert('场景 - 未知场景名回落 normal', scenarios.normalizeScenarioName('nope') === 'normal', '未回落')

  const halfStorage = createMemoryStorage()
  scenarios.applyScenario(halfStorage, 'halfCompleted')

  const savedHalf = sessionRepository.getSession(halfStorage)
  assert('场景 - 完成一半会预置会话', !!savedHalf, '未写入会话')
  assert(
    '场景 - 预置会话可恢复（未提交）',
    !!sessionRepository.getResumableSession(halfStorage),
    '被判为不可恢复'
  )
  assert(
    '场景 - 预置会话已答 10 题',
    savedHalf && savedHalf.answers.filter(Boolean).length === 10,
    savedHalf ? String(savedHalf.answers.filter(Boolean).length) : '无会话'
  )
  assert('场景 - 完成一半的场景开关同步写入', mockScenario.getScenario(halfStorage) === 'halfCompleted', '未写入')
  assert(
    '场景 - 完成一半的链接带 resume=1',
    scenarios.buildPracticeUrl('playground-normal', 'half').indexOf('resume=1') >= 0,
    '链接缺少 resume'
  )

  const normalStorage = createMemoryStorage()
  scenarios.applyScenario(normalStorage, 'normal')
  assert('场景 - 全部未答会清掉旧会话', sessionRepository.getSession(normalStorage) === null, '仍有残留会话')
  assert('场景 - 正常场景链接指向练习页', scenarios.buildPracticeUrl('playground-normal', 'none').indexOf('/page/practice/index') === 0, '链接不对')

  const applied = scenarios.applyScenario(createMemoryStorage(), 'stress100')
  assert('场景 - 压力场景题库为 100 题卷', applied.questionCount === 100, `实际 ${applied.questionCount}`)
  assert('场景 - 空题库场景题量为 0', scenarios.applyScenario(createMemoryStorage(), 'empty').questionCount === 0, '不为 0')

  // ---------- 3) Gateway 边界 ----------
  const gatewayMethods = ['getSubjects', 'getQuestionBanks', 'createSession', 'submitSession']

  assert(
    'Gateway - 四个方法齐备（PRD 8）',
    gatewayMethods.every((method) => typeof practiceGateway[method] === 'function'),
    gatewayMethods.filter((method) => typeof practiceGateway[method] !== 'function').join(',')
  )
  assert('Gateway - 默认注入 Mock', practiceGateway.getGatewayName() === 'mock', practiceGateway.getGatewayName())

  const subjectStorage = createMemoryStorage()
  const subjects = await practiceGateway.getSubjects(subjectStorage)
  assert('Gateway - getSubjects 返回科目列表', Array.isArray(subjects) && subjects.length > 0, '列表为空')

  const banks = await practiceGateway.getQuestionBanks(subjectStorage, 'subject-chinese')
  assert('Gateway - getQuestionBanks 返回题库', Array.isArray(banks) && banks.length > 0, '题库为空')

  const created = await practiceGateway.createSession(subjectStorage, { sessionId: 'sess_pg', questionCount: 20 })
  assert('Gateway - createSession 成功', created && created.ok === true, JSON.stringify(created))
  assert('Gateway - 新建会话为 LOCAL_ONLY', created.syncStatus === SYNC_STATUS.LOCAL_ONLY, created.syncStatus)

  const okStorage = createMemoryStorage()
  mockScenario.setScenario(okStorage, 'submitSuccess')
  const okOutcome = await practiceGateway.submitSession(okStorage, { sessionId: 'sess_ok' })
  assert('Gateway - 提交成功为 SYNCED', okOutcome.ok === true && okOutcome.syncStatus === SYNC_STATUS.SYNCED, JSON.stringify(okOutcome))
  assert('Gateway - 提交成功带回结果快照', !!(okOutcome.result && okOutcome.result.questionResults), '无结果')

  const failStorage = createMemoryStorage()
  mockScenario.setScenario(failStorage, 'submitFailed')
  const failOutcome = await practiceGateway.submitSession(failStorage, { sessionId: 'sess_fail' })
  assert('Gateway - 提交失败为 SYNC_PENDING', failOutcome.ok === false && failOutcome.syncStatus === SYNC_STATUS.SYNC_PENDING, JSON.stringify(failOutcome))
  assert('Gateway - 提交失败带回原因', !!failOutcome.reason, '无原因文案')

  const slowStorage = createMemoryStorage()
  mockScenario.setScenario(slowStorage, 'slowNetwork')
  const slowStart = Date.now()
  const slowOutcome = await practiceGateway.submitSession(slowStorage, { sessionId: 'sess_slow' })
  const slowCost = Date.now() - slowStart

  assert('Gateway - 慢网络返回 Promise（异步）', typeof practiceGateway.submitSession(slowStorage, { sessionId: 'x' }).then === 'function', '不是 Promise')
  assert('Gateway - 慢网络确实延迟了', slowCost >= 1500, `实际 ${slowCost}ms`)
  assert('Gateway - 慢网络最终提交成功', slowOutcome.ok === true, JSON.stringify(slowOutcome))

  const syncStorage = createMemoryStorage()
  mockScenario.setScenario(syncStorage, 'normal')
  const syncOutcome = practiceGateway.submitSession(syncStorage, { sessionId: 'sess_sync' })
  assert(
    'Gateway - 无延迟时走同步快路径（不返回 Promise）',
    !syncOutcome || typeof syncOutcome.then !== 'function',
    '被包成了 Promise'
  )

  // ---------- 4) HTTP 网关与注入切换 ----------
  const httpStorage = createMemoryStorage()
  const unconfigured = await httpGateway.submitSession(httpStorage, { sessionId: 'sess_http' })

  assert('HTTP - 未配置域名时返回失败而不是抛错', unconfigured.ok === false, JSON.stringify(unconfigured))
  assert('HTTP - 未配置域名仍给 SYNC_PENDING（可重试）', unconfigured.syncStatus === SYNC_STATUS.SYNC_PENDING, unconfigured.syncStatus)
  assert('HTTP - 未配置域名时不崩（无 wx 环境可 require）', httpGateway.isConfigured() === false, '被判为已配置')

  httpGateway.configure({ baseUrl: 'https://api.example.com/' })
  assert('HTTP - configure 去掉结尾斜杠', httpGateway.getConfig().baseUrl === 'https://api.example.com', httpGateway.getConfig().baseUrl)

  httpGateway.configure({ baseUrl: '' })

  practiceGateway.setGateway(httpGateway)
  assert('切换 - 注入 HTTP 后网关名为 http', practiceGateway.getGatewayName() === 'http', practiceGateway.getGatewayName())

  const httpSubmit = await practiceGateway.submitSession(httpStorage, { sessionId: 'sess_http2' })
  assert('切换 - 走 HTTP 时提交失败不抛错', httpSubmit && httpSubmit.ok === false, JSON.stringify(httpSubmit))

  practiceGateway.resetGateway()
  assert('切换 - 可退回 Mock', practiceGateway.getGatewayName() === 'mock', practiceGateway.getGatewayName())

  const afterReset = await practiceGateway.submitSession(createMemoryStorage(), { sessionId: 'sess_back' })
  assert('切换 - 退回后提交恢复成功', afterReset.ok === true, JSON.stringify(afterReset))

  // ---------- 5) Playground 开关与题库注入 ----------
  const switchStorage = createMemoryStorage()
  playgroundSwitch.setEnabled(switchStorage, false)

  const closedSubjects = questionBankCatalog.getSubjectSummaries()
  assert(
    '开关 - 关闭时科目列表不含 Playground',
    closedSubjects.every((item) => item.id !== fixtures.PLAYGROUND_SUBJECT_ID),
    'Playground 混进了正式列表'
  )

  playgroundSwitch.setEnabled(switchStorage, true)

  const openSubjects = questionBankCatalog.getSubjectSummaries()
  const playgroundSubject = openSubjects.find((item) => item.id === fixtures.PLAYGROUND_SUBJECT_ID)

  assert('开关 - 开启后出现 Playground 科目', !!playgroundSubject, '未出现')
  assert('开关 - Playground 科目带 3 个题库', playgroundSubject && playgroundSubject.banks.length === 3, '题库数不对')

  const emptyQuiz = questionBankCatalog.getBankQuiz(fixtures.PLAYGROUND_SUBJECT_ID, 'playground-empty')
  assert('开关 - 空题库取卷为 0 题（页面空态可验证）', emptyQuiz && emptyQuiz.questions.length === 0, '不为 0')

  const stressQuiz = questionBankCatalog.getBankQuiz(fixtures.PLAYGROUND_SUBJECT_ID, 'playground-stress')
  assert('开关 - 压力题库取卷为 100 题', stressQuiz && stressQuiz.questions.length === 100, '题量不对')

  const normalQuiz = questionBankCatalog.getBankQuiz(fixtures.PLAYGROUND_SUBJECT_ID, 'playground-normal')
  assert('开关 - 正常题库取卷为 20 题', normalQuiz && normalQuiz.questions.length === 20, '题量不对')
  assert(
    '开关 - 取出的题目已归一化（带 typeText / isMultiple）',
    normalQuiz && normalQuiz.questions.every((item) => !!item.typeText && typeof item.isMultiple === 'boolean'),
    '未归一化'
  )

  assert('开关 - 开关状态写入 storage', switchStorage.get(playgroundSwitch.STORAGE_KEY) === '1', String(switchStorage.get(playgroundSwitch.STORAGE_KEY)))

  playgroundSwitch.setEnabled(switchStorage, false)
  assert(
    '开关 - 关闭后 Playground 题库消失',
    questionBankCatalog.getSubjectSummaries().every((item) => item.id !== fixtures.PLAYGROUND_SUBJECT_ID),
    '未消失'
  )

  assert('开关 - 从 storage 恢复开关', playgroundSwitch.syncFromStorage(switchStorage) === false, '恢复值不对')

  // ---------- 6) Playground 面板 ViewModel ----------
  const vm = createPlaygroundViewModel(createMemoryStorage())
  const initialData = PlaygroundViewModel.getInitialData()
  assert('面板 - 初始数据可用', initialData.enabled === false && Array.isArray(initialData.scenarios), '初始值不对')

  const loaded = vm.load()
  assert('面板 - load 返回 8 个场景', loaded.data.scenarios.length === 8, `实际 ${loaded.data.scenarios.length}`)
  assert('面板 - 默认关闭', loaded.data.enabled === false, '默认不是关闭')
  assert('面板 - 显示当前网关', loaded.data.gatewayName === 'mock', loaded.data.gatewayName)
  assert('面板 - 场景带题量说明', loaded.data.scenarios.every((item) => !!item.questionCountText), '缺题量')

  const toggled = vm.toggleEnabled(true)
  assert('面板 - 可开启', toggled.data.enabled === true, '未开启')
  assert('面板 - 开启后提示文案切换', toggled.data.note.indexOf('已开启') === 0, toggled.data.note)

  const appliedResult = vm.applyScenario('submitFailed')
  assert('面板 - 应用场景返回跳转命令', !!appliedResult.command && appliedResult.command.type === 'navigate', '无跳转命令')
  assert('面板 - 跳转链接指向练习页', appliedResult.command.url.indexOf('/page/practice/index') === 0, appliedResult.command.url)
  assert('面板 - 当前场景已切换', appliedResult.data.currentScenario === 'submitFailed', appliedResult.data.currentScenario)

  const resetResult = vm.resetGateway()
  assert('面板 - 可退回 Mock 网关', resetResult.data.gatewayName === 'mock', resetResult.data.gatewayName)
  assert('面板 - 退回后给提示', !!resetResult.command && resetResult.command.type === 'toast', '无提示')

  vm.toggleEnabled(false)
  assert('面板 - 可关闭', vm.load().data.enabled === false, '未关闭')
}

// ---------- 输出 ----------
run()
  .catch((error) => {
    results.push({
      name: `脚本异常：${error && error.message ? error.message : error}`,
      passed: false,
      detail: ''
    })
  })
  .then(() => {
    const failed = results.filter((item) => !item.passed)

    results.forEach((item) => {
      console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
    })

    console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

    if (failed.length) {
      process.exit(1)
    }
  })
