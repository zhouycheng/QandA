/**
 * PracticeSession 持久化与恢复 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/session-persistence.check.js
 *
 * 覆盖 PRD 4.5「本地持久化与恢复」九项：
 * 答题后持续保存 / 主动退出保存 / 异常退出恢复 /
 * 恢复原题目集合 / 恢复原题序 / 恢复答案 / 恢复当前位置 / 恢复答题状态 / 恢复计时信息。
 *
 * 这两条是这套机制里最容易悄悄坏掉又不报错的地方，必须断言：
 * - 题序必须逐项相等（不是"数量相等"）；
 * - 计时必须接着走（不是从零开始）。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const {
  QUESTION_STATE,
  SESSION_STATUS,
  STORAGE_KEY,
  SYNC_STATUS,
  createSessionId,
  deriveQuestionStates,
  isResumable,
  normalizeSession,
  serializeSession
} = require(path.join(MINIPROGRAM, 'models/practice-session-state.js'))
const sessionRepository = require(path.join(MINIPROGRAM, 'repositories/session-repository.js'))
const practiceGateway = require(path.join(MINIPROGRAM, 'repositories/practice-gateway.js'))
const mockScenario = require(path.join(MINIPROGRAM, 'utils/mock-scenario.js'))
const { PracticeSession } = require(path.join(MINIPROGRAM, 'models/practice-session.js'))
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

function createViewModel(storage) {
  return new PracticeViewModel({
    storage
  })
}

function correctOptionIndexes(question) {
  return question.options.reduce((items, option, index) => {
    return question.answerKeys.indexOf(option.key) >= 0 ? items.concat(index) : items
  }, [])
}

/** 定位到第 index 题并作答。多选题需要额外一步「确认答案」 */
function answerQuestionAt(vm, index) {
  vm.jumpToQuestion(index)
  const question = vm.session.state.questions[index]
  const indexes = correctOptionIndexes(question)

  if (question.isMultiple) {
    indexes.forEach((optionIndex) => vm.selectOption(optionIndex))
    // 多选题在此处是「确认答案」，不翻页
    vm.goNext()
    return
  }

  vm.selectOption(indexes[0])
}

function questionIdOrder(vm) {
  return vm.session.state.questions.map((question) => question.id)
}

const BANK_OPTIONS = {
  subjectId: 'subject-chinese',
  bankId: 'chinese-ch001',
  mode: 'order'
}

