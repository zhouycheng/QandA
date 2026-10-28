const config = { baseUrl: '', timeout: 10000, tokenProvider: null }
const pending = []
let active = 0

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
function pump() {
  while (active < 4 && pending.length) {
    const task = pending.shift()
    active += 1
    Promise.resolve().then(task.run).then(task.resolve, () => task.resolve(failure('网络请求失败，请稍后重试'))).then(() => { active -= 1; pump() })
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
    pending.push({ resolve, run: () => {
      if (!config.baseUrl) return failure('未配置接口域名')
      const wxApi = typeof wx !== 'undefined' && wx
      if (!wxApi || typeof wxApi.request !== 'function') return failure('当前环境不支持网络请求')
      return new Promise((done) => wxApi.request({ url, method, data: body, header: headers, timeout: config.timeout,
        success(response) {
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
      }))
    } })
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
module.exports = { configure, getConfig, getAll, isConfigured: () => !!config.baseUrl, request, uuid }
