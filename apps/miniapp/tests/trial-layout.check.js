const assert = require('node:assert/strict')
const trials = require('../miniprogram/repositories/trial-practice.js')
const online = require('../miniprogram/repositories/online-practice.js')
const remote = require('../miniprogram/repositories/remote-data-repository.js')
const http = require('../miniprogram/repositories/http-gateway.js')
const repository = require('../miniprogram/repositories/practice-repository.js')
const { PracticeViewModel } = require('../miniprogram/viewmodels/practice-viewmodel.js')
const { QuestionDetailViewModel } = require('../miniprogram/viewmodels/question-detail-viewmodel.js')
const { PracticeLayoutViewModel } = require('../miniprogram/viewmodels/practice-layout-viewmodel.js')
const { DEFAULT_ORDER, move } = require('../miniprogram/utils/practice-layout.js')
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
function memory() {
  const data = {}
  return { data, full: false, get(key) { return copy(data[key]) }, set(key, value) { if (this.full) throw Error('存储已满'); data[key] = copy(value) }, remove(key) { delete data[key] }, keys() { return Object.keys(data) } }
}
function snapshot(id, feedback) {
  const types = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']
  return { id, questionBankId: 'bank', feedback, configuration: { count: 4 }, createdAt: new Date().toISOString(),
    items: types.map((type, i) => ({ itemId: 'i' + i, position: i, question: { id: 'q' + i, type, stem: type, options: type.endsWith('CHOICE') ? [{ key: 'A', content: '选项甲' }, { key: 'B', content: '选项乙' }] : [], correctAnswer: null, correctValue: null, explanation: null } })),
    offlineGrading: types.map((type, i) => ({ itemId: 'i' + i, correctAnswer: type === 'MULTIPLE_CHOICE' ? ['A', 'B'] : ['A'], correctValue: true, referenceAnswer: type === 'SHORT_ANSWER' ? '参考内容' : '', explanation: '仅确认后展示的解析' })) }
}
async function main() {
  let count = 0, offline = false, lose = false
  const requests = []
  http.request = async (method, path, body, options) => {
    requests.push({ method, path, body, options })
    if (offline || lose) { lose = false; return { ok: false, reason: '请求超时' } }
    if (path === '/question-banks/bank') return { ok: true, data: { id: 'bank', name: '四题试答', activeQuestionCount: 4, contentVersion: 1 } }
    assert.equal(path, '/practice/trial-snapshots', '试答只能请求公开快照')
    assert.equal(body.scope.count, 4)
    return { ok: true, data: snapshot('trial-' + (++count), body.feedback) }
  }
  const storage = memory()
  online.enable(storage); remote.enable()
  await assert.rejects(trials.prepare(storage, { bankId: 'bank', selectionKind: 'WRONG' }), /登录/)
  assert.equal(requests.length, 0, '游客的个人集合范围不能退化为全部题目')
  lose = true
  await assert.rejects(trials.prepare(storage, { bankId: 'bank', mode: 'order' }), /超时/)
  assert.equal(trials.remaining(storage), 2)
  storage.full = true
  await assert.rejects(trials.prepare(storage, { bankId: 'bank', mode: 'order' }), /存储已满/)
  storage.full = false
  assert.equal(trials.remaining(storage), 2, '存储失败不扣额度')
  const before = count
  const [a, b] = await Promise.all([trials.prepare(storage, { bankId: 'bank', mode: 'order' }), trials.prepare(storage, { bankId: 'bank', mode: 'order' })])
  assert.equal(a.id, b.id); assert.equal(count, before + 1, '连续点击只创建一次')
  const vm = new PracticeViewModel({ storage })
  const initial = await vm.load({ sessionId: a.id })
  assert.equal(initial.data.shouldRevealAnswer, false)
  assert(!JSON.stringify(initial.data).includes('仅确认后展示的解析'))
  vm.selectOption(0)
  assert.equal(vm.session.getViewData().shouldRevealAnswer, true)
  vm.goNext(); vm.selectOption(0)
  const beforeRestart = requests.length
  offline = true
  const resumed = new PracticeViewModel({ storage })
  await resumed.load({ sessionId: a.id })
  assert.equal(requests.length, beforeRestart, '杀进程后离线恢复不请求')
  assert.deepEqual(resumed.session.state.selectedKeys, ['A'])
  assert.equal(resumed.session.getViewData().shouldRevealAnswer, false, '多选确认前隐藏答案')
  resumed.selectOption(1); resumed.goNext()
  assert.equal(resumed.session.getViewData().shouldRevealAnswer, true)
  resumed.goNext(); resumed.selectOption(0); resumed.goNext()
  resumed.setAnswerText('我的简答'); resumed.goNext()
  assert.equal(resumed.session.getViewData().currentCorrectAnswerText, '参考内容')
  resumed.assessShortAnswer('CORRECT')
  resumed.forceSubmit()
  assert.equal(resumed.session.state.isCompleted, true)
  assert.equal(requests.length, beforeRestart, '离线试答交卷只落盘')
  assert.deepEqual(storage.keys(), [trials.KEY], '试答不写账号、错题、收藏或正式同步记录')
  const detail = new QuestionDetailViewModel({ storage }).load({ sessionId: a.id, id: 'q3' })
  assert.equal(detail.data.correctText, '参考内容')
  assert.equal(trials.remaining(storage), 1)
  offline = false
  const second = new PracticeViewModel({ storage })
  await second.load({ bankId: 'bank', mode: 'test' })
  second.selectOption(0); second.goNext()
  assert.equal(second.session.getViewData().currentCorrectAnswerText, '', '统一反馈在交卷前隐藏')
  assert.equal(trials.remaining(storage), 0)
  const third = await new PracticeViewModel({ storage }).load({ bankId: 'bank', mode: 'view' })
  assert.equal(third.command.type, 'trialLogin', '普通练习、模拟考试和背题共用额度')
  storage.set('qandaAuth', { userId: 'another', provider: 'email', token: 'example' })
  assert.equal(trials.remaining(storage), 0, '账号切换保留额度')
  const review = await new PracticeViewModel({ storage }).load({ sessionId: a.id })
  assert.equal(review.data.isCompleted, true, '登录后回看试答仍走本机')
  assert(requests.every(request => request.options.token === ''))

  const local = memory()
  const editor = new PracticeLayoutViewModel({ storage: local })
  const displayed = editor.load().data
  assert.equal(displayed.shouldRevealAnswer, true)
  assert.equal(displayed.currentQuestion.options.length, 3)
  const moved = move(DEFAULT_ORDER, 'tools', 0)
  editor.drop('tools', 0)
  assert.deepEqual(repository.getPreferences(local).moduleOrder, moved)
  local.full = true
  assert.match(editor.drop('analysis', 0).command.title, /保存失败/)
  assert.deepEqual(editor.order, moved, '保存失败回滚排序')
  local.full = false
  repository.updatePreferenceText(local, 'examName', '期末考试')
  editor.reset()
  assert.deepEqual(repository.getPreferences(local).moduleOrder, DEFAULT_ORDER)
  assert.equal(repository.getPreferences(local).examName, '期末考试')
  editor.drop('tools', 0)
  repository.resetPreferences(local)
  assert.deepEqual(repository.getPreferences(local).moduleOrder, moved, '答题偏好重置保留布局')
  assert.equal(repository.getPreferences(local).examName, '期末考试')
  const reload = new PracticeLayoutViewModel({ storage: local }).load().data
  assert.equal(reload.layoutRanks.tools, 0)
  const scriptVm = require('node:vm')
  const fs = require('node:fs')
  const context = { module: { exports: {} } }
  scriptVm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/utils/layout-drag.wxs'), 'utf8'), context)
  const drag = context.module.exports, state = {}, calls = [], styles = []
  const owner = { getState: () => state, selectComponent: () => ({ setStyle: style => styles.push(style) }), callMethod: (name, data) => calls.push({ name, data }) }
  drag.start({ currentTarget: { dataset: { module: 'stem' } }, touches: [{ clientY: 100 }] }, owner)
  drag.move({ touches: [{ clientY: 140 }], timeStamp: 100 }, owner)
  assert.equal(styles.at(-1).transform, 'translateY(40px)')
  drag.scroll(20, 0, owner)
  assert.equal(styles.at(-1).transform, 'translateY(60px)', '边缘自动滚动补偿跟手位移')
  drag.cancel({}, owner)
  assert.equal(styles.at(-1).transform, '')
  assert.equal(calls.at(-1).name, 'handleDragCancel', '取消手势只复位')
  assert(!calls.some(call => call.name === 'handleDragEnd'))
  let definition, edgeTick
  global.Page = value => { definition = value }
  global.wx = {}
  require('../miniprogram/page/practice-layout/index.js')
  const page = Object.assign({}, definition, { data: {}, viewModel: { order: DEFAULT_ORDER }, setData(patch) { Object.assign(this.data, patch) }, createSelectorQuery() {
    const query = { select() { return query }, selectAll() { return query }, boundingClientRect() { return query }, exec(done) {
      done([{ top: 100, bottom: 500, height: 400 }, DEFAULT_ORDER.map((id, i) => ({ top: 100 + i * 160, bottom: 260 + i * 160, dataset: { module: id } })), { height: 800 }])
    } }; return query
  } })
  const originalInterval = global.setInterval, originalClear = global.clearInterval
  global.setInterval = callback => { edgeTick = callback; return 1 }
  global.clearInterval = () => {}
  try {
    page.measure()
    page.handleDragStart({ id: 'stem', y: 490 })
    edgeTick()
    assert.equal(page.data.scrollTop, 12, '初次触摸尚未滚动时即可触发边缘自动滚动')
    page.handleScroll({ detail: { scrollTop: 360, scrollHeight: 800 } })
    page.handleDragMove({ y: 490 })
    assert.equal(page.drag.index, 4, '跨屏拖动按滚动后的模块位置计算插入目标')
    page.handleDragCancel()
    assert.equal(page.drag, null)
  } finally { global.setInterval = originalInterval; global.clearInterval = originalClear }
  console.log('trial-layout checks passed: quota, persistence failure, duplicate starts, four question types, offline restore, disclosure, account isolation, layout rollback')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
