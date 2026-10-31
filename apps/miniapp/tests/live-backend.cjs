// Invoked by the PostgreSQL integration fixture; credentials are supplied only through the process environment.
const assert = require('node:assert/strict')
const api = require('../miniprogram/repositories/api-transport.js')
const remote = require('../miniprogram/repositories/remote-data-repository.js')
const online = require('../miniprogram/repositories/online-practice.js')
const auth = require('../miniprogram/repositories/auth-repository.js')
const { PracticeViewModel } = require('../miniprogram/viewmodels/practice-viewmodel.js')
const source = process.env
if (!source.QANDA_TEST_URL || !source.QANDA_TEST_TOKEN || !source.QANDA_TEST_BANK_ID || !source.QANDA_TEST_USER_ID) throw new Error('需要隔离的后端验收环境')
const values = new Map()
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const storage = { get: key => copy(values.get(key)), set: (key, value) => values.set(key, copy(value)), remove: key => values.delete(key) }
const requests = []
global.wx = { request(options) {
  const url = new URL(options.url)
  const read = options.method === 'GET'
  if (read) Object.entries(options.data || {}).forEach(([key, value]) => url.searchParams.set(key, value))
  requests.push({ method: options.method, path: url.pathname })
  fetch(url, { method: options.method, headers: options.header, body: read ? undefined : JSON.stringify(options.data || {}) })
    .then(async response => options.success({ statusCode: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null, header: Object.fromEntries(response.headers) }))
    .catch(error => options.fail({ errMsg: error.message }))
} }
async function main() {
  api.configure({ baseUrl: source.QANDA_TEST_URL, tokenProvider: () => source.QANDA_TEST_TOKEN })
  auth.saveAuth(storage, { provider: 'email', userId: source.QANDA_TEST_USER_ID, token: source.QANDA_TEST_TOKEN, email: 'fixture@example.test' })
  remote.enable(true); remote.bind(storage)
  await remote.loadBank(storage, source.QANDA_TEST_BANK_ID)
  const bank = remote.getBankMeta(source.QANDA_TEST_BANK_ID)
  assert.ok(bank, '真实目录包含验收题库')
  const runtime = online.enable(storage)
  const vm = new PracticeViewModel({ storage })
  let view = await vm.load({ bankId: bank.id, subjectId: bank.subjectId, mode: 'order', count: '4' })
  assert.equal(view.data.total, 4)
  assert.equal(view.data.currentCorrectAnswerText, '')
  assert.equal(view.data.currentQuestion.answerKeys, undefined)
  assert.equal(view.data.questions[0].answerKeys, undefined)
  for (let index = 0; index < vm.session.state.questions.length; index += 1) {
    vm.jumpToQuestion(index)
    const question = vm.session.state.questions[index]
    if (question.isShortAnswer) {
      vm.setAnswerText('自主练习验收作答')
      vm.goNext()
      vm.assessShortAnswer('CORRECT')
    } else {
      question.answerKeys.forEach(key => vm.selectOption(question.options.findIndex(option => option.key === key)))
      if (question.isMultiple) vm.goNext()
    }
  }
  await vm.forceSubmit()
  const completed = runtime.get(vm.session.meta.sessionId)
  assert.equal(completed.status, 'SUBMITTED')
  assert.equal(completed.result.objective.wrong, 0)
  assert.equal(completed.result.shortAnswer.rated, 1)
  assert.equal(runtime.queue.get(completed.id).sequence, runtime.queue.get(completed.id).acknowledgedSequence)
  remote.invalidateLearning()
  await Promise.all([remote.refresh(storage, 'home'), remote.refresh(storage, 'recent')])
  const recent = remote.getRecent(storage)
  assert.ok(recent.some(item => item.id === completed.id && item.status === 'SUBMITTED'))
  assert.ok(requests.some(item => item.path.endsWith('/progress-ack')))
  assert.ok(requests.every(item => item.path.startsWith('/api/v1/')))
  runtime.queue.stop()
  console.log(JSON.stringify({ passed: true, requests: requests.length, questions: view.data.total, objectiveCorrect: completed.result.objective.correct, selfRated: completed.result.shortAnswer.rated }))
}
main().catch(error => { const runtime = online.current(); if (runtime && runtime.queue) runtime.queue.stop(); console.error(error.message); process.exitCode = 1 })
