const { SYNC_STATUS } = require('../models/practice-session-state.js')
const mockScenario = require('../utils/mock-scenario.js')
const questionBankCatalog = require('../utils/question-bank-catalog.js')
const fixtures = require('./playground-fixtures.js')

/**
 * MockPracticeGateway（PRD 第 8 节 Gateway 边界的 Mock 实现，放在 playground/mock-gateways/）。
 *
 * 四个方法与 PRD 8 的 PracticeGateway 接口一致：
 *   getSubjects / getQuestionBanks / createSession / submitSession
 * 页面与 ViewModel 只认这四个方法，不感知底下是 Mock 还是 HTTP。
 *
 * 一律返回 Promise：真实 HTTP 一定是异步的，现在就统一，联调时不必再改调用方（PRD 12）。
 * Mock 的「网络延迟」靠 setTimeout 兑现，因此慢网络分支也能被真走到。
 */

const DEFAULT_FAIL_REASON = '提交失败，请检查网络后重试'

/**
 * 延迟返回。延迟为 0 时**直接返回普通对象而不是 Promise**——
 *
 * 这是刻意保留的同步快路径：本地 Mock 根本没有网络等待，
 * 包一层 Promise 会让「交卷」这件事凭空变成异步，调用方与测试都得跟着改一遍。
 * 慢网络场景（latencyMs > 0）才真的返回 Promise，此时页面走异步分支并给出 loading。
 *
 * Gateway 契约因此是「可能返回值，也可能返回 Promise」，调用方统一 Promise.resolve 兼容。
 */
function resolveLater(value, latencyMs) {
  const delay = Math.max(Number(latencyMs) || 0, 0)

  if (!delay) {
    return value
  }

  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delay)
  })
}

/** 本地模式下科目就是 catalog 里的科目，Playground 科目由 catalog 按开关注入 */
function getSubjects() {
  return Promise.resolve(questionBankCatalog.getSubjectSummaries())
}

function getQuestionBanks(storage, subjectId) {
  const detail = questionBankCatalog.getSubjectDetail(subjectId)

  if (detail && detail.banks.length) {
    return Promise.resolve(detail.banks)
  }

  // 兜底：科目不在本地 catalog 里时（例如 Playground 关闭但场景仍在），走 fixture
  return Promise.resolve(fixtures.getPlaygroundBanks(subjectId))
}

function createSession(storage, input) {
  const config = mockScenario.getScenarioConfig(storage)
  const payload = input || {}

  return resolveLater({
    ok: true,
    sessionId: payload.sessionId || '',
    questionCount: Number(payload.questionCount) || 0,
    syncStatus: SYNC_STATUS.LOCAL_ONLY
  }, config.latencyMs)
}

/**
 * 提交：成败与延迟都由当前场景决定，而不是写死成功——
 * 否则 SYNC_PENDING 与重试分支永远是一段走不到的死代码。
 */
function submitSession(storage, input) {
  const config = mockScenario.getScenarioConfig(storage)
  const payload = input || {}

  if (config.submitFails) {
    return resolveLater({
      ok: false,
      syncStatus: SYNC_STATUS.SYNC_PENDING,
      reason: DEFAULT_FAIL_REASON,
      sessionId: payload.sessionId || ''
    }, config.latencyMs)
  }

  return resolveLater({
    ok: true,
    syncStatus: SYNC_STATUS.SYNCED,
    reason: '',
    sessionId: payload.sessionId || '',
    result: fixtures.buildResultFixture({
      sessionId: payload.sessionId || '',
      questionIds: Array.isArray(payload.questionIds) ? payload.questionIds : [],
      answers: Array.isArray(payload.answers) ? payload.answers : [],
      elapsedTime: Number(payload.elapsedTime) || 0
    })
  }, config.latencyMs)
}

/** 重试：与 submitSession 同签名，差别只在上层会先把场景切回 normal */
function retrySubmit(storage, input) {
  return submitSession(storage, input)
}

module.exports = {
  DEFAULT_FAIL_REASON,
  createSession,
  getQuestionBanks,
  getSubjects,
  retrySubmit,
  submitSession
}
