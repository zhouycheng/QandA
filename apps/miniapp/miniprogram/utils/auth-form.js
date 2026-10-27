/**
 * 认证表单的纯校验规则。
 *
 * 设计稿（Figma 763:567 / 772:1036 / 772:1076）只有输入框和占位文案，
 * 没有错误提示的位置，所以这里的产出统一是「一条能直接 toast 的中文原因」，
 * 页面再用 field 字段给对应输入框挂红边。
 *
 * 不碰 wx / storage，可在 Node 直接 require 跑断言。
 */

/** 邮箱：允许常见的 . _ % + - 组合，必须有域名与 2 位以上后缀 */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

/** 验证码：设计上没写位数，按邮箱验证码惯例取 6 位纯数字 */
const CODE_PATTERN = /^\d{6}$/

const PASSWORD_MIN = 8
const PASSWORD_MAX = 20

/** 设计稿原文：请设置 8–20 位字母与数字组合 */
const PASSWORD_HINT = '密码需 8–20 位字母与数字组合'

const ERROR = {
  emailEmpty: '请输入邮箱',
  emailInvalid: '邮箱格式不正确',
  codeEmpty: '请输入验证码',
  codeInvalid: '验证码应为 6 位数字',
  passwordEmpty: '请设置密码',
  passwordInvalid: PASSWORD_HINT,
  confirmEmpty: '请再次输入密码',
  confirmMismatch: '两次输入的密码不一致',
  agreed: '请先阅读并同意用户协议和隐私政策'
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(trimText(value))
}

function isValidCode(value) {
  return CODE_PATTERN.test(trimText(value))
}

/**
 * 密码规则：长度 8–20，且必须同时含字母与数字。
 * 只判长度的做法挡不住 `aaaaaaaa`，设计稿明确写了「字母与数字组合」。
 */
function isValidPassword(value) {
  const text = typeof value === 'string' ? value : ''

  if (text.length < PASSWORD_MIN || text.length > PASSWORD_MAX) {
    return false
  }

  if (!/^[A-Za-z0-9]+$/.test(text)) {
    return false
  }

  return /[A-Za-z]/.test(text) && /\d/.test(text)
}

function fail(field, message) {
  return {
    ok: false,
    field,
    message
  }
}

const PASS = {
  ok: true,
  field: '',
  message: ''
}

function checkEmail(value) {
  if (!trimText(value)) {
    return fail('email', ERROR.emailEmpty)
  }

  return isValidEmail(value) ? null : fail('email', ERROR.emailInvalid)
}

function checkCode(value) {
  if (!trimText(value)) {
    return fail('code', ERROR.codeEmpty)
  }

  return isValidCode(value) ? null : fail('code', ERROR.codeInvalid)
}

function checkPassword(value, field) {
  const key = field || 'password'

  if (!value) {
    return fail(key, ERROR.passwordEmpty)
  }

  return isValidPassword(value) ? null : fail(key, ERROR.passwordInvalid)
}

function checkConfirm(password, confirm) {
  if (!confirm) {
    return fail('confirm', ERROR.confirmEmpty)
  }

  return password === confirm ? null : fail('confirm', ERROR.confirmMismatch)
}

/**
 * 登录：邮箱 + 密码 + 已同意协议。
 * 协议放在最后判，这样用户先看到的是填错的地方，而不是一上来就被协议拦住。
 */
function validateLogin(form) {
  const payload = form || {}
  const errors = [checkEmail(payload.email), checkPassword(payload.password)]

  if (!payload.agreed) {
    errors.push(fail('agreed', ERROR.agreed))
  }

  return firstFailure(errors)
}

/** 注册：邮箱 + 验证码 + 设置密码 + 确认密码 + 已同意协议 */
function validateRegister(form) {
  const payload = form || {}
  const errors = [
    checkEmail(payload.email),
    checkCode(payload.code),
    checkPassword(payload.password),
    checkConfirm(payload.password, payload.confirm)
  ]

  if (!payload.agreed) {
    errors.push(fail('agreed', ERROR.agreed))
  }

  return firstFailure(errors)
}

/** 找回密码：邮箱 + 验证码 + 新密码 + 确认密码（设计稿这里没有协议勾选） */
function validateReset(form) {
  const payload = form || {}

  return firstFailure([
    checkEmail(payload.email),
    checkCode(payload.code),
    checkPassword(payload.password),
    checkConfirm(payload.password, payload.confirm)
  ])
}

function firstFailure(errors) {
  for (let index = 0; index < errors.length; index += 1) {
    if (errors[index]) {
      return errors[index]
    }
  }

  return PASS
}

/**
 * 邮箱展示用的脱敏。
 * 「我的」页与设置页会把邮箱显示出来，完整邮箱摊在屏幕上没必要。
 * 只保留首字符与域名：abcd@qq.com → a***@qq.com
 */
function maskEmail(email) {
  const text = trimText(email)

  if (!text || text.indexOf('@') < 0) {
    return ''
  }

  const at = text.indexOf('@')
  const name = text.slice(0, at)
  const domain = text.slice(at)
  const head = name.slice(0, 1)

  return `${head}${name.length > 1 ? '***' : ''}${domain}`
}

module.exports = {
  CODE_PATTERN,
  EMAIL_PATTERN,
  ERROR,
  PASSWORD_HINT,
  PASSWORD_MAX,
  PASSWORD_MIN,
  firstFailure,
  isValidCode,
  isValidEmail,
  isValidPassword,
  maskEmail,
  trimText,
  validateLogin,
  validateRegister,
  validateReset
}
