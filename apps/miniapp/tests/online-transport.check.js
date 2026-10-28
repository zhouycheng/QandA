const assert = require('assert')
const transport = require('../miniprogram/repositories/api-transport.js')
const auth = require('../miniprogram/repositories/auth-repository.js')
const gateway = require('../miniprogram/repositories/auth-gateway.js')
const { createSyncQueue } = require('../miniprogram/repositories/practice-sync-queue.js')
const memory = () => { const data = {}; return { get: (k) => data[k], set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)) }, remove: (k) => delete data[k] } }
async function main() {
  transport.configure({ baseUrl: 'https://example.test/api/v1', tokenProvider: () => 'real-token' })
  const requests = []
  let inFlight = 0
  let peak = 0
  global.wx = { request(input) { requests.push(input); inFlight += 1; peak = Math.max(peak, inFlight); setImmediate(() => { inFlight -= 1; input.success({ statusCode: 200, data: {}, header: { 'X-Request-Id': 'trace' } }) }) } }
  await Promise.all(Array.from({ length: 11 }, () => transport.request('GET', '/me')))
  assert.strictEqual(peak, 4)
  assert.strictEqual(requests[0].url, 'https://example.test/api/v1/me')
  assert.strictEqual(requests[0].header.Authorization, 'Bearer real-token')
  let page = 0
  global.wx.request = (input) => { page += 1; input.success({ statusCode: 200, data: { items: Array(page === 1 ? 100 : 1).fill(page), total: 101 } }) }
  const all = await transport.getAll('/subjects')
  assert.strictEqual(all.data.length, 101)
  assert.strictEqual(page, 2)
  global.wx.request = (input) => input.success({ statusCode: 429, data: { code: 'RATE_LIMITED', message: '稍后重试' }, header: { 'Retry-After': '12' } })
  const limited = await transport.request('GET', '/me')
  assert.strictEqual(limited.retryAfter, 12000)
  assert.strictEqual(limited.code, 'RATE_LIMITED')

  const storage = memory()
  gateway.setAuthGateway({ loginByEmail: () => ({ ok: false, unavailable: true, reason: '断网' }), login: () => ({ ok: false, reason: '断网' }) })
  assert.strictEqual((await auth.loginWithEmail(storage, { email: 'a@b.com', password: 'abc12345' })).ok, false)
  assert.strictEqual((await auth.login(storage, { codeProvider: (done) => done('code') })).ok, false)
  assert.strictEqual(auth.getAuth(storage).loggedIn, false)
  gateway.setAuthGateway({ loginByEmail: () => ({ ok: true, userId: 'real-id', token: 'token', profile: { version: 3 }, version: 3 }) })
  assert.strictEqual((await auth.loginWithEmail(storage, { email: 'a@b.com', password: 'abc12345' })).auth.version, 3)
  let codes = 0
  let registered = 0
  gateway.setAuthGateway({
    login: () => ++codes === 1 ? { ok: false, registrationToken: 'register-token' } : { ok: true, userId: 'wechat-user', token: 'wechat-token' },
    registerWechat: (input) => { assert.strictEqual(input.registrationToken, 'register-token'); registered += 1; return { ok: true } }
  })
  let issuedCodes = 0
  const firstWechat = await auth.login(memory(), { codeProvider: (done) => done(`code-${++issuedCodes}`) })
  assert.strictEqual(firstWechat.auth.userId, 'wechat-user')
  assert.strictEqual(issuedCodes, 2)
  assert.strictEqual(registered, 1)
  gateway.resetAuthGateway()

  let clock = 1000
  let scheduled = []
  let calls = []
  let complete
  const settings = { storage, userId: 'u1', now: () => clock, random: () => 0, setTimer: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length }, clearTimer: () => {}, send: (id, command) => { calls.push({ id, command }); return new Promise((done) => { complete = done }) } }
  const queue = createSyncQueue(settings)
  assert(queue.save('s1', { answer: 1 }).ok)
  assert(queue.save('s1', { answer: 1 }).unchanged)
  assert.strictEqual(scheduled[0].delay, 5000)
  const first = queue.flush('s1')
  assert.strictEqual(queue.flush('s1'), first)
  await Promise.resolve()
  queue.save('s1', { answer: 2 })
  complete({ ok: true, version: 2 })
  await first
  assert.strictEqual(queue.get('s1').acknowledgedSequence, 1)
  assert.strictEqual(queue.get('s1').sequence, 2)
  const second = queue.flush('s1')
  await Promise.resolve()
  complete({ ok: false, statusCode: 0 })
  await second
  const failedKey = calls[1].command.idempotencyKey
  queue.stop()
  const restarted = createSyncQueue(Object.assign({}, settings, { send: async (id, command) => { calls.push({ id, command }); return { ok: true } } }))
  clock += 1000
  await restarted.flush('s1')
  assert.strictEqual(calls[2].command.idempotencyKey, failedKey)
  assert.deepStrictEqual(calls[2].command.payload, { answer: 2 })
  assert.strictEqual(restarted.removeConfirmed('s1'), true)
  assert.strictEqual(restarted.get('s1'), null)
  assert(!restarted.sessionIds().includes('s1'))
  restarted.save('protected', { answer: 1 })
  assert.strictEqual(restarted.removeConfirmed('protected'), false)
  assert(restarted.get('protected'))
  restarted.save('s2', { answer: 3 })
  assert.strictEqual(restarted.get('protected').payload.answer, 1)
  assert.strictEqual(createSyncQueue(Object.assign({}, settings, { userId: 'u2' })).get('s1'), null)
  const paused = createSyncQueue(Object.assign({}, settings, { send: async () => ({ ok: false, statusCode: 409 }) }))
  await paused.flush('s2')
  assert(paused.get('s2').paused)
  paused.save('s3', { answer: 'auth-expired' })
  const expired = createSyncQueue(Object.assign({}, settings, { send: async () => ({ ok: false, statusCode: 401 }) }))
  await expired.flush('s3')
  let renewedSends = 0
  const renewed = createSyncQueue(Object.assign({}, settings, { send: async () => { renewedSends += 1; return { ok: true } } }))
  await renewed.resumeAuthOnly()
  assert.strictEqual(renewedSends, 1)
  assert.strictEqual(renewed.get('s3').paused, false)
  assert.strictEqual(renewed.get('s2').paused, true)
  expired.stop(); renewed.stop()
  let rateSends = 0
  const throttled = createSyncQueue(Object.assign({}, settings, { send: async () => { rateSends += 1; return { ok: false, statusCode: 429, retryAfter: 12000 } } }))
  throttled.save('rate', { answer: 1 })
  await throttled.flush('rate')
  throttled.save('rate', { answer: 2 })
  assert.strictEqual((await throttled.flush('rate')).deferred, true)
  assert.strictEqual(rateSends, 1)
  const throttleRestart = createSyncQueue(Object.assign({}, settings, { send: async () => { rateSends += 1; return { ok: true } } }))
  assert.strictEqual((await throttleRestart.flush('rate')).deferred, true)
  assert.strictEqual(rateSends, 1)
  throttled.stop(); throttleRestart.stop()
  const broken = createSyncQueue(Object.assign({}, settings, { storage: { get: () => null, set: () => { throw new Error('full') } } }))
  assert.strictEqual(broken.save('s1', {}).storageError, true)
  restarted.stop(); paused.stop()
  delete global.wx
  transport.configure({ baseUrl: '', tokenProvider: null })
  console.log('online transport and durable queue checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
