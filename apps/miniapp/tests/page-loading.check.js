const assert = require('node:assert/strict')
const { observable, runInAction } = require('mobx-miniprogram')
const { createResourceCache, queryKey } = require('../miniprogram/repositories/resource-cache.js')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function cacheChecks() {
  const cache = createResourceCache()
  const key = queryKey('banks', { page: 1, subjectId: 's1' })
  assert.equal(key, queryKey('banks', { subjectId: 's1', page: 1, keyword: undefined }))
  let resolve, calls = 0, published
  const request = () => { calls++; return new Promise(done => { resolve = done }) }
  const one = cache.load(key, 300000, request, data => { published = data })
  assert.equal(cache.load(key, 300000, request), one)
  await tick(); assert.equal(calls, 1)
  resolve({ items: [1], total: 100 }); await one
  assert.deepEqual(await cache.load(key, 300000, request), published)
  assert.equal(calls, 1, '有效缓存不发请求')
  await assert.rejects(cache.load(key, 300000, () => Promise.reject(new Error('慢网失败')), null, true))
  assert.equal(cache.read(key).status, 'error')
  assert.deepEqual(cache.read(key).data.items, [1], '失败时保留可用内容')
  const stale = cache.load(key, 0, request, data => { published = data }, true)
  await tick()
  cache.invalidate('banks:')
  await cache.load(key, 300000, () => Promise.resolve({ items: [2] }), data => { published = data })
  resolve({ items: [0] }); await stale
  assert.deepEqual(published.items, [2], '写操作失效后，旧读取响应不能覆盖新数据')
  const oldOwner = cache.load('profile:{}', 0, request, data => { published = data })
  await tick(); cache.clear(); resolve({ secret: 'old-user' }); await oldOwner
  assert.equal(cache.read('profile:{}').status, 'idle')
  assert.deepEqual(published.items, [2])
}

async function transportChecks() {
  const api = require('../miniprogram/repositories/api-transport.js')
  const calls = [], active = new Set()
  let maximum = 0, backgroundMaximum = 0
  global.wx = { request(options) {
    const entry = { options, finish() { active.delete(entry); options.success({ statusCode: 200, data: {} }) } }
    calls.push(entry); active.add(entry)
    maximum = Math.max(maximum, active.size)
    backgroundMaximum = Math.max(backgroundMaximum, [...active].filter(e => e.options.url.includes('/background')).length)
    return { abort() { active.delete(entry); options.fail({ errMsg: 'aborted' }) } }
  } }
  api.configure({ baseUrl: 'https://fixture.example.test', tokenProvider: () => 'fixture-token' })
  const jobs = Array.from({ length: 5 }, (_, i) => api.request('PUT', '/background/' + i, {}, { priority: 'background', idempotencyKey: 'same-' + i }))
  jobs.push(...Array.from({ length: 6 }, (_, i) => api.request('GET', '/foreground/' + i)))
  await tick(); assert.equal(active.size, 4)
  assert.equal(calls.filter(e => e.options.url.includes('background')).length, 1)
  calls[1].finish(); await tick()
  assert.ok(calls[4].options.url.includes('foreground'), '有槽位时前台请求优先')
  while (active.size) { [...active].forEach(entry => entry.finish()); await tick() }
  await Promise.all(jobs)
  assert.equal(maximum, 4); assert.equal(backgroundMaximum, 1)
  const reads = Array.from({ length: 6 }, (_, i) => api.request('GET', '/stale/' + i))
  const write = api.request('POST', '/write', { answer: 'kept' }, { idempotencyKey: 'fixed-write' })
  await tick(); api.cancelReads(); await tick()
  assert.equal(active.size, 1, '切换账号只取消读取，写请求继续完成')
  const inFlightWrite = [...active][0]
  assert.equal(inFlightWrite.options.header['Idempotency-Key'], 'fixed-write')
  inFlightWrite.finish(); await write
  assert.ok((await Promise.all(reads)).every(result => !result.ok))
}