// ---------- 1. 状态定义与序列化（纯计算） ----------
{
  assert('状态常量 - 业务状态三态齐备',
    SESSION_STATUS.IN_PROGRESS === 'IN_PROGRESS' &&
    SESSION_STATUS.PAUSED === 'PAUSED' &&
    SESSION_STATUS.SUBMITTED === 'SUBMITTED',
    JSON.stringify(SESSION_STATUS))

  assert('状态常量 - 同步状态五态齐备',
    SYNC_STATUS.LOCAL_ONLY === 'LOCAL_ONLY' &&
    SYNC_STATUS.SYNC_PENDING === 'SYNC_PENDING' &&
    SYNC_STATUS.SYNCING === 'SYNCING' &&
    SYNC_STATUS.SYNCED === 'SYNCED' &&
    SYNC_STATUS.SYNC_FAILED === 'SYNC_FAILED',
    JSON.stringify(SYNC_STATUS))

  const idA = createSessionId(1700000000000, 0.5)
  const idB = createSessionId(1700000000000, 0.5)
  assert('sessionId - 同参数可复现', idA === idB, `${idA} vs ${idB}`)
  assert('sessionId - 不同参数不碰撞', idA !== createSessionId(1700000000001, 0.5), '发生碰撞')

  const states = deriveQuestionStates([
    { isCorrect: true },
    null,
    { isCorrect: false }
  ], 3)
  assert('单题状态 - 由答案派生',
    states[0] === QUESTION_STATE.CORRECT &&
    states[1] === QUESTION_STATE.UNANSWERED &&
    states[2] === QUESTION_STATE.WRONG,
    JSON.stringify(states))

  const serialized = serializeSession({
    sessionId: 'sess_a',
    subjectId: 'subject-chinese',
    questionBankId: 'chinese-ch001',
    config: { mode: 'order', durationMinutes: 10 },
    questions: [{ id: 'q3' }, { id: 'q1' }, { id: 'q2' }],
    questionOrder: [0, 1, 2],
    currentIndex: 1,
    answers: [null, { questionId: 'q1', selectedKeys: ['A'], isCorrect: true }, null],
    elapsedTime: 120,
    status: SESSION_STATUS.IN_PROGRESS,
    syncStatus: SYNC_STATUS.LOCAL_ONLY
  })

  // 排序职责在 PracticeSession.buildQuestionIndex，serializeSession 只做兜底派生
  assert('序列化 - 未给 questionIds 时按展示顺序派生',
    serialized.questionIds.join(',') === 'q3,q1,q2',
    serialized.questionIds.join(','))

  const restoredOrder = serialized.questionOrder.map((i) => serialized.questionIds[i])
  assert('序列化 - questionOrder 可还原展示顺序',
    restoredOrder.join(',') === 'q3,q1,q2',
    restoredOrder.join(','))

  // 上层已算好时不得被覆盖（曾在这里踩过：重算拿到空数组，把算好的值冲掉）
  const prepared = serializeSession({
    sessionId: 'sess_b',
    questions: [],
    questionIds: ['q1', 'q2'],
    questionOrder: [1, 0]
  })
  assert('序列化 - 上层已算好的 questionIds 不被覆盖',
    prepared.questionIds.join(',') === 'q1,q2' && prepared.questionOrder.join(',') === '1,0',
    `${prepared.questionIds.join(',')} / ${prepared.questionOrder.join(',')}`)

  assert('序列化 - 未作答保留 null 占位',
    serialized.answers.length === 3 && serialized.answers[0] === null && !!serialized.answers[1],
    JSON.stringify(serialized.answers))

  const indexSession = new PracticeSession({
    quiz: {
      subjectId: 'subject-chinese',
      bankId: 'chinese-ch001',
      questions: [{ id: 'q3', options: [], answerKeys: [] }, { id: 'q1', options: [], answerKeys: [] }, { id: 'q2', options: [], answerKeys: [] }]
    }
  })
  const indexMeta = indexSession.buildQuestionIndex()
  assert('题序索引 - questionIds 按 id 排序（与出题顺序解耦）',
    indexMeta.questionIds.join(',') === 'q1,q2,q3',
    indexMeta.questionIds.join(','))
  assert('题序索引 - questionOrder 可还原展示顺序',
    indexMeta.questionOrder.map((i) => indexMeta.questionIds[i]).join(',') === 'q3,q1,q2',
    indexMeta.questionOrder.map((i) => indexMeta.questionIds[i]).join(','))
}

// ---------- 2. 反序列化对脏数据的兜底 ----------
{
  assert('反序列化 - 空字符串（真实 wx 的表现）', normalizeSession('') === null, '应返回 null')
  assert('反序列化 - null / undefined', normalizeSession(null) === null && normalizeSession(undefined) === null, '应返回 null')
  assert('反序列化 - 缺 sessionId 直接丢弃', normalizeSession({ questionIds: ['q1'] }) === null, '不应通过')

  const partial = normalizeSession({
    sessionId: 'sess_a',
    questionIds: ['q1', 'q2', 'q3']
  })
  assert('反序列化 - 缺 questionOrder 自动补齐',
    !!partial && partial.questionOrder.join(',') === '0,1,2',
    JSON.stringify(partial && partial.questionOrder))
  assert('反序列化 - 缺 answers 全部按未答',
    partial.answers.every((item) => item === null), '应为全 null')
  assert('反序列化 - 缺状态回落为 IN_PROGRESS / LOCAL_ONLY',
    partial.status === SESSION_STATUS.IN_PROGRESS && partial.syncStatus === SYNC_STATUS.LOCAL_ONLY,
    `${partial.status} / ${partial.syncStatus}`)

  const dirtyOrder = normalizeSession({
    sessionId: 'sess_a',
    questionIds: ['q1', 'q2', 'q3'],
    // -1 / 99 / 重复下标 / 非整数，全部应被过滤后再补齐
    questionOrder: [-1, 99, 1, 1, 'x', 2],
    answers: [{ questionId: 'q1', selectedKeys: 'not-an-array', isCorrect: 1 }],
    questionStates: ['bogus', null, 'wrong']
  })
  assert('反序列化 - questionOrder 过滤越界与重复后仍是完整排列',
    dirtyOrder.questionOrder.length === 3 &&
    dirtyOrder.questionOrder.slice().sort().join(',') === '0,1,2',
    JSON.stringify(dirtyOrder.questionOrder))
  assert('反序列化 - selectedKeys 非数组被清空',
    dirtyOrder.answers[0].selectedKeys.length === 0,
    JSON.stringify(dirtyOrder.answers[0]))
  assert('反序列化 - 非法状态由答案反推',
    dirtyOrder.questionStates[0] === QUESTION_STATE.CORRECT &&
    dirtyOrder.questionStates[1] === QUESTION_STATE.UNANSWERED,
    JSON.stringify(dirtyOrder.questionStates))

  assert('可恢复判定 - 已提交的不可恢复',
    !isResumable({ status: SESSION_STATUS.SUBMITTED }) &&
    isResumable({ status: SESSION_STATUS.IN_PROGRESS }),
    '判定错误')
}

