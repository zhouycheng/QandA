/**
 * 登录态的取值与归一化规则。
 *
 * 只放纯计算，不碰 wx / storage —— 读写由 repositories/auth-repository.js 负责，
 * 这样本文件可以在 Node 里直接 require 跑断言。
 *
 * 三种身份来源（对齐 API PRD 第 19 节「Mock 原则」）：
 *   email  —— 邮箱密码登录：设计稿 763:567 的主路径，POST /api/auth/login
 *   wechat —— 真微信登录：wx.login 拿 code → 后端 code2session → 自有 token
 *   dev    —— 本地身份：后端还没接好时的降级身份（DevAuthProvider）
 *
 * 降级不是「登录失败」。用户点了登录就该进到已登录状态，
 * 只是身份由本地生成；把降级当成失败会让用户以为功能坏了。
 */

const AUTH_STORAGE_KEY = 'qandaAuth'

const AUTH_PROVIDER = {
  EMAIL: 'email',
  WECHAT: 'wechat',
  DEV: 'dev'
}

const PROVIDER_LABEL = {
  email: '邮箱登录',
  wechat: '微信登录',
  dev: '本地身份'
}

/** 微信昵称上限 32 个字符，超了在资料卡里会截断得很难看 */
const NICKNAME_MAX_LENGTH = 32
// 学院 / 单位：只用于「我的」页身份信息展示，属于可选的资料字段
const COLLEGE_MAX_LENGTH = 24
const TOKEN_MAX_LENGTH = 512
const USER_ID_MAX_LENGTH = 64
const EMAIL_MAX_LENGTH = 128

const ANONYMOUS_NAME = '微信用户'
const GUEST_NAME = '未登录'

/**
 * 登录态说明文案。
 * 登录页 / 我的 / 设置三处都会显示同一句解释，各写一份迟早会写出三种说法，
 * 所以放在这里是唯一真源。
 */
const AUTH_HINTS = {
  guest: '未登录：做题进度、错题与收藏只存在本机，换设备不会同步',
  email: '已通过邮箱登录。学习数据保存在本机，登录只用于标识身份',
  wechat: '已通过微信登录。学习数据仍保存在本机，登录只用于标识身份',
  dev: '后端接口未接入，已用本地身份继续。配好接口域名后会自动切换为真实登录'
}

function createEmptyAuth() {
  return {
    loggedIn: false,
    provider: '',
    userId: '',
    openId: '',
    token: '',
    email: '',
    nickname: '',
    college: '',
    avatarUrl: '',
    loginAt: 0
  }
}

function readText(value, maxLength) {
  if (typeof value !== 'string') {
    return ''
  }

  return maxLength ? value.slice(0, maxLength) : value
}

/**
 * 归一化：storage 里的东西一律不可信。
 *
 * 这里坚持的两条判据：
 * 1. **loggedIn 必须由 provider + 身份 id 共同决定**，不能只信存储里的 loggedIn 字段。
 *    曾经出过「有 key 但读回来是空壳」的坑（存的时候被覆盖成空数组），
 *    只信字段会让界面显示成已登录、实际没有任何身份。
 * 2. 未知 provider 一律降级为未登录，而不是原样透传，避免后续代码出现第三种状态。
 */
function normalizeAuth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyAuth()
  }

  const provider = readText(raw.provider)
  const isKnownProvider =
    provider === AUTH_PROVIDER.WECHAT || provider === AUTH_PROVIDER.DEV || provider === AUTH_PROVIDER.EMAIL
  const userId = readText(raw.userId, USER_ID_MAX_LENGTH)
  const openId = readText(raw.openId, USER_ID_MAX_LENGTH)
  const email = readText(raw.email, EMAIL_MAX_LENGTH)

  if (!isKnownProvider || (!userId && !openId && !email)) {
    return createEmptyAuth()
  }

  return {
    loggedIn: true,
    provider,
    userId,
    openId,
    email,
    token: readText(raw.token, TOKEN_MAX_LENGTH),
    nickname: readText(raw.nickname, NICKNAME_MAX_LENGTH),
    college: readText(raw.college, COLLEGE_MAX_LENGTH),
    avatarUrl: readText(raw.avatarUrl, 512),
    loginAt: Number(raw.loginAt) > 0 ? Number(raw.loginAt) : 0
  }
}

function isLoggedIn(auth) {
  return !!(auth && auth.loggedIn)
}

function getProviderLabel(provider) {
  return PROVIDER_LABEL[provider] || ''
}

/**
 * 视图字段。
 * 页面不该自己拼「显示名 / 状态标签」——三个页面（登录页、我的、设置）
 * 各拼一遍迟早会拼出三种文案，所以统一在这里出。
 */
function describeAuth(auth) {
  const normalized = normalizeAuth(auth)
  const providerLabel = getProviderLabel(normalized.provider)
  const fallbackName = normalized.nickname || normalized.email || (normalized.loggedIn ? ANONYMOUS_NAME : GUEST_NAME)

  return {
    loggedIn: normalized.loggedIn,
    provider: normalized.provider,
    providerLabel,
    email: normalized.email,
    displayName: fallbackName,
    college: normalized.college,
    avatarUrl: normalized.avatarUrl,
    accountTag: normalized.loggedIn ? providerLabel : GUEST_NAME,
    loginAt: normalized.loginAt
  }
}

