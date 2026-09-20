const { SYNC_STATUS } = require('../models/practice-session-state.js')

/**
 * HttpPracticeGateway —— PRD 第 12 节「联调入口」的真实后端实现。
 *
 * 接口路径对齐 API PRD 第 8 节用户侧：
 *   GET  /api/subjects
 *   GET  /api/subjects/{subjectId}/question-banks
 *   POST /api/practice-sessions
 *   POST /api/practice-sessions/{sessionId}/submit
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
          reason: (error && error.errMsg) || '网络请求失败'
        })
      }
    })
  })
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

module.exports = {
  configure,
  createSession,
  getConfig,
  getQuestionBanks,
  getSubjects,
  isConfigured,
  name: 'http',
  retrySubmit: submitSession,
  submitSession
}