async function bindingAndRouteChecks() {
  global.Behavior = definition => definition
  const nextTicks = []
  const routes = []
  global.wx = { nextTick: cb => nextTicks.push(cb), navigateTo: options => routes.push(options), switchTab: options => routes.push(options), showToast() {} }
  const { bindViewModel, stopBinding, withPageLifecycle } = require('../miniprogram/utils/page-lifecycle.js')
  const state = observable({ label: 'cached', answer: 'private' })
  const rendered = []
  const page = { viewModel: { projectRemote: () => ({ label: state.label }) }, applyViewModelResult: result => rendered.push(result.data) }
  const flush = () => { while (nextTicks.length) nextTicks.shift()() }
  bindViewModel(page); flush()
  assert.deepEqual(rendered.at(-1), { label: 'cached' })
  const count = rendered.length
  runInAction(() => { state.label = 'first'; state.label = 'latest'; state.answer = 'still-private' })
  flush(); assert.equal(rendered.length, count + 1); assert.deepEqual(rendered.at(-1), { label: 'latest' })
  runInAction(() => { state.label = 'queued' }); stopBinding(page); flush()
  assert.equal(rendered.length, count + 1, '隐藏后拒绝尚未送出的页面更新')
  bindViewModel(page); flush(); assert.equal(rendered.at(-1).label, 'queued'); stopBinding(page)
  const modal = { data: { announcementSheetVisible: true, sheet: 'privacy' }, setData(patch) { Object.assign(this.data, patch) } }
  withPageLifecycle({}).onHide.call(modal)
  assert.equal(modal.data.announcementSheetVisible, false); assert.equal(modal.data.sheet, '')
  const navigation = require('../miniprogram/utils/navigation.js')
  assert.equal(navigation.navigateTo({ url: '/page/settings/index?focus=exam', fail: () => navigation.switchTab({ url: '/page/subject-list/index' }) }), true)
  assert.equal(routes.length, 1, '点击后同步调用原生路由')
  assert.equal(navigation.navigateTo('/page/settings/index'), false)
  routes[0].fail({}); routes[0].complete({})
  assert.equal(routes.length, 2, '失败后可立即执行回退路由')
  assert.equal(navigation.navigateTo('/page/settings/index'), false, '旧请求 complete 不解锁新请求')
  routes[1].complete({})
  assert.equal(navigation.navigateTo('/page/settings/index'), true); routes[2].complete({})
  navigation.switchTab({ url: '/page/bank-detail/index', success: () => navigation.navigateTo('/page/login/index') })
  routes[3].success({}); routes[3].complete({})
  assert.equal(routes.length, 5, '成功返回题库后可以立即进入登录')
  assert.equal(navigation.navigateTo('/page/settings/index'), false, '前一次完成回调保留登录跳转锁')
  routes[4].complete({})
}

async function settingsChecks() {
  let definition, requests = 0
  const values = {}
  global.Page = page => { definition = page }
  global.getApp = () => ({ globalData: { version: '1.0.0' } })
  global.wx = Object.assign(global.wx, { getStorageSync: key => values[key], setStorageSync: (key, value) => { values[key] = value }, getStorageInfoSync: () => ({ keys: [] }), request() { requests++ } })
  for (const name of ['settings', 'practice-layout', 'exam-countdown', 'reminder']) {
    require('../miniprogram/page/' + name + '/index.js')
    const page = Object.assign({}, definition, { data: Object.assign({}, definition.data), measure() {}, setData(patch, done) { Object.assign(this.data, patch); if (done) done() } })
    page.onLoad({}); page.onShow(); page.onReady()
    assert.equal(requests, 0, name + ' 进入零 HTTP 请求')
    if (name === 'settings') {
      assert.equal(page.data.choices.length, 1)
      assert.equal(page.data.exam, undefined, '答题偏好只加载自身设置')
    }
    assert(Object.values(page.data).every(value => value !== undefined), name + ' 展示字段均有默认值')
    page.onUnload()
  }
}

