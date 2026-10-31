const { SESSION_STATUS, SYNC_STATUS } = require('../models/practice-session-state.js')
const transport = require('./api-transport.js')
const { configure, getConfig, request, isConfigured, uuid } = transport

async function identity(response) {
  if (!response.ok) return response
  const session = response.data.session || response.data
  const token = session.accessToken
  if (!token) return { ok: false, reason: '微信账号需要先完成注册', registrationToken: response.data.registrationToken }
  const me = await request('GET', '/me', {}, { token })
  if (!me.ok) return me
  if (!me.data || !me.data.id) return { ok: false, reason: '登录接口未返回用户标识' }
  return { ok: true, userId: me.data.id, token, email: me.data.email || '', nickname: me.data.nickname, version: me.data.version, profile: me.data }
}
function login(code, options) { return request('POST', '/auth/wechat-sessions', { code, deviceId: options && options.deviceId || uuid() }, { token: '' }).then(identity) }
function registerWechat(input) { return request('POST', '/auth/wechat-registrations', { registrationToken: input.registrationToken, nickname: input.nickname || 'Q友' }, { token: '', idempotencyKey: input.idempotencyKey || uuid() }) }
function loginByEmail(email, password, options) { return request('POST', '/auth/sessions', { email, password, deviceId: options && options.deviceId || uuid(), clientType: 'MINI_PROGRAM' }, { token: '' }).then(identity) }
async function register(input) {
  const response = await request('POST', '/auth/email-registrations', { challengeId: input.challengeId, code: input.code, password: input.password, nickname: input.nickname || 'Q友' }, { token: '', idempotencyKey: input.idempotencyKey || uuid() })
  return response.ok ? loginByEmail(input.email, input.password, input) : response
}
async function sendCode(input) {
  const response = await request('POST', '/auth/email-challenges', { email: input.email, purpose: input.purpose === 'reset' ? 'RESET_PASSWORD' : 'REGISTER' }, { token: '', idempotencyKey: input.idempotencyKey || uuid() })
  return response.ok ? Object.assign({}, response, { challengeId: response.data.id, expiresAt: response.data.expiresAt, cooldown: response.data.resendAfterSeconds }) : response
}
function resetPassword(input) { return request('POST', '/auth/password-resets', { challengeId: input.challengeId, code: input.code, newPassword: input.password }, { token: '', idempotencyKey: input.idempotencyKey || uuid() }) }

function getSession(storage, sessionId) {
  const id = sessionId || ''
  const path = `/practice/sessions/${encodeURIComponent(id)}`

  return request('GET', path).then((response) => {
    if (!response.ok) {
      return {
        ok: false,
        sessionId: id,
        session: null,
        reason: response.statusCode === 404
          ? '会话不存在或已过期'
          : response.reason || '查询会话失败'
      }
    }

    return {
      ok: true,
      sessionId: id,
      session: normalizeRemoteSession(response.data, id),
      reason: ''
    }
  })
}

/**
 * 查询结果：GET /api/v1/practice/sessions/{sessionId}/result（API PRD 8）
 *
 * 与 submitSession 的差别：这个接口是**幂等重取**，用来在提交成功但结果丢失时
 * 把成绩捞回来，不会触发服务端重新判题（API PRD 11 要求同一 Session 只出一个 Result）。
 */
function getResult(storage, sessionId) {
  const id = sessionId || ''
  const path = `/practice/sessions/${encodeURIComponent(id)}/result`

  return request('GET', path).then((response) => {
    if (!response.ok) {
      return {
        ok: false,
        sessionId: id,
        result: null,
        // 404 在这里是正常情况：还没交卷就是没有成绩，不该当成错误去重试
        reason: response.statusCode === 404
          ? '成绩尚未生成'
          : response.reason || '查询成绩失败'
      }
    }

    return {
      ok: true,
      sessionId: id,
      result: normalizeRemoteResult(response.data, id),
      reason: ''
    }
  })
}

/* ==================== 响应归一化 ==================== */

/** 每题状态的端内取值，与 resultItems 的 answered / isCorrect 对应 */
const RESULT_STATUS = {
  CORRECT: 'correct',
  WRONG: 'wrong',
  UNANSWERED: 'unanswered'
}

/**
 * 服务端 PracticeSession → 端内视图（字段对齐 MiniApp PRD 第 9 节）。
 *
 * 缺字段一律兜底而不是整块返回 null：后端少返回一个字段就把会话判成"不存在"，
 * 排查方向会完全反掉——明明是字段缺失，却按 404 查半天。
 */
