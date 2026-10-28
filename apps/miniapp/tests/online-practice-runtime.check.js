const assert = require('assert')
const http = require('../miniprogram/repositories/http-gateway.js')
const { OnlinePractice } = require('../miniprogram/repositories/online-practice.js')
const { PracticeSession } = require('../miniprogram/models/practice-session.js')
const copy = (v) => JSON.parse(JSON.stringify(v))
async function main() {
  const data = { qandaAuth: { provider: 'email', userId: 'u1', token: 'token1' } }
  let full = false
  const storage = { get: (k) => data[k] && copy(data[k]), set: (k, v) => { if (full) throw new Error('full'); data[k] = copy(v) }, remove: (k) => delete data[k] }
  const requests = []
  const writer = { state: 'ACTIVE', deviceId: 'device1', writerToken: 'writer1', pendingDeviceId: null, version: 1, acknowledgedSequence: 0, updatedAt: new Date().toISOString() }
  storage.set('qandaDeviceId', 'device1')
  let createLost = true
  let offline = false
  let failProgressResponse = false
  let finishLost = false
  let ratingLost = false
  let submitted = false
  let version = 1
  const replies = {}
  const snapshot = { id: 's1', questionBankId: 'b1', status: 'IN_PROGRESS', version: 1, currentIndex: 0, durationSeconds: 0, feedback: 'IMMEDIATE', configuration: { chapterIds: [], count: 1, order: 'SEQUENTIAL', selectionKind: 'NORMAL', feedback: 'IMMEDIATE', contentVersion: 1 }, writer, items: [{ itemId: 'i1', position: 0, question: { id: 'q1', revisionId: 'r1', questionBankId: 'b1', type: 'SINGLE_CHOICE', stem: '题干', options: [{ key: 'A', content: '选项甲' }, { key: 'B', content: '选项乙' }], correctAnswer: null, correctValue: null, referenceAnswer: null, explanation: null, assetIds: [] }, answer: null, confirmed: false, marked: false, outcome: null, selfAssessment: null }], offlineGrading: [{ itemId: 'i1', correctAnswer: ['A'], correctValue: null, referenceAnswer: null, explanation: '解析仅答后显示' }] }
  const unified = new PracticeSession({ quiz: new OnlinePractice(storage).quiz(Object.assign({ route: {} }, snapshot)), mode: 'test' })
  unified.reset()
  unified.selectOption(0)
  unified.openQuestionOverview()
  assert.strictEqual(unified.getViewData().overviewItems[0].isCorrect, false, '统一反馈交卷前不展示判定')
  assert.strictEqual(unified.getViewData().currentCorrectAnswerText, '')
  assert.strictEqual(unified.forceSubmit().data.overviewItems[0].isCorrect, true, '统一反馈交卷后展示判定')
  const result = { id: 'result1', sessionId: 's1', version: 3, totalCount: 1, answeredCount: 1, durationSeconds: 1, objective: { count: 1, answered: 1, correct: 1, wrong: 0, unanswered: 0, accuracy: 1 }, shortAnswer: { count: 0, answered: 0, rated: 0, correct: 0, wrong: 0, unrated: 0 }, items: snapshot.items, submittedAt: new Date().toISOString() }
  global.wx = { request(input) {
    requests.push({ url: input.url, method: input.method, data: copy(input.data), header: copy(input.header) })
    if (offline) { input.fail({ errMsg: 'request:fail offline' }); return }
    const key = input.header['Idempotency-Key']
    let body
    if (input.url.endsWith('/question-banks/b1')) body = { id: 'b1', name: '题库', contentVersion: 1, questionCount: 1 }
    else if (input.url.endsWith('/practice/sessions')) {
      if (!replies[key]) replies[key] = snapshot
      body = replies[key]
      if (createLost) { createLost = false; input.fail({ errMsg: 'request:fail timeout' }); return }
    }
    else if (input.url.endsWith('/progress-ack')) {
      if (submitted && !replies[key]) { input.success({ statusCode: 409, data: { code: 'SESSION_CLOSED', message: '练习已结束' } }); return }
      if (!replies[key]) replies[key] = { id: 's1', version: ++version, acknowledgedSequence: input.data.clientSequence, writer: Object.assign({}, writer, { version, acknowledgedSequence: input.data.clientSequence }) }
      body = replies[key]
      if (failProgressResponse) { failProgressResponse = false; input.fail({ errMsg: 'request:fail timeout' }); return }
    } else if (input.url.endsWith('/finish')) {
      submitted = true
      body = result
      if (finishLost) { finishLost = false; input.fail({ errMsg: 'request:fail timeout' }); return }
    } else if (input.url.endsWith('/self-assessment')) {
      body = Object.assign({}, result, { version: 4, sessionId: 's2' })
      if (ratingLost) { ratingLost = false; input.fail({ errMsg: 'request:fail timeout' }); return }
    } else throw new Error(`Unexpected route ${input.url}`)
    input.success({ statusCode: 200, data: copy(body) })
  } }
  http.configure({ baseUrl: 'https://example.test' })
  let runtime = new OnlinePractice(storage)
  await assert.rejects(() => runtime.prepare({ bankId: 'b1', mode: 'practice' }), /请求超时/)
  runtime.queue.stop()
  runtime = new OnlinePractice(storage)
  const created = await runtime.prepare({ bankId: 'b1', mode: 'practice' })
  assert.strictEqual(created.configuration.feedback, 'IMMEDIATE')
  const creations = requests.filter(r => r.url.endsWith('/practice/sessions'))
  assert.strictEqual(creations.length, 2)
  assert.strictEqual(creations[0].header['Idempotency-Key'], creations[1].header['Idempotency-Key'])
  assert.deepStrictEqual(creations[0].data, creations[1].data)
  assert.strictEqual(requests.filter(r => r.url.endsWith('/question-banks/b1')).length, 1)
  assert.deepStrictEqual(storage.get('qandaOnlineCreate:u1'), [])
  const session = new PracticeSession({ quiz: runtime.quiz(created), restored: runtime.restored(created), mode: 'practice', config: created.route })
  session.reset(); session.restore(runtime.restored(created))
  const initial = session.getViewData()
  assert(!JSON.stringify(initial).includes('解析仅答后显示'))
  assert(!Object.prototype.hasOwnProperty.call(initial.questions[0], 'answerKeys'))
  assert.strictEqual(initial.currentCorrectAnswerText, '')
  session.selectOption(0)
  assert.strictEqual(session.getViewData().shouldRevealAnswer, true)
  assert.strictEqual(session.getViewData().currentExplanation, '解析仅答后显示')
  runtime.save(session)
  failProgressResponse = true
  assert.strictEqual((await runtime.flush('s1')).ok, false)
  const before = runtime.queue.get('s1').pending
  runtime.queue.stop()
  offline = true
  const restarted = new OnlinePractice(storage)
  const restored = await restarted.prepare({ sessionId: 's1' })
  assert.strictEqual(restored.localState.answers[0].selectedKeys[0], 'A')
  assert.strictEqual(restarted.queue.get('s1').pending.idempotencyKey, before.idempotencyKey)
  offline = false
  await restarted.queue.resume('s1')
  assert.strictEqual(restarted.queue.get('s1').acknowledgedSequence, before.sequence)
  const progressRequests = requests.filter(r => r.url.endsWith('/progress-ack'))
  assert.deepStrictEqual(progressRequests[0].data, progressRequests[1].data)
  assert.strictEqual(progressRequests[0].header['Idempotency-Key'], progressRequests[1].header['Idempotency-Key'])
  full = true
  assert.throws(() => restarted.save(session), /full/)
  full = false
  session.finish()
  finishLost = true
  await assert.rejects(() => restarted.finish(session), /请求超时/)
  const beforeRetryProgress = requests.filter(r => r.url.endsWith('/progress-ack')).length
  session.accumulatedMs += 2000
  await restarted.finish(session)
  assert.strictEqual(requests.filter(r => r.url.endsWith('/progress-ack')).length, beforeRetryProgress)
  const finishRequests = requests.filter(r => r.url.endsWith('/finish'))
  assert.strictEqual(finishRequests[0].header['Idempotency-Key'], finishRequests[1].header['Idempotency-Key'])
  assert.deepStrictEqual(finishRequests[0].data, finishRequests[1].data)
  assert.strictEqual(restarted.get('s1').status, 'SUBMITTED')
  const ratedSnapshot = Object.assign({}, snapshot, { id: 's2', status: 'SUBMITTED', result: Object.assign({}, result, { sessionId: 's2' }), version: 3 })
  restarted.put('s2', ratedSnapshot)
  const shortSession = { meta: { sessionId: 's2' }, state: { answers: [{ selfAssessment: 'CORRECT' }] } }
  ratingLost = true
  await assert.rejects(() => restarted.finish(shortSession), /请求超时/)
  assert.strictEqual(restarted.get('s2').status, 'SUBMITTED')
  assert(restarted.get('s2').result)
  assert(restarted.get('s2').assessmentCommands.i1)
  const finalRating = await restarted.finish(shortSession)
  assert.strictEqual(finalRating.version, 4)
  const ratingRequests = requests.filter(r => r.url.endsWith('/self-assessment'))
  assert.strictEqual(ratingRequests[0].header['Idempotency-Key'], ratingRequests[1].header['Idempotency-Key'])
  assert.deepStrictEqual(ratingRequests[0].data, ratingRequests[1].data)
  assert.strictEqual(restarted.get('s2').assessmentCommands.i1, undefined)
  restarted.queue.stop()
  const beforeSwitch = requests.length
  storage.set('qandaAuth', { provider: 'email', userId: 'u2', token: 'token2' })
  const denied = await restarted.send('s1', before, 'u1')
  assert.strictEqual(denied.statusCode, 401)
  assert.strictEqual(requests.length, beforeSwitch)
  delete global.wx
  http.configure({ baseUrl: '' })
  console.log('online runtime creation, projection, offline restart, response loss and finish replay passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
