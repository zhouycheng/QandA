const assert = require('assert')
const path = require('path')
const { WrongBookViewModel } = require(path.resolve(__dirname, '../miniprogram/viewmodels/wrong-book-viewmodel.js'))
const api = require(path.resolve(__dirname, '../miniprogram/repositories/api-transport.js'))
const remoteData = require(path.resolve(__dirname, '../miniprogram/repositories/remote-data-repository.js'))

async function main() {
  let requestedScope
  const repository = {
    isRemoteEnabled: () => true,
    getRemoteCollection: () => ({ data: { items: [], total: 3 }, status: 'ready', error: '' }),
    getRemoteResourceState: () => ({ status: 'ready', error: '' }),
    getRemoteCollectionSummary: () => ({ total: 3, facets: [{ subjectId: 'subject-1', subjectName: '科目', questionBankId: 'bank-1', questionBankName: '题库', count: 3 }] }),
    previewRemotePracticeScope: async (storage, scope) => { requestedScope = scope; return { availableCount: 2 } }
  }
  const vm = new WrongBookViewModel({ repository, storage: {} })
  const result = await vm.createPracticeCommand()
  assert.strictEqual(requestedScope.questionBankId, 'bank-1')
  assert.strictEqual(requestedScope.selectionKind, 'WRONG')
  assert.strictEqual(requestedScope.count, 1000)
  assert(result.command.url.includes('count=2'))

  const values = { qandaAuth: { provider: 'email', userId: 'user-1', token: 'token-1' } }
  const storage = { get: key => values[key], set: (key, value) => { values[key] = value }, remove: key => { delete values[key] } }
  remoteData.enable(true)
  api.configure({ baseUrl: 'https://example.test', tokenProvider: () => values.qandaAuth.token })
  global.wx = { request: request => {
    assert.strictEqual(request.url, 'https://example.test/api/v1/practice/scope-preview')
    assert.strictEqual(request.method, 'POST')
    assert.strictEqual(request.header.Authorization, 'Bearer token-1')
    assert.strictEqual(request.data.questionBankId, 'bank-1')
    request.success({ statusCode: 200, data: { availableCount: 2, contentVersion: 1 } })
  } }
  assert.strictEqual((await remoteData.previewPracticeScope(storage, requestedScope)).availableCount, 2)
  global.wx.request = request => {
    values.qandaAuth = { provider: 'email', userId: 'user-2', token: 'token-2' }
    request.success({ statusCode: 200, data: { availableCount: 2, contentVersion: 1 } })
  }
  await assert.rejects(() => remoteData.previewPracticeScope(storage, requestedScope), /账号已切换/)
  delete global.wx
  api.configure({ baseUrl: '', tokenProvider: null })
  remoteData.enable(false)
  console.log('wrong-book practice uses server-eligible question count')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