function normalizeRemoteSession(raw, sessionId) {
  const payload = raw && typeof raw === 'object' ? raw : {}

  return {
    sessionId: payload.sessionId || sessionId || '',
    subjectId: payload.subjectId || '',
    questionBankId: payload.questionBankId || '',
    config: payload.config && typeof payload.config === 'object' ? payload.config : {},
    questionIds: Array.isArray(payload.questionIds) ? payload.questionIds : [],
    questionOrder: Array.isArray(payload.questionOrder) ? payload.questionOrder : [],
    currentIndex: Math.max(Number(payload.currentIndex) || 0, 0),
    answers: Array.isArray(payload.answers) ? payload.answers : [],
    questionStates: Array.isArray(payload.questionStates) ? payload.questionStates : [],
    elapsedTime: Math.max(Number(payload.elapsedTime) || 0, 0),
    status: typeof payload.status === 'string' ? payload.status : SESSION_STATUS.IN_PROGRESS,
    syncStatus: typeof payload.syncStatus === 'string' ? payload.syncStatus : SYNC_STATUS.SYNCED
  }
}

/**
 * 单题结果归一化。
 *
 * status 兜底宁可标"错"也不标"对"：把做错的题显示成正确会直接污染复盘，
 * 反过来最多是用户觉得冤枉一次，代价不对等。
 */
function normalizeQuestionResult(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {}
  const givenStatus = typeof payload.status === 'string' ? payload.status.toLowerCase() : ''
  const userAnswer = normalizeAnswerKeys(payload.userAnswer)

  let status = givenStatus

  if (status !== RESULT_STATUS.CORRECT && status !== RESULT_STATUS.WRONG && status !== RESULT_STATUS.UNANSWERED) {
    if (!userAnswer.length) {
      status = RESULT_STATUS.UNANSWERED
    } else {
      status = payload.isCorrect === true ? RESULT_STATUS.CORRECT : RESULT_STATUS.WRONG
    }
  }

  return {
    questionId: payload.questionId || '',
    userAnswer,
    correctAnswer: normalizeAnswerKeys(payload.correctAnswer),
    status,
    explanation: typeof payload.explanation === 'string' ? payload.explanation : ''
  }
}

/**
 * 答案键归一化：后端可能给 `['A','B']`、`"AB"` 甚至 `1`，端内统一成键数组。
 *
 * **不能只认数组**——多选答案用字符串拼着返回非常常见，
 * 只判 Array.isArray 的话 "AB" 会被当成空答案，整道题判成未作答，
 * 而且错得很安静：成绩、复盘、正确率全错，页面看起来却一切正常。
 */
function normalizeAnswerKeys(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((item) => item !== null && item !== undefined).map((item) => String(item))
  }

  if (typeof raw === 'string') {
    return raw ? raw.split('') : []
  }

  if (typeof raw === 'number') {
    return [String(raw)]
  }

  return []
}

/**
 * 服务端 PracticeResult → 端内视图（字段对齐 API PRD 第 7.6 节）。
 *
 * 计数优先用后端给的，缺失时再按 questionResults 现算——
 * 后端最终判题是事实来源（API PRD 10），但少给一个字段不该让整块成绩变空。
 */
function normalizeRemoteResult(raw, sessionId) {
  const payload = raw && typeof raw === 'object' ? raw : {}
  const questionResults = (Array.isArray(payload.questionResults) ? payload.questionResults : [])
    .map(normalizeQuestionResult)

  const countOf = (target) => questionResults.filter((item) => item.status === target).length
  const totalCount = Math.max(Number(payload.totalCount) || 0, questionResults.length)
  const correctCount = Math.max(Number(payload.correctCount) || 0, countOf(RESULT_STATUS.CORRECT))
  const wrongCount = Math.max(Number(payload.wrongCount) || 0, countOf(RESULT_STATUS.WRONG))
  const unansweredCount = Math.max(Number(payload.unansweredCount) || 0, countOf(RESULT_STATUS.UNANSWERED))
  const answeredCount = Math.max(
    Number(payload.answeredCount) || 0,
    questionResults.length - countOf(RESULT_STATUS.UNANSWERED)
  )

  return {
    sessionId: payload.sessionId || sessionId || '',
    totalCount,
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    accuracy: normalizeAccuracy(payload.accuracy, totalCount, correctCount),
    duration: Math.max(Number(payload.duration) || 0, 0),
    questionResults
  }
}

/**
 * 正确率单位归一化。
 *
 * 后端可能返回 0.85（比例）也可能返回 85（百分制），端内统一按百分制整数。
 * 判据：比例落在 (0, 1] 且百分制的合法值不可能落在这个区间——
 * 除非整卷只对了不到 1 分，而分数是整数，不存在 0 < score <= 1 以外的情况。
 * Contract Freeze 时把这个约定写进文档即可，不用再改代码。
 */
function normalizeAccuracy(rawAccuracy, totalCount, correctCount) {
  const given = Number(rawAccuracy)

  if (!isFinite(given) || given < 0) {
    return totalCount ? Math.round((correctCount / totalCount) * 100) : 0
  }

  if (given > 0 && given <= 1) {
    return Math.round(given * 100)
  }

  return Math.round(given)
}

module.exports = {
  RESULT_STATUS,
  request,
  uuid,
  getAll: transport.getAll,
  configure,
  getConfig,
  getResult,
  getSession,
  isConfigured,
  login,
  loginByEmail,
  name: 'http',
  normalizeRemoteResult,
  normalizeRemoteSession,
  register,
  registerWechat,
  resetPassword,
  sendCode
}
