const {
  AUTH_STORAGE_KEY,
  applyProfile,
  buildDevAuth,
  buildEmailAuth,
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

/* ==================== 邮箱密码通道（设计稿 763:567 / 772:1036 / 772:1076） ==================== */

/**
 * 把网关调用收成 Promise：同步普通对象、Promise、抛错三种形态统一成
 * `{ ok, reason, unavailable }`。网关层「没配域名返回普通对象」的快路径就是靠这里抹平的。
 *
 * `unavailable` 表示**没接上后端**（网关抛错、未配域名、连不上），
 * 与「后端明确拒绝」区分开 —— 只有前者才允许降级成本地身份。
 */
function callGateway(fn, fallbackReason) {
  const failure = { ok: false, unavailable: true, reason: fallbackReason || '登录接口异常' }

  return new Promise((resolve) => {
    let outcome = null

    try {
      outcome = fn()
    } catch (error) {
      resolve(failure)
      return
    }

    if (outcome && typeof outcome.then === 'function') {
      outcome.then(
        (remote) => resolve(remote || failure),
        () => resolve(failure)
      )
      return
    }

    resolve(outcome || failure)
  })
}

/**
 * 邮箱身份落库。
 *
 * **只存邮箱、id、token，永远不存密码** —— 端上没有任何理由保存密码，
 * 存了就多一个泄漏面，而且后端接入后也没法校验本地副本。
 *
 * 降级只发生在「没接上后端」（`unavailable`）时：这时用邮箱派生的稳定 id
 * 当本地身份，用户至少能把注册/登录流程走完、数据落在本机。
 * 后端**明确拒绝**（密码错、邮箱已注册、验证码不对）必须原样报错，
 * 否则接上后端之后输错密码也会被当成登录成功，那是更严重的错。
 */
function settleEmailAuth(storage, remote, fallbackEmail) {
  const ok = !!(remote && remote.ok)
  const email = (remote && remote.email) || fallbackEmail || ''

  if (!ok && !(remote && remote.unavailable)) {
    return {
      ok: false,
      degraded: false,
      provider: '',
      reason: (remote && remote.reason) || '登录失败，请检查邮箱与密码',
      auth: getAuth(storage)
    }
  }

  const auth = saveAuth(
    storage,
    buildEmailAuth({
      email,
      userId: ok ? remote.userId : '',
      token: ok ? remote.token : '',
      nickname: ok ? remote.nickname : '',
      avatarUrl: ok ? remote.avatarUrl : ''
    })
  )

  return {
    ok: true,
    degraded: !ok,
    provider: auth.provider,
    // reason 保留网关原话（未配置接口域名 / 请求超时 …）供排查；
    // note 才是页面上给用户看的那一句，不能把「未配置接口域名」摊给普通用户
    reason: ok ? '' : (remote && remote.reason) || '登录接口不可用',
    note: ok ? '' : '后端未接入，已用本地身份登录',
    auth
  }
}

function loginWithEmail(storage, options) {
  const payload = options || {}
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''

  if (!email) {
    return Promise.resolve({
      ok: false,
      reason: '请输入邮箱',
      auth: getAuth(storage)
    })
  }

  return callGateway(
    () => authGateway.loginByEmail(email, payload.password || ''),
    '登录接口异常'
  ).then((remote) => settleEmailAuth(storage, remote, email))
}

/** 注册成功后直接进登录态：让用户注册完还要再登一次是多余的 */
function register(storage, options) {
  const payload = options || {}
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''

  return callGateway(
    () => authGateway.register({ email, code: payload.code || '', password: payload.password || '' }),
    '注册接口异常'
  ).then((remote) => settleEmailAuth(storage, remote, email))
}

/**
 * 发送验证码。
 * 后端未接入时**照样算成功**并说明原因：否则「注册」这条路在联调前完全走不通，
 * 而验证码本身在本地身份模式下没有校验意义。
 * 但后端明确报错（邮箱不存在 / 发送过于频繁）不能吞掉，要原样返回。
 */
function sendCode(storage, options) {
  const payload = options || {}
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const purpose = payload.purpose === 'reset' ? 'reset' : 'register'

  if (!email) {
    return Promise.resolve({ ok: false, unavailable: false, degraded: false, reason: '请输入邮箱' })
  }

  return callGateway(
    () => authGateway.sendCode({ email, purpose }),
    '验证码接口异常'
  ).then((remote) => {
    const ok = !!(remote && remote.ok)

    if (!ok && !(remote && remote.unavailable)) {
      return {
        ok: false,
        degraded: false,
        cooldown: 0,
        reason: (remote && remote.reason) || '验证码发送失败，请稍后重试'
      }
    }

    return {
      ok: true,
      degraded: !ok,
      cooldown: Number(remote && remote.cooldown) > 0 ? Number(remote.cooldown) : 60,
      reason: ok ? '' : '后端未接入，验证码校验已跳过'
    }
  })
}

/**
 * 重置密码。
 * 成功与否都不改登录态：设计稿明确写了「重置成功后，请使用新密码登录」。
 */
function resetPassword(storage, options) {
  const payload = options || {}

  return callGateway(
    () => authGateway.resetPassword({
      email: payload.email || '',
      code: payload.code || '',
      password: payload.password || ''
    }),
    '重置接口异常'
  ).then((remote) => {
    const ok = !!(remote && remote.ok)

    if (!ok && !(remote && remote.unavailable)) {
      return {
        ok: false,
        degraded: false,
        reason: (remote && remote.reason) || '重置失败，请检查验证码'
      }
    }

    return {
      ok: true,
      degraded: !ok,
      reason: ok ? '' : '后端未接入，密码未实际修改'
    }
  })
}

module.exports = {
  AUTH_STORAGE_KEY,
  clearAuth,
  getAuth,
  login,
  loginWithEmail,
  logout,
  register,
  resetPassword,
  saveAuth,
  sendCode,
  updateProfile
}