function getAuthHint(auth) {
  const normalized = normalizeAuth(auth)

  if (!normalized.loggedIn) {
    return AUTH_HINTS.guest
  }

  if (normalized.provider === AUTH_PROVIDER.DEV) {
    return AUTH_HINTS.dev
  }

  return normalized.provider === AUTH_PROVIDER.EMAIL ? AUTH_HINTS.email : AUTH_HINTS.wechat
}

/** 登录时间的展示文案；没有时间戳就给空串，别显示 1970 */
function formatLoginTime(loginAt, now) {
  const timestamp = Number(loginAt) || 0

  if (timestamp <= 0) {
    return ''
  }

  const base = Number(now) > 0 ? Number(now) : Date.now()
  const date = new Date(timestamp)
  const pad = (value) => (value < 10 ? `0${value}` : String(value))
  const sameYear = new Date(base).getFullYear() === date.getFullYear()

  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * 本地身份 id。
 * 用时间戳 + 随机数拼，不引入 uuid 依赖（本项目是零依赖零构建）。
 * 带 `dev_` 前缀是为了一眼看出这是降级身份，不是真 openid。
 */
function buildDevUserId(now, random) {
  const stamp = (Number(now) > 0 ? Number(now) : Date.now()).toString(36)
  const seed = typeof random === 'number' ? random : Math.random()
  const salt = Math.floor(seed * 1e9).toString(36)

  return `dev_${stamp}${salt}`
}

function buildDevAuth(options) {
  const payload = options || {}

  return normalizeAuth({
    provider: AUTH_PROVIDER.DEV,
    userId: payload.userId || buildDevUserId(payload.now, payload.random),
    openId: '',
    nickname: payload.nickname || '',
    college: payload.college || '',
    avatarUrl: payload.avatarUrl || '',
    loginAt: Number(payload.now) > 0 ? Number(payload.now) : Date.now()
  })
}

/**
 * 邮箱 → 稳定 id（djb2 哈希，不引依赖）。
 * 后端没接入时用它当本地身份 id：同一邮箱在任何时候都算出同一个 id，
 * 反复登录不会让本机数据看起来换了个人。
 */
function hashEmail(email) {
  const text = readText(email).trim().toLowerCase()
  let hash = 5381

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }

  return hash.toString(36)
}

/**
 * 邮箱登录身份。
 * 注意：**密码永远不进这个对象**，也不落 storage —— 端上没有任何理由保存它。
 */
function buildEmailAuth(payload, now) {
  const data = payload || {}
  const email = readText(data.email, EMAIL_MAX_LENGTH).trim()

  return normalizeAuth({
    provider: AUTH_PROVIDER.EMAIL,
    userId: readText(data.userId || `email_${hashEmail(email)}`, USER_ID_MAX_LENGTH),
    email,
    token: readText(data.token || data.accessToken || '', TOKEN_MAX_LENGTH),
    nickname: readText(data.nickname || '', NICKNAME_MAX_LENGTH),
    college: readText(data.college || data.school || '', COLLEGE_MAX_LENGTH),
    avatarUrl: readText(data.avatarUrl || '', 512),
    loginAt: Number(now) > 0 ? Number(now) : Date.now()
  })
}

/**
 * 后端返回的身份。
 * 字段命名各家不一（openId / openid、userId / uid / id），
 * 这里全部兜一遍：后端少返回一个字段不该让端上登录失败。
 */
function buildWechatAuth(payload, now) {
  const data = payload || {}

  return normalizeAuth({
    provider: AUTH_PROVIDER.WECHAT,
    userId: readText(data.userId || data.uid || data.id || data.openId || data.openid, USER_ID_MAX_LENGTH),
    openId: readText(data.openId || data.openid || data.unionId || '', USER_ID_MAX_LENGTH),
    token: readText(data.token || data.accessToken || '', TOKEN_MAX_LENGTH),
    nickname: readText(data.nickname || data.nickName || '', NICKNAME_MAX_LENGTH),
    college: readText(data.college || data.school || '', COLLEGE_MAX_LENGTH),
    avatarUrl: readText(data.avatarUrl || data.avatar || '', 512),
    loginAt: Number(now) > 0 ? Number(now) : Date.now()
  })
}

/** 改昵称 / 头像：未登录时不产生身份，避免「改个头像就算登录了」 */
function applyProfile(auth, profile) {
  const normalized = normalizeAuth(auth)

  if (!normalized.loggedIn) {
    return normalized
  }

  const payload = profile || {}

  return normalizeAuth(
    Object.assign({}, normalized, {
      nickname: payload.nickname === undefined ? normalized.nickname : readText(payload.nickname, NICKNAME_MAX_LENGTH),
      college: payload.college === undefined ? normalized.college : readText(payload.college, COLLEGE_MAX_LENGTH),
      avatarUrl: payload.avatarUrl === undefined ? normalized.avatarUrl : readText(payload.avatarUrl, 512)
    })
  )
}

module.exports = {
  ANONYMOUS_NAME,
  AUTH_HINTS,
  AUTH_PROVIDER,
  AUTH_STORAGE_KEY,
  COLLEGE_MAX_LENGTH,
  GUEST_NAME,
  NICKNAME_MAX_LENGTH,
  PROVIDER_LABEL,
  applyProfile,
  buildDevAuth,
  buildDevUserId,
  buildEmailAuth,
  buildWechatAuth,
  createEmptyAuth,
  describeAuth,
  formatLoginTime,
  getAuthHint,
  getProviderLabel,
  hashEmail,
  isLoggedIn,
  normalizeAuth
}