// ---------- 3. 仓储读写 ----------
{
  const storage = createMemoryStorage()
  assert('仓储 - 空存储读不到会话', sessionRepository.getSession(storage) === null, '应返回 null')
  assert('仓储 - 空存储无可恢复会话', sessionRepository.getResumableSession(storage) === null, '应返回 null')

  sessionRepository.saveSession(storage, {
    sessionId: 'sess_a',
    subjectId: 'subject-chinese',
    questionBankId: 'chinese-ch001',
    config: { mode: 'order' },
    questions: [{ id: 'q1' }, { id: 'q2' }],
    currentIndex: 0,
    answers: [],
    status: SESSION_STATUS.IN_PROGRESS,
    syncStatus: SYNC_STATUS.LOCAL_ONLY
  }, 1700000000000)

  const saved = sessionRepository.getSession(storage)
  assert('仓储 - 写入后可读回', !!saved && saved.sessionId === 'sess_a', JSON.stringify(saved))
  assert('仓储 - 存储键为 qandaSession', !!storage.raw[STORAGE_KEY], Object.keys(storage.raw).join(','))
  assert('仓储 - createdAt / updatedAt 已填充',
    saved.createdAt === 1700000000000 && saved.updatedAt === 1700000000000,
    `${saved.createdAt} / ${saved.updatedAt}`)
  assert('仓储 - 未提交的可恢复', !!sessionRepository.getResumableSession(storage), '应可恢复')

  sessionRepository.saveSession(storage, {
    sessionId: 'sess_a',
    questions: [{ id: 'q1' }, { id: 'q2' }],
    status: SESSION_STATUS.SUBMITTED,
    syncStatus: SYNC_STATUS.SYNCED
  }, 1700000000060)
  assert('仓储 - 提交且同步成功后不可恢复', sessionRepository.getResumableSession(storage) === null, '不应可恢复')
  assert('仓储 - 已同步的不再是待重传', sessionRepository.getPendingSession(storage) === null, '不应是 pending')

  sessionRepository.saveSession(storage, {
    sessionId: 'sess_b',
    questions: [{ id: 'q1' }],
    status: SESSION_STATUS.SUBMITTED,
    syncStatus: SYNC_STATUS.SYNC_PENDING
  }, 1700000000120)
  assert('仓储 - 已提交但待重传可被检出',
    !!sessionRepository.getPendingSession(storage) &&
    sessionRepository.getPendingSession(storage).sessionId === 'sess_b',
    'pending 检出失败')

  assert('仓储 - 清除后读不到', sessionRepository.clearSession(storage) && sessionRepository.getSession(storage) === null, '清除失败')
}

