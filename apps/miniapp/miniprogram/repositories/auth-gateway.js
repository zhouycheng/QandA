const httpGateway = require('./http-gateway.js')

/**
 * 登录网关：真后端 ⇄ 本地身份的切换边界（对齐 API PRD 第 19 节）。
 *
 * 与 practice-gateway 一样，页面和 ViewModel 不感知具体走哪条路：
 *   - 配了接口域名  → 打真接口
 *   - 没配 / 调不通 → 返回失败，由 auth-repository 降级
 *
 * 五个通道（对齐设计稿 763:567 / 772:1036 / 772:1076）：
 *   login         微信 code 换身份
 *   loginByEmail  邮箱 + 密码
 *   register      邮箱 + 验证码 + 密码
 *   sendCode      发送邮箱验证码
 *   resetPassword 邮箱 + 验证码 + 新密码
 *
 * ⚠️ **同步快路径**：没配域名时返回**普通对象**而不是 Promise。
 * 「没配域名」在当下是常态（apps/api 还没落地），包成 Promise 会让登录
 * 凭空多一次微任务，也让所有单测必须 await；调用方用
 * `typeof outcome.then === 'function'` 分流即可，两条路径共用一套结果处理。
 *
 * 注入口 `setAuthGateway` 只给测试与 Playground 用，业务代码不要调。
 */

const CHANNELS = ['login', 'loginByEmail', 'register', 'sendCode', 'resetPassword']

let override = null

function hasChannel(gateway, channel) {
  return gateway && typeof gateway[channel] === 'function'
}

function setAuthGateway(gateway) {
  const usable = CHANNELS.some((channel) => hasChannel(gateway, channel))

  override = usable ? gateway : null

  return getAuthGatewayName()
}

function resetAuthGateway() {
  override = null

  return getAuthGatewayName()
}

function getAuthGatewayName() {
  if (override) {
    return override.name || 'custom'
  }

  return httpGateway.isConfigured() ? 'http' : 'dev'
}

function isConfigured() {
  return !!override || httpGateway.isConfigured()
}

/** 统一分流：注入口优先 → 未配域名同步返回失败 → 真实 HTTP */
function dispatch(channel, args) {
  if (hasChannel(override, channel)) {
    return override[channel].apply(override, args)
  }

  if (!httpGateway.isConfigured()) {
    // unavailable 是「压根没接后端」，与「后端明确拒绝」是两件事：
    // 前者允许降级成本地身份，后者必须把后端的原话报给用户
    return {
      ok: false,
      unavailable: true,
      reason: '未配置接口域名'
    }
  }

  return httpGateway[channel].apply(httpGateway, args)
}

function login(code) {
  const credential = typeof code === 'string' ? code : ''

  if (!credential) {
    return {
      ok: false,
      reason: '未取到微信登录凭证'
    }
  }

  return dispatch('login', [credential])
}

function loginByEmail(email, password) {
  return dispatch('loginByEmail', [email || '', password || ''])
}

function register(input) {
  return dispatch('register', [input || {}])
}

function sendCode(input) {
  return dispatch('sendCode', [input || {}])
}

function resetPassword(input) {
  return dispatch('resetPassword', [input || {}])
}

module.exports = {
  getAuthGatewayName,
  isConfigured,
  login,
  loginByEmail,
  register,
  resetAuthGateway,
  resetPassword,
  sendCode,
  setAuthGateway
}
