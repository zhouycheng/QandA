const httpGateway = require('./http-gateway.js')

const CHANNELS = ['login', 'loginByEmail', 'register', 'sendCode', 'resetPassword', 'registerWechat']

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

  return httpGateway.isConfigured() ? 'http' : 'unconfigured'
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
    return {
      ok: false,
      unavailable: true,
      reason: '未配置接口域名'
    }
  }

  return httpGateway[channel].apply(httpGateway, args)
}

function login(code, options) {
  const credential = typeof code === 'string' ? code : ''

  if (!credential) {
    return {
      ok: false,
      reason: '未取到微信登录凭证'
    }
  }

  return dispatch('login', [credential, options])
}

function loginByEmail(email, password, options) {
  return dispatch('loginByEmail', [email || '', password || '', options])
}

function register(input) {
  return dispatch('register', [input || {}])
}

function registerWechat(input) { return dispatch('registerWechat', [input || {}]) }

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
  registerWechat,
  resetAuthGateway,
  resetPassword,
  sendCode,
  setAuthGateway
}