// ---------- 4. 端到端：答题 → 落盘 → 重新进入 → 恢复 ----------
{
  const storage = createMemoryStorage()
  const first = createViewModel(storage)
  first.load(Object.assign({}, BANK_OPTIONS))
  const originalOrder = questionIdOrder(first)
  const total = originalOrder.length

  assert('端到端 - 取到题目', total > 0, `实际 ${total} 题`)

  answerQuestionAt(first, 0)
  answerQuestionAt(first, 1)
  answerQuestionAt(first, 2)

  const savedAfterAnswer = sessionRepository.getSession(storage)
  assert('端到端 - 答 3 题后已落盘（持续本地保存）',
    !!savedAfterAnswer && savedAfterAnswer.answers.filter(Boolean).length === 3,
    savedAfterAnswer ? `已答 ${savedAfterAnswer.answers.filter(Boolean).length} 题` : '未落盘')

  assert('端到端 - 落盘的题目集合与原卷一致',
    !!savedAfterAnswer && savedAfterAnswer.questionIds.slice().sort().join(',') === originalOrder.slice().sort().join(','),
    '题目集合不一致')

  // 模拟「重新进入」：新 ViewModel + 同一个 storage（等价杀进程后重开）
  const second = createViewModel(storage)
  second.load({ resume: '1' })

  assert('恢复 - 题目集合一致',
    questionIdOrder(second).slice().sort().join(',') === originalOrder.slice().sort().join(','),
    '题目集合变了')
  assert('恢复 - 题序逐项一致（不是仅数量相同）',
    questionIdOrder(second).join(',') === originalOrder.join(','),
    `${questionIdOrder(second).slice(0, 5).join(',')} ≠ ${originalOrder.slice(0, 5).join(',')}`)
  assert('恢复 - 答案条数一致',
    second.session.state.answers.filter(Boolean).length === 3,
    `实际 ${second.session.state.answers.filter(Boolean).length}`)
  assert('恢复 - 当前位置一致',
    second.session.state.currentIndex === 2,
    `实际第 ${second.session.state.currentIndex + 1} 题`)
  assert('恢复 - 已答题的状态被还原（显示解析/对错）',
    second.session.getViewData().hasAnswered === true,
    'hasAnswered 未还原')
  assert('恢复 - 会话 id 沿用原会话',
    second.session.meta.sessionId === first.session.meta.sessionId,
    `${second.session.meta.sessionId} ≠ ${first.session.meta.sessionId}`)

  // 异常退出：完全不调 onHide / saveSessionNow，只靠交互时的落盘
  const third = createViewModel(storage)
  third.load({ sessionId: first.session.meta.sessionId })
  assert('恢复 - 异常退出（未走 onHide）也恢复得出',
    third.session.state.answers.filter(Boolean).length === 3 &&
    third.session.state.currentIndex === 2,
    `已答 ${third.session.state.answers.filter(Boolean).length} 题，位置 ${third.session.state.currentIndex}`)
}

// ---------- 5. 计时恢复 ----------
{
  const storage = createMemoryStorage()
  const vm = createViewModel(storage)
  vm.load(Object.assign({}, BANK_OPTIONS))

  answerQuestionAt(vm, 0)

  // 直接改写落盘数据，模拟"这一场已经进行了 5 分钟"
  const saved = sessionRepository.getSession(storage)
  sessionRepository.saveSession(storage, Object.assign({}, saved, { elapsedTime: 300 }), Date.now())

  const resumed = createViewModel(storage)
  resumed.load({ resume: '1' })
  assert('恢复 - 计时接着走（不是从零开始）',
    resumed.session.getElapsedSeconds() >= 300,
    `实际 ${resumed.session.getElapsedSeconds()} 秒`)

  // 模拟测试：倒计时也要按已用时间扣减
  const testStorage = createMemoryStorage()
  const testVm = createViewModel(testStorage)
  testVm.load({ subjectId: 'subject-chinese', scope: 'subject', count: '10', mode: 'test', duration: '10' })
  const durationSeconds = testVm.session.state.durationSeconds
  // 落盘由交互触发，这里先跳一次题
  testVm.jumpToQuestion(0)
  const testSaved = sessionRepository.getSession(testStorage)
  sessionRepository.saveSession(testStorage, Object.assign({}, testSaved, { elapsedTime: 180 }), Date.now())

  const resumedTest = createViewModel(testStorage)
  resumedTest.load({ resume: '1' })
  assert('恢复 - 模拟测试倒计时按已用时间扣减',
    resumedTest.session.state.timerSeconds === Math.max(durationSeconds - 180, 0),
    `剩余 ${resumedTest.session.state.timerSeconds}，期望 ${Math.max(durationSeconds - 180, 0)}`)
}