async function reviewAccessChecks() {
  const { StatsViewModel } = require('../miniprogram/viewmodels/stats-viewmodel.js')
  const values = {}, reads = []
  const storage = { get: key => values[key], set: (key, value) => { values[key] = value } }
  const repository = Object.assign({}, require('../miniprogram/repositories/practice-repository.js'), {
    isRemoteEnabled: () => true,
    getProgress() { reads.push('progress'); return {} },
    getRemoteStatistics: () => null,
    getRemoteOverview: () => null,
    refreshRemote() { reads.push('request'); return Promise.resolve() }
  })
  const vm = new StatsViewModel({ storage, repository })
  assert.equal(vm.load().data.requiresLogin, true)
  await vm.refreshRemote()
  assert.deepEqual(reads, [], '游客复盘不读取个人缓存或请求统计')
  storage.set('qandaAuth', { provider: 'email', userId: 'review-test', token: 'review-test-token' })
  assert.equal(vm.load().data.requiresLogin, false)
  await vm.refreshRemote()
  assert.equal(reads.filter(item => item === 'request').length, 1, '登录后加载统计')
  delete values.qandaAuth
  const locked = vm.projectRemote()
  assert.equal(locked.requiresLogin, true)
  assert.equal(locked.statsLoading, false)
  assert.equal(locked.statsError, '')
  let definition, target
  global.Page = value => { definition = value }
  global.wx.navigateTo = options => { target = options.url; options.complete({}) }
  require('../miniprogram/page/stats/index.js')
  definition.handleLoginTap.call({ route: 'page/stats/index' })
  assert.equal(target, '/page/login/index', '复盘登录按钮立即使用原生路由')
}

async function pagingChecks() {
  const { BankDetailViewModel } = require('../miniprogram/viewmodels/bank-detail-viewmodel.js')
  const pages = []
  let failed = true
  const repository = {
    isRemoteEnabled: () => true,
    getRemoteCatalogPage: ({ page }) => ({ error: page === 2 && failed ? '连接中断' : '' }),
    getRemoteSubjectPage: page => ({ error: page === 2 && failed ? '连接中断' : '' }),
    refreshRemote: (_, kind, options) => { pages.push(options.page); return Promise.resolve() },
    loadRemoteSubjects: (_, options) => { pages.push(options.page); return Promise.resolve() }
  }
  const vm = new BankDetailViewModel({ repository })
  vm.projectRemote = () => ({})
  await vm.loadMoreBanks(); await vm.loadMoreBanks()
  assert.deepEqual(pages.splice(0), [2, 2], '失败重试仍然读取第二页')
  await vm.loadMoreSubjects(); await vm.loadMoreSubjects()
  assert.deepEqual(pages.splice(0), [2, 2])
  failed = false
  await vm.loadMoreBanks(); await vm.loadMoreSubjects()
  assert.deepEqual(pages, [3, 3])
}

async function favoriteFailureChecks() {
  const { PracticeViewModel } = require('../miniprogram/viewmodels/practice-viewmodel.js')
  const repository = Object.assign({}, require('../miniprogram/repositories/practice-repository.js'), {
    addQuestionFavorite: () => Promise.reject(new Error('保存失败'))
  })
  const vm = new PracticeViewModel({ repository })
  vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  await assert.rejects(vm.toggleFavoriteQuestion(), /保存失败/)
  assert.equal(vm.session.getViewData().isCurrentQuestionFavorite, false, '失败后保持原收藏状态')
  assert.equal(vm.session.state.favoriteQuestionIds.length, 0)
}

async function main() {
  await cacheChecks(); await transportChecks(); await bindingAndRouteChecks(); await settingsChecks(); await reviewAccessChecks(); await pagingChecks(); await favoriteFailureChecks()
  console.log('page-loading checks passed: cache, account isolation, scheduling, bindings, native navigation, settings')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
