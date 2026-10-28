const assert = require('assert')
const http = require('../miniprogram/repositories/http-gateway.js')
const online = require('../miniprogram/repositories/online-practice.js')
const copy = (v) => JSON.parse(JSON.stringify(v))
async function main() {
  const records = { qandaAuth: { provider: 'email', userId: 'u1', token: 'token1' }, qandaDeviceId: 'device1' }
  const storage = { get: (k) => records[k] && copy(records[k]), set: (k, v) => { records[k] = copy(v) }, remove: (k) => delete records[k] }
  const runtime = new online.OnlinePractice(storage)
  runtime.identity()
  runtime.put('s1', { id: 's1', status: 'IN_PROGRESS', version: 2, writer: { deviceId: 'device1', writerToken: 'writer1', acknowledgedSequence: 4 } })
  const savedRequest = http.request
  const calls = []
  let dropped = false
  http.request = async (method, path, body, options) => {
    calls.push({ method, path, body: copy(body), options })
    if (!dropped) { dropped = true; return { ok: false, statusCode: 0, reason: '请求超时' } }
    return { ok: true, data: { state: 'RELEASED', deviceId: null, writerToken: null, version: 2, acknowledgedSequence: 4 } }
  }
  const first = runtime.release('s1')
  assert.strictEqual(first, runtime.release('s1'))
  assert.strictEqual(await first, false)
  assert.strictEqual(calls.length, 1)
  assert(runtime.get('s1').releaseCommand)
  const restarted = new online.OnlinePractice(storage)
  assert.strictEqual(await restarted.release('s1'), true)
  assert.strictEqual(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey)
  assert.deepStrictEqual(calls[0].body, calls[1].body)
  assert.strictEqual(restarted.get('s1').releaseCommand, undefined)
  http.request = async (method, path) => ({ ok: true, data: method === 'GET' ? { id: 's2', questionBankId: 'bank2', status: 'IN_PROGRESS' } : { state: 'WAITING', writerToken: null, pendingDeviceId: 'device1' } })
  const waiting = await restarted.prepare({ sessionId: 's2' })
  assert.strictEqual(waiting.route.bankId, 'bank2')
  assert.deepStrictEqual(restarted.waitingIds(), ['s2'])
  assert.strictEqual(new online.OnlinePractice(storage).getWaiting('s2').route.bankId, 'bank2')
  restarted.put('closed', { id: 'closed', status: 'IN_PROGRESS', writer: { writerToken: null } })
  const closedCalls = []
  http.request = async (method, path) => {
    closedCalls.push(path)
    return { ok: true, data: path.endsWith('/result') ? { sessionId: 'closed', items: [], version: 3 } : { id: 'closed', questionBankId: 'bank2', status: 'SUBMITTED' } }
  }
  assert.strictEqual((await restarted.prepare({ sessionId: 'closed' })).status, 'SUBMITTED')
  assert.strictEqual(closedCalls.length, 2)
  assert(!closedCalls.some(path => path.includes('writer-acquire')))
  for (let index = 0; index < 8; index += 1) {
    const id = `completed-${index}`
    restarted.put(id, { id, status: 'SUBMITTED', result: { version: 3 }, assessmentCommands: index === 0 ? { item: { key: 'pending-rating' } } : {} })
    restarted.trackCompleted(id)
  }
  assert(restarted.get('completed-0'))
  assert.strictEqual(restarted.get('completed-1'), null)
  assert.strictEqual(restarted.get('completed-2'), null)
  assert(restarted.get('completed-3'))
  assert(restarted.get('completed-7'))
  runtime.queue.stop(); restarted.queue.stop()
  http.request = savedRequest

  let appDefinition
  let pageDefinition
  global.App = (definition) => { appDefinition = definition }
  global.Page = (definition) => { pageDefinition = definition }
  require('../miniprogram/app.js')
  require('../miniprogram/page/practice/index.js')
  const savedSetTimeout = global.setTimeout
  const savedClearTimeout = global.clearTimeout
  const timers = []
  global.setTimeout = (fn) => { timers.push(fn); return timers.length }
  global.clearTimeout = () => {}
  const foreground = online.enable(storage)
  foreground.identity()
  let released = 0
  const resolveFlush = []
  foreground.queue = { flushAll: () => new Promise((resolve) => resolveFlush.push(resolve)), sessionIds: () => ['s1'] }
  foreground.release = async () => { released += 1; return true }
  const app = Object.assign({}, appDefinition)
  app.onHide()
  app.onShow()
  resolveFlush[0]([])
  await Promise.resolve(); await Promise.resolve()
  assert.strictEqual(released, 0)
  resolveFlush[1]([])
  const ids = Array.from({ length: 9 }, (_, index) => `poll-${index}`)
  ids.forEach((id) => foreground.put(id, { id, status: 'IN_PROGRESS', writer: { writerToken: 'writer1', deviceId: 'device1' } }))
  foreground.queue.sessionIds = () => ids
  const polled = []
  foreground.poll = async (id) => { polled.push(id); return { state: 'WAITING' } }
  app.watchPendingPractice()
  await timers[timers.length - 1]()
  assert.strictEqual(polled.length, 4)
  await timers[timers.length - 1]()
  assert.strictEqual(polled.length, 8)
  assert.strictEqual(new Set(polled).size, 8)
  const waitingPage = Object.assign({}, pageDefinition, { data: { waitingForSync: true }, viewModel: { waitingId: 'waiting', online: { getWaiting: () => ({ startedAt: Date.now() - 50000 }) }, checkWriter: async () => null }, setData(patch) { Object.assign(this.data, patch) }, applyViewModelResult() {} })
  waitingPage.startSyncWatch()
  await timers[timers.length - 1]()
  assert.strictEqual(waitingPage.data.waitingSeconds, 50)
  let subject
  let target
  global.getApp = () => ({ setPendingSubjectId: (id) => { subject = id } })
  global.wx = { switchTab: (input) => { target = input.url } }
  pageDefinition.startNewPractice.call({ viewModel: { routeOptions: { subjectId: 'subject1' } }, stopTestTimer() {}, clearAutoAdvance() {} })
  assert.strictEqual(subject, 'subject1')
  assert.strictEqual(target, '/page/bank-detail/index')
  global.setTimeout = savedSetTimeout
  global.clearTimeout = savedClearTimeout
  delete global.App; delete global.Page; delete global.getApp; delete global.wx
  console.log('release replay, waiting persistence, foreground race and new practice navigation passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