// ---------- 6. 边界：背题模式、交卷、题库变动 ----------
{
  const viewStorage = createMemoryStorage()
  const viewVm = createViewModel(viewStorage)
  viewVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'view' })
  viewVm.jumpToQuestion(1)
  assert('边界 - 背题模式不产生会话', sessionRepository.getSession(viewStorage) === null, '不应落盘')

  const submitStorage = createMemoryStorage()
  const submitVm = createViewModel(submitStorage)
  submitVm.load(Object.assign({}, BANK_OPTIONS))
  answerQuestionAt(submitVm, 0)
  submitVm.forceSubmit()
  const afterSubmit = sessionRepository.getSession(submitStorage)
  assert('边界 - 交卷后状态为 SUBMITTED',
    !!afterSubmit && afterSubmit.status === SESSION_STATUS.SUBMITTED,
    afterSubmit ? afterSubmit.status : '未落盘')
  assert('边界 - 交卷后不再可恢复', sessionRepository.getResumableSession(submitStorage) === null, '仍被判为可恢复')
  assert('边界 - 交卷后同步状态为 SYNCED',
    !!afterSubmit && afterSubmit.syncStatus === SYNC_STATUS.SYNCED,
    afterSubmit ? afterSubmit.syncStatus : '未落盘')

  // 题库被改动：落盘里混进一个当前卷中不存在的 id
  const dirtyStorage = createMemoryStorage()
  const dirtyVm = createViewModel(dirtyStorage)
  dirtyVm.load(Object.assign({}, BANK_OPTIONS))
  const dirtyOrder = questionIdOrder(dirtyVm)
  answerQuestionAt(dirtyVm, 0)

  const dirtySaved = sessionRepository.getSession(dirtyStorage)
  sessionRepository.saveSession(dirtyStorage, Object.assign({}, dirtySaved, {
    questionIds: ['ghost-question-id'].concat(dirtySaved.questionIds)
  }), Date.now())

  let recovered = null
  let crashed = false

  try {
    const recoveredVm = createViewModel(dirtyStorage)
    recoveredVm.load({ resume: '1' })
    recovered = recoveredVm
  } catch (error) {
    crashed = true
    results.push({ name: '边界 - 题库混入未知 id 不崩溃', passed: false, detail: error.message })
  }

  if (!crashed) {
    assert('边界 - 题库混入未知 id 不崩溃', true)
    assert('边界 - 题库混入未知 id 后题数不变',
      questionIdOrder(recovered).length === dirtyOrder.length,
      `${questionIdOrder(recovered).length} ≠ ${dirtyOrder.length}`)
    assert('边界 - 题库混入未知 id 后答案不丢',
      recovered.session.state.answers.filter(Boolean).length === 1,
      `已答 ${recovered.session.state.answers.filter(Boolean).length} 题`)
  }
}

