const {
  SESSION_STATUS,
  SYNC_STATUS
} = require('../models/practice-session-state.js')

/**
 * HttpPracticeGateway —— PRD 第 12 节「联调入口」的真实后端实现。
 *
 * 接口路径对齐 API PRD 第 8 节用户侧，六个全部覆盖：
 *   GET  /api/subjects
 *   GET  /api/subjects/{subjectId}/question-banks
 *   POST /api/practice-sessions
 *   GET  /api/practice-sessions/{sessionId}
 *   POST /api/practice-sessions/{sessionId}/submit
 *   GET  /api/practice-sessions/{sessionId}/result
 *
 * 三条硬约束：
 * 1. **不在模块顶层碰 `wx`**——本文件要能在 Node 里被 require 跑断言，
 *    顶层取 `wx` 会直接 ReferenceError。每次调用时再取。
 * 2. **未配置 baseUrl 时返回失败而不是抛错**：域名还没申请下来是常态，
 *    此时应该落回「提交失败 → 可重试」，而不是让页面白屏。
 * 3. **失败一律 SYNC_PENDING**：与 Mock 的失败语义保持一致，
 *    这样结果页的重试条在任何一种网关下都是同一条代码路径。
 *
 * 联调前置：小程序后台需配置 request 合法域名，且必须 HTTPS。
 */

const DEFAULT_TIMEOUT = 10000

const config = {
  baseUrl: '',
  timeout: DEFAULT_TIMEOUT
}

function configure(options) {
  const payload = options || {}

  if (typeof payload.baseUrl === 'string') {
    // 去掉结尾斜杠，避免拼出 //api
    config.baseUrl = payload.baseUrl.replace(/\/+$/, '')
  }

  if (Number(payload.timeout) > 0) {
    config.timeout = Number(payload.timeout)
  }

  return getConfig()
}

function getConfig() {
  return {
    baseUrl: config.baseUrl,
    timeout: config.timeout
  }
}

function getWx() {
  return typeof wx !== 'undefined' && wx && typeof wx.request === 'function' ? wx : null
}

function buildUrl(path) {
  return `${config.baseUrl}${path}`
}

function isConfigured() {
  return !!config.baseUrl
}

/** 统一把 wx.request 的回调包成 Promise；fail 也走 resolve，由调用方按 ok 分支处理 */
function request(method, path, data) {
  const wxApi = getWx()

  if (!isConfigured() || !wxApi) {
    return Promise.resolve({
      ok: false,
      statusCode: 0,
      data: null,
      reason: isConfigured() ? '当前环境不支持网络请求' : '未配置接口域名'
    })
  }

  return new Promise((resolve) => {
    wxApi.request({
      url: buildUrl(path),
      method,
      data: data || {},
      header: {
        'content-type': 'application/json'
      },
      timeout: config.timeout,
      success: (response) => {
        const statusCode = Number(response && response.statusCode) || 0
        const isOk = statusCode >= 200 && statusCode < 300

        resolve({
          ok: isOk,
          statusCode,
          data: response && response.data ? response.data : null,
          reason: isOk ? '' : `接口返回 ${statusCode}`
        })
      },
      fail: (error) => {
        resolve({
          ok: false,
          statusCode: 0,
          data: null,
          reason: describeRequestError(error && error.errMsg)
        })
      }
    })
  })
}

/**
 * 把 wx 的 errMsg 翻成用户看得懂、且能照着做的话。
 *
 * 直接透传 `request:fail url not in domain list` 这类英文串，用户只会以为程序坏了。
 * 而这几种恰恰是联调期最常见的**配置**问题（不是 Bug），
 * 说清楚就能自己搞定，说不清楚就只能来问一次。
 */
function describeRequestError(errMsg) {
  const text = typeof errMsg === 'string' ? errMsg : ''

  if (/url not in domain list|not in domain/i.test(text)) {
    return '接口域名未加入小程序后台的合法域名'
  }

  if (/timeout/i.test(text)) {
    return '请求超时，请稍后重试'
  }

  if (/ssl|certificate/i.test(text)) {
    return '接口证书校验失败，请使用 HTTPS 证书'
  }

  return '网络请求失败，请检查网络后重试'
}

function getSubjects() {
  return request('GET', '/api/subjects').then((response) => {
    if (!response.ok) {
      return []
    }

    const payload = response.data || {}

    return Array.isArray(payload.subjects) ? payload.subjects : Array.isArray(payload) ? payload : []
  })
}

function getQuestionBanks(storage, subjectId) {
  const path = `/api/subjects/${encodeURIComponent(subjectId || '')}/question-banks`

  return request('GET', path).then((response) => {
    if (!response.ok) {
      return []
    }

    const payload = response.data || {}

    return Array.isArray(payload.questionBanks)
      ? payload.questionBanks
      : Array.isArray(payload) ? payload : []
  })
}

function createSession(storage, input) {
  const payload = input || {}

  return request('POST', '/api/practice-sessions', {
    subjectId: payload.subjectId || '',
    questionBankId: payload.questionBankId || '',
    config: payload.config || {},
    questionIds: payload.questionIds || [],
    questionOrder: payload.questionOrder || []
  }).then((response) => {
    if (!response.ok) {
      return {
        ok: false,
        sessionId: payload.sessionId || '',
        syncStatus: SYNC_STATUS.SYNC_PENDING,
        reason: response.reason || '创建练习失败'
      }
    }

    const data = response.data || {}

    return {
      ok: true,
      sessionId: data.sessionId || payload.sessionId || '',
      questionCount: Number(data.questionCount) || 0,
      syncStatus: SYNC_STATUS.LOCAL_ONLY
    }
  })
}

function submitSession(storage, input) {
  const payload = input || {}
  const sessionId = payload.sessionId || ''
  const path = `/api/practice-sessions/${encodeURIComponent(sessionId)}/submit`

  return request('POST', path, {
    answers: payload.answers || [],
    duration: Number(payload.elapsedTime) || 0
  }).then((response) => {
    if (!response.ok) {
      return {
        ok: false,
        sessionId,
        syncStatus: SYNC_STATUS.SYNC_PENDING,
        reason: response.reason || '提交失败，请检查网络后重试'
      }
    }

    return {
      ok: true,
      sessionId,
      syncStatus: SYNC_STATUS.SYNCED,
      reason: '',
      result: response.data || null
    }
  })
}

/**
 * 查询会话：GET /api/practice-sessions/{sessionId}（API PRD 8）
 *
 * **读接口不参与同步状态机**，因此返回值里没有 syncStatus——
 * 查一次失败不代表本地数据没同步上去，把查询结果接进 syncStatus 会把
 * SYNC_PENDING 莫名其妙改掉，重试条也就跟着消失或乱闪。
 */
function getSession(storage, sessionId) {
  const id = sessionId || ''
  const path = `/api/practice-sessions/${encodeURIComponent(id)}`

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
 * 查询结果：GET /api/practice-sessions/{sessionId}/result（API PRD 8）
 *
 * 与 submitSession 的差别：这个接口是**幂等重取**，用来在提交成功但结果丢失时
 * 把成绩捞回来，不会触发服务端重新判题（API PRD 11 要求同一 Session 只出一个 Result）。
 */
function getResult(storage, sessionId) {
  const id = sessionId || ''
  const path = `/api/practice-sessions/${encodeURIComponent(id)}/result`

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
  configure,
  createSession,
  getConfig,
  getQuestionBanks,
  getResult,
  getSession,
  getSubjects,
  isConfigured,
  name: 'http',
  normalizeRemoteResult,
  normalizeRemoteSession,
  retrySubmit: submitSession,
  submitSession
}
