const { AUTH_STORAGE_KEY, applyProfile, buildEmailAuth, buildWechatAuth, createEmptyAuth, normalizeAuth } = require('../utils/auth-session.js')
const authGateway = require('./auth-gateway.js')
const transport = require('./api-transport.js')
const DEVICE_KEY = 'qandaDeviceId'
const CHALLENGE_KEY = 'qandaEmailChallenges'
function getAuth(storage) {
  try {
    const auth = normalizeAuth(storage && storage.get(AUTH_STORAGE_KEY))
    return auth.userId && auth.token && auth.provider !== 'dev' ? auth : createEmptyAuth()
  } catch (error) { return createEmptyAuth() }
}
function saveAuth(storage, auth) {
  const normalized = normalizeAuth(auth)
  if (!storage || typeof storage.set !== 'function') throw new Error('无法保存登录状态')
  storage.set(AUTH_STORAGE_KEY, normalized)
  return normalized
}
function clearAuth(storage) {
  if (storage) storage.remove(AUTH_STORAGE_KEY)
  return createEmptyAuth()
}
function deviceId(storage) {
  let value = storage.get(DEVICE_KEY)
  if (!value) { value = transport.uuid(); storage.set(DEVICE_KEY, value) }
  return value
}
function failure(storage, reason) { return { ok: false, degraded: false, reason: reason || '请求失败，请稍后重试', auth: getAuth(storage) } }
function settle(storage, remote, provider) {
  if (!remote || !remote.ok || !remote.userId || !remote.token) return failure(storage, remote && remote.reason || '登录接口未返回完整身份')
  const auth = provider === 'email' ? buildEmailAuth(remote) : buildWechatAuth(remote)
  auth.profile = remote.profile || null
  auth.version = remote.version || remote.profile && remote.profile.version || 0
  try { return { ok: true, degraded: false, provider, reason: '', auth: saveAuth(storage, auth) } }
  catch (error) { return failure(storage, '登录状态保存失败，请检查设备存储空间') }
}
function defaultCodeProvider(done) {
  if (typeof wx === 'undefined' || !wx || !wx.login) { done('', '当前环境不支持微信登录'); return }
  wx.login({ timeout: 10000, success: (result) => done(result.code || ''), fail: () => done('', '微信登录失败，请稍后重试') })
}
function call(fn) { return Promise.resolve().then(fn).then((result) => result || { ok: false, reason: '请求失败，请稍后重试' }).catch(() => ({ ok: false, reason: '网络请求失败，请稍后重试' })) }
function login(storage, options) {
  const settings = options || {}
  return new Promise((resolve) => {
    try {
      (settings.codeProvider || defaultCodeProvider)((code, reason) => {
        if (!code) { resolve(failure(storage, reason || '未取到微信登录凭证')); return }
        call(() => authGateway.login(code, { deviceId: deviceId(storage) })).then(async (remote) => {
          if (remote.registrationToken) {
            const registered = await call(() => authGateway.registerWechat({ registrationToken: remote.registrationToken }))
            if (!registered.ok) { resolve(failure(storage, registered.reason)); return }
            // WeChat login codes are single-use; registration needs a fresh code for its session.
            try {
              (settings.codeProvider || defaultCodeProvider)((freshCode, freshError) => {
                if (!freshCode) { resolve(failure(storage, freshError || '注册完成，请重新登录')); return }
                call(() => authGateway.login(freshCode, { deviceId: deviceId(storage) })).then((session) => resolve(settle(storage, session, 'wechat')))
              })
            } catch (error) { resolve(failure(storage, '注册完成，请重新登录')) }
            return
          }
          resolve(settle(storage, remote, 'wechat'))
        })
      })
    } catch (error) { resolve(failure(storage, '微信登录失败，请稍后重试')) }
  })
}
function loginWithEmail(storage, input) {
  const options = input || {}
  return call(() => authGateway.loginByEmail((options.email || '').trim(), options.password || '', { deviceId: deviceId(storage) })).then((remote) => settle(storage, remote, 'email'))
}
function challenge(storage, email, purpose) {
  const stored = storage.get(CHALLENGE_KEY) || {}
  const value = stored[`${purpose}:${email.trim().toLowerCase()}`]
  return value && Date.parse(value.expiresAt) > Date.now() ? value.challengeId : ''
}
function register(storage, input) {
  const options = input || {}
  return call(() => authGateway.register(Object.assign({}, options, { challengeId: challenge(storage, options.email || '', 'register'), deviceId: deviceId(storage) }))).then((remote) => settle(storage, remote, 'email'))
}
function sendCode(storage, input) {
  const options = input || {}
  return call(() => authGateway.sendCode(options)).then((remote) => {
    if (!remote.ok) return Object.assign(failure(storage, remote.reason), { cooldown: 0 })
    try {
      const stored = storage.get(CHALLENGE_KEY) || {}
      stored[`${options.purpose === 'reset' ? 'reset' : 'register'}:${(options.email || '').trim().toLowerCase()}`] = { challengeId: remote.challengeId, expiresAt: remote.expiresAt }
      storage.set(CHALLENGE_KEY, stored)
      return { ok: true, cooldown: remote.cooldown || 60, reason: '' }
    } catch (error) { return { ok: false, cooldown: 0, reason: '验证码状态保存失败，请检查设备存储空间' } }
  })
}
function resetPassword(storage, input) {
  const options = input || {}
  return call(() => authGateway.resetPassword(Object.assign({}, options, { challengeId: challenge(storage, options.email || '', 'reset') })))
}
function logout(storage) {
  const current = getAuth(storage)
  if (current.token) transport.request('DELETE', '/auth/sessions/current', {}, { token: current.token })
  try { clearAuth(storage) } catch (error) { return failure(storage, '退出登录失败，请检查设备存储空间') }
  return { ok: true, provider: '', auth: createEmptyAuth() }
}
function updateProfile(storage, profile) {
  const current = getAuth(storage)
  if (!current.loggedIn) return failure(storage, '请先登录')
  try { return { ok: true, auth: saveAuth(storage, applyProfile(current, profile)), reason: '' } }
  catch (error) { return failure(storage, '资料保存失败，请检查设备存储空间') }
}
module.exports = { AUTH_STORAGE_KEY, clearAuth, getAuth, saveAuth, login, loginWithEmail, register, sendCode, resetPassword, logout, updateProfile }
