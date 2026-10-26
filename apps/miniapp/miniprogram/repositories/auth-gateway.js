const httpGateway = require('./http-gateway.js')

/**
 * 登录网关：真后端 ⇄ 本地身份的切换边界（对齐 API PRD 第 19 节）。
 *
 * 与 practice-gateway 一样，页面和 ViewModel 不感知具体走哪条路：
 *   - 配了接口域名  → POST /api/auth/login，后端拿 code 换 openid 后下发身份
 *   - 没配 / 调不通 → 返回失败，由 auth-repository 降级成本地身份
 *
 * ⚠️ **同步快路径**：没配域名时返回**普通对象**而不是 Promise。
 * 「没配域名」在当下是常态（apps/api 还没落地），包成 Promise 会让登录
 * 凭空多一次微任务，也让所有单测必须 await；调用方用
 * `typeof outcome.then === 'function'` 分流即可，两条路径共用一套结果处理。
 *
 * 注入口 `setAuthGateway` 只给测试与 Playground 用，业务代码不要调。
 */

let override = null

function setAuthGateway(gateway) {
  override = gateway && typeof gateway.login === 'function' ? gateway : null

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

function login(code) {
  const credential = typeof code === 'string' ? code : ''

  if (!credential) {
    return {
      ok: false,
      reason: '未取到微信登录凭证'
    }
  }

  if (override) {
    return override.login(credential)
  }

  if (!httpGateway.isConfigured()) {
    return {
      ok: false,
      reason: '未配置接口域名'
    }
  }

  return httpGateway.login(credential)
}

module.exports = {
  getAuthGatewayName,
  login,
  resetAuthGateway,
  setAuthGateway
}