// ---------- 7. Mock 提交：失败 → SYNC_PENDING → 重试成功 ----------
{
  assert('Mock 场景 - 默认 normal',
    mockScenario.getScenario(createMemoryStorage()) === 'normal',
    mockScenario.getScenario(createMemoryStorage()))
  assert('Mock 场景 - 未知场景回落 normal',
    mockScenario.normalizeScenario('不存在的场景') === 'normal', '未回落')
  const persistStorage = createMemoryStorage()
  mockScenario.setScenario(persistStorage, 'submitFailed')
  assert('Mock 场景 - 场景可持久化',
    mockScenario.getScenario(persistStorage) === 'submitFailed',
    mockScenario.getScenario(persistStorage))

  const okStorage = createMemoryStorage()
  const okOutcome = practiceGateway.submitSession(okStorage, { sessionId: 'sess_a' })
  assert('网关 - 默认场景提交成功', okOutcome.ok && okOutcome.syncStatus === SYNC_STATUS.SYNCED, JSON.stringify(okOutcome))

  const failStorage = createMemoryStorage()
  mockScenario.setScenario(failStorage, 'submitFailed')
  const failOutcome = practiceGateway.submitSession(failStorage, { sessionId: 'sess_a' })
  assert('网关 - 失败场景返回 SYNC_PENDING',
    !failOutcome.ok && failOutcome.syncStatus === SYNC_STATUS.SYNC_PENDING,
    JSON.stringify(failOutcome))

  // 端到端：失败场景下交卷
  const failedStorage = createMemoryStorage()
  mockScenario.setScenario(failedStorage, 'submitFailed')
  const failedVm = createViewModel(failedStorage)
  failedVm.load(Object.assign({}, BANK_OPTIONS))
  answerQuestionAt(failedVm, 0)
  const failedResult = failedVm.forceSubmit()

  assert('提交失败 - 结果数据仍产出（本地已判完）',
    !!(failedResult && failedResult.data && failedResult.data.isCompleted),
    failedResult ? '无结果数据' : '返回 null')
  assert('提交失败 - 同步状态为 SYNC_PENDING',
    failedResult.data.syncStatus === SYNC_STATUS.SYNC_PENDING,
    failedResult.data.syncStatus)
  assert('提交失败 - 带回错误提示', !!failedResult.submitError, '无提示文案')
  assert('提交失败 - Session 未被清除',
    !!sessionRepository.getSession(failedStorage),
    'Session 被清掉了')
  assert('提交失败 - 可被待重传列表检出',
    !!sessionRepository.getPendingSession(failedStorage),
    'pending 未检出')

  const retryResult = failedVm.retrySubmit()
  assert('重试 - 提交成功', retryResult && retryResult.submitOk === true, JSON.stringify(retryResult && retryResult.submitOk))
  assert('重试 - 同步状态转为 SYNCED',
    retryResult.data.syncStatus === SYNC_STATUS.SYNCED,
    retryResult.data.syncStatus)
  assert('重试 - 落盘中同步状态已更新',
    sessionRepository.getSession(failedStorage).syncStatus === SYNC_STATUS.SYNCED,
    sessionRepository.getSession(failedStorage).syncStatus)
  assert('重试 - 不再是待重传',
    sessionRepository.getPendingSession(failedStorage) === null,
    '仍在 pending')
}

// ---------- 8. 练习入口的未完成会话检测（PRD 4.1） ----------
{
  const { SubjectListViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/subject-list-viewmodel.js'))
  const emptyStorage = createMemoryStorage()
  const emptyVm = new SubjectListViewModel({ storage: emptyStorage })

  assert('入口 - 无会话时继续卡片不显示', emptyVm.buildLastPractice({}) === null, '不应有入口')

  const storage = createMemoryStorage()
  const vm = createViewModel(storage)
  vm.load(Object.assign({}, BANK_OPTIONS))
  answerQuestionAt(vm, 0)
  answerQuestionAt(vm, 1)

  const homeVm = new SubjectListViewModel({ storage })
  const entry = homeVm.buildLastPractice({})

  assert('入口 - 有未完成会话时给出继续入口', !!entry, '未生成入口')
  assert('入口 - 标记为恢复态', !!entry && entry.resumed === true, '未标记 resumed')
  assert('入口 - 链接带 sessionId',
    !!entry && entry.url.indexOf('sessionId=') >= 0,
    entry ? entry.url : '无链接')
  assert('入口 - 文案显示进行中',
    !!entry && entry.metaText.indexOf('已答 2') >= 0,
    entry ? entry.metaText : '无文案')

  // 顺着入口链接进入，应恢复出同一场练习
  const resumedVm = createViewModel(storage)
  resumedVm.load({ sessionId: vm.session.meta.sessionId })
  assert('入口 - 顺着链接可恢复',
    resumedVm.session.state.answers.filter(Boolean).length === 2 &&
    resumedVm.session.meta.sessionId === vm.session.meta.sessionId,
    `已答 ${resumedVm.session.state.answers.filter(Boolean).length} 题`)

  // 交卷后入口应消失
  vm.forceSubmit()
  const afterVm = new SubjectListViewModel({ storage })
  const afterEntry = afterVm.buildLastPractice({})
  assert('入口 - 交卷后不再提示继续', !afterEntry || afterEntry.resumed !== true, '仍提示恢复')
}

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
