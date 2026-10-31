const assert = require('assert')
const http = require('../miniprogram/repositories/http-gateway.js')
const { OnlinePractice } = require('../miniprogram/repositories/online-practice.js')
async function main() {
  const records = {}
  const storage = { get: (key) => records[key] && JSON.parse(JSON.stringify(records[key])), set: (key, value) => { records[key] = JSON.parse(JSON.stringify(value)) }, remove: (key) => delete records[key] }
  storage.set('qandaAuth', { provider: 'email', userId: 'u1', token: 'token1' })
  const runtime = new OnlinePractice(storage)
  runtime.identity()
  runtime.put('s1', { id: 's1', version: 1, writer: { deviceId: 'device1', writerToken: 'writer1' } })
  const original = http.request
  const sent = []
  http.request = async (method, path, body, options) => {
    sent.push({ method, path, body: JSON.parse(JSON.stringify(body)), options })
    return { ok: true, data: { version: 2, writer: { deviceId: 'device1', writerToken: 'writer1' } } }
  }
  const item1 = { itemId: 'i1', answer: { optionKeys: ['A'] }, confirmed: true, marked: false }
  const item2 = { itemId: 'i2', answer: null, confirmed: false, marked: false }
  await runtime.send('s1', { idempotencyKey: 'key1', sequence: 1, payload: { progress: { currentIndex: 0, durationSeconds: 3, items: [item1, item2] } } }, 'u1')
  assert.strictEqual(sent[0].body.items.length, 2)
  await runtime.send('s1', { idempotencyKey: 'key2', sequence: 2, payload: { progress: { currentIndex: 1, durationSeconds: 5, items: [item1, Object.assign({}, item2, { marked: true })] } } }, 'u1')
  assert.strictEqual(sent[1].body.items.length, 1)
  assert.strictEqual(sent[1].body.items[0].itemId, 'i2')
  assert.strictEqual(sent[1].options.token, 'token1')
  // A replay retains its original expectedVersion even after a newer snapshot was saved.
  await runtime.send('s1', { idempotencyKey: 'key1', sequence: 1, payload: { progress: { items: [] } } }, 'u1')
  assert.deepStrictEqual(sent[2].body, sent[0].body)
  storage.set('qandaAuth', { provider: 'email', userId: 'u2', token: 'token2' })
  runtime.identity()
  assert.strictEqual((await runtime.send('s1', { idempotencyKey: 'key3', sequence: 3, payload: {} }, 'u1')).statusCode, 401)
  assert.strictEqual(sent.length, 3)
  assert.strictEqual(storage.get('qandaOnline:u2:s1'), undefined)
  runtime.queue.stop()
  http.request = original
  console.log('online practice delta, replay and account isolation checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
