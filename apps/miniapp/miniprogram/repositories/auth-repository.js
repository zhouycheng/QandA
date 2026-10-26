const {
  AUTH_STORAGE_KEY,
  applyProfile,
  buildDevAuth,
  buildWechatAuth,
  createEmptyAuth,
  normalizeAuth
} = require('../utils/auth-session.js')
const authGateway = require('./auth-gateway.js')

/**
 * 仓储层：登录态的唯一读写出口。
 *
 * 三条硬约束：
 * 1. **不在模块顶层碰 `wx`** —— 本文件要能在 Node 里 require 跑断言，
 *    取 `wx` 一律放到调用时，通过注入的 codeProvider 解耦。
 * 2. **降级也是登录成功**：拿不到 code / 后端没配 / 接口报错，
 *    一律落到本地身份（DevAuthProvider），返回 `ok: true, degraded: true`。
 *    用户点了登录却弹「登录失败」，只会以为功能坏了。
 * 3. **降级身份 id 要复用**：同一台机器反复登录不该每次换一个新 id，
 *    否则本机数据看起来像换了个用户。
 */

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getStorageAdapter(storage) {
  return storage || createNullStorage()
}

function getAuth(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(AUTH_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeAuth(raw)
}

function saveAuth(storage, auth) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizeAuth(auth)

  try {
    adapter.set(AUTH_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

function clearAuth(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(AUTH_STORAGE_KEY)
  } catch (error) {
    // 清不掉也把内存态清干净，界面不该停留在已登录
  }

  return createEmptyAuth()
}

/** 改昵称 / 头像：未登录时是空操作，返回空身份让界面提示先登录 */
function updateProfile(storage, profile) {
  const current = getAuth(storage)

  if (!current.loggedIn) {
    return {
      ok: false,
      reason: '请先登录',
      auth: current
    }
  }

  const next = saveAuth(storage, applyProfile(current, profile))

  return {
    ok: true,
    reason: '',
    auth: next
  }
}

function logout(storage) {
  clearAuth(storage)

  return {
    ok: true,
    provider: '',
    auth: createEmptyAuth()
  }
}

/**
 * 默认取 code 的方式：wx.login。
 * 抽成回调是为了让测试能注入 —— wx.login 在 Node 里根本不存在，
 * 不注入就只能改全局 mock，那样断言会互相污染。
 */
function defaultCodeProvider(done) {
  const wxApi = typeof wx !== 'undefined' && wx ? wx : null

  if (!wxApi || typeof wxApi.login !== 'function') {
    done('', 'no-wx')
    return
  }

  wxApi.login({
    timeout: 10000,
    success: (res) => done(res && res.code ? res.code : '', res && res.errMsg),
    fail: (error) => done('', error && error.errMsg)
  })
}

function describeCodeError(errMsg) {
  const text = typeof errMsg === 'string' ? errMsg : ''

  if (text === 'no-wx') {
    return '当前环境不支持微信登录'
  }

  if (/domain|appid|权限/i.test(text)) {
    return '小程序未获得登录权限'
  }

  if (/timeout/i.test(text)) {
    return '微信登录超时'
  }

  return '未取到微信登录凭证'
}

/** 降级成本地身份：沿用已有的 dev id 与资料，只刷新登录时间 */
function degrade(storage, reason) {
  const current = getAuth(storage)
  const keepIdentity = current.loggedIn && current.provider === 'dev' && !!current.userId

  const auth = saveAuth(
    storage,
    buildDevAuth({
      userId: keepIdentity ? current.userId : '',
      nickname: keepIdentity ? current.nickname : '',
      avatarUrl: keepIdentity ? current.avatarUrl : ''
    })
  )

  return {
    ok: true,
    degraded: true,
    provider: auth.provider,
    reason: reason || '已使用本地身份继续',
    auth
  }
}

function settle(storage, remote) {
  if (!remote || !remote.ok) {
    return degrade(storage, (remote && remote.reason) || '登录接口不可用')
  }

  const auth = saveAuth(storage, buildWechatAuth(remote))

  return {
    ok: true,
    degraded: false,
    provider: auth.provider,
    reason: '',
    auth
  }
}

/**
 * 登录。始终返回 Promise —— wx.login 本身就是异步的，
 * 硬凑同步快路径只会让调用方写出两套分支。
 */
function login(storage, options) {
  const payload = options || {}
  const codeProvider = typeof payload.codeProvider === 'function' ? payload.codeProvider : defaultCodeProvider

  return new Promise((resolve) => {
    codeProvider((code, codeError) => {
      if (!code) {
        resolve(degrade(storage, describeCodeError(codeError)))
        return
      }

      let outcome = null

      try {
        outcome = authGateway.login(code)
      } catch (error) {
        resolve(degrade(storage, '登录接口异常'))
        return
      }

      if (outcome && typeof outcome.then === 'function') {
        // 用两参数 then 而不是 .catch：reject 也落到降级，别把异常抛到页面
        outcome.then(
          (remote) => resolve(settle(storage, remote)),
          () => resolve(degrade(storage, '登录接口异常'))
        )
        return
      }

      resolve(settle(storage, outcome))
    })
  })
}

module.exports = {
  AUTH_STORAGE_KEY,
  clearAuth,
  getAuth,
  login,
  logout,
  saveAuth,
  updateProfile
}
