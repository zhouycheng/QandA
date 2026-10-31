const metrics = require('../utils/loading-metrics.js')
const config = { baseUrl: '', timeout: 10000, tokenProvider: null }
const pending = []
let active = 0
let backgroundActive = 0
let readGeneration = 0
const runningReads = new Set()

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16)
    return (c === 'x' ? n : (n & 3) | 8).toString(16)
  })
}
function configure(options) {
  const input = options || {}
  if (typeof input.baseUrl === 'string') config.baseUrl = input.baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  if (Number(input.timeout) > 0) config.timeout = Number(input.timeout)
  if (Object.prototype.hasOwnProperty.call(input, 'tokenProvider')) config.tokenProvider = input.tokenProvider
  return getConfig()
}
function getConfig() { return { baseUrl: config.baseUrl, timeout: config.timeout } }
function failure(reason) { return { ok: false, unavailable: true, statusCode: 0, data: null, reason } }
function retryAfter(headers) {
  const raw = headers['retry-after']
  if (!raw) return 0
  return /^\d+$/.test(String(raw)) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - Date.now()) || 0
}
function cancelReads() {
  readGeneration += 1
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    if (pending[i].read) pending.splice(i, 1)[0].resolve(Object.assign(failure('读取已取消'), { cancelled: true }))
  }
  runningReads.forEach(task => { if (task.handle && task.handle.abort) task.handle.abort() })
}
function pump() {
  while (active < 4 && pending.length) {
    let index = pending.findIndex(task => !task.background)
    if (index < 0) index = backgroundActive < 1 ? 0 : -1
    if (index < 0) break
    const task = pending.splice(index, 1)[0]
    active += 1
    if (task.background) backgroundActive += 1
    if (task.read) runningReads.add(task)
    metrics.record('request-start', { path: task.path, queueMs: Date.now() - task.queuedAt, active, backgroundActive })
    Promise.resolve().then(task.run).then(task.resolve, () => task.resolve(failure('网络请求失败，请稍后重试'))).then(() => {
      active -= 1
      if (task.background) backgroundActive -= 1
      runningReads.delete(task)
      metrics.record('request-end', { path: task.path, elapsedMs: Date.now() - task.queuedAt })
      pump()
    })
  }
}
function request(method, path, data, options) {
  const settings = options || {}
  const requestId = uuid()
  const token = Object.prototype.hasOwnProperty.call(settings, 'token') ? settings.token : (config.tokenProvider ? config.tokenProvider() : '')
  const headers = Object.assign({ 'content-type': 'application/json', 'X-Request-Id': requestId }, settings.headers || {})
  if (token) headers.Authorization = `Bearer ${token}`
  if (settings.idempotencyKey) headers['Idempotency-Key'] = settings.idempotencyKey
  const body = data === undefined ? {} : JSON.parse(JSON.stringify(data))
  const url = `${config.baseUrl}${path.indexOf('/api/v1') === 0 ? path : `/api/v1${path}`}`
  return new Promise((resolve) => {
    const task = { resolve, path: path.split('?')[0], queuedAt: Date.now(), background: settings.priority === 'background', read: method === 'GET', generation: readGeneration, run: () => {
      if (task.read && task.generation !== readGeneration) return Object.assign(failure('读取已取消'), { cancelled: true })
      if (!config.baseUrl) return failure('未配置接口域名')
      const wxApi = typeof wx !== 'undefined' && wx
      if (!wxApi || typeof wxApi.request !== 'function') return failure('当前环境不支持网络请求')
      return new Promise((done) => { task.handle = wxApi.request({ url, method, data: body, header: headers, timeout: config.timeout,
        success(response) {
          if (task.read && task.generation !== readGeneration) return done(Object.assign(failure('读取已取消'), { cancelled: true }))
          const statusCode = Number(response.statusCode) || 0
          const payload = response.data === undefined ? null : response.data
          const responseHeaders = {}
          Object.keys(response.header || {}).forEach((key) => { responseHeaders[key.toLowerCase()] = response.header[key] })
          done({ ok: statusCode >= 200 && statusCode < 300, unavailable: statusCode === 0, statusCode, data: payload,
            code: payload && payload.code || '', reason: statusCode >= 200 && statusCode < 300 ? '' : payload && payload.message || `请求失败（${statusCode}）`,
            requestId: responseHeaders['x-request-id'] || requestId, retryAfter: retryAfter(responseHeaders), headers: responseHeaders })
        },
        fail(error) {
          const message = error && error.errMsg || ''
          done(failure(/not in domain/i.test(message) ? '接口域名未加入小程序后台的合法域名' : /timeout/i.test(message) ? '请求超时，请稍后重试' : /ssl|certificate/i.test(message) ? '接口证书校验失败，请使用 HTTPS 证书' : '网络请求失败，请检查网络后重试'))
        }
      }) })
    } }
    pending.push(task)
    pump()
  })
}
async function getAll(path, query, options) {
  let page = 1
  const items = []
  while (true) {
    const result = await request('GET', path, Object.assign({}, query || {}, { page, pageSize: 100 }), options)
    if (!result.ok) return result
    const data = result.data || {}
    const batch = Array.isArray(data) ? data : data.items || []
    items.push.apply(items, batch)
    if (Array.isArray(data) || items.length >= data.total || batch.length < 100) return Object.assign({}, result, { data: items })
    page += 1
  }
}
module.exports = { cancelReads, configure, getConfig, getAll, isConfigured: () => !!config.baseUrl, request, uuid }
