const {
  SESSION_STATUS,
  SYNC_STATUS
} = require('../models/practice-session-state.js')
const mockScenario = require('../utils/mock-scenario.js')
const questionBankCatalog = require('../utils/question-bank-catalog.js')
const sessionRepository = require('../repositories/session-repository.js')
const fixtures = require('./playground-fixtures.js')

/**
 * MockPracticeGateway（PRD 第 8 节 Gateway 边界的 Mock 实现，放在 playground/mock-gateways/）。
 *
 * 六个方法与 API PRD 第 8 节用户侧接口一一对应：
 *   getSubjects / getQuestionBanks / createSession
 *   getSession / submitSession / getResult
 * 页面与 ViewModel 只认这些方法，不感知底下是 Mock 还是 HTTP。
 *
 * 两个查询方法必须有 Mock 实现：联调时上层代码不变，若 Mock 缺这两个方法，
 * 「切到 HTTP 才第一次被执行」的代码路径等于从没验证过。
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
 * 查询会话（Mock 版）。
 *
 * Mock 语境下没有服务端，**本地持久化就是服务端的唯一事实**——
 * 直接读 session-repository，而不是复制一份状态。
 * 这样 Playground 里改一次答题数据，查询结果立刻跟着变，不会出现两份数据打架。
 */
function getSession(storage, sessionId) {
  const config = mockScenario.getScenarioConfig(storage)
  const saved = sessionRepository.getSession(storage)
  const id = sessionId || ''
  const matches = !!saved && (!id || saved.sessionId === id)

  return resolveLater({
    ok: matches,
    sessionId: id || (saved ? saved.sessionId : ''),
    session: matches ? saved : null,
    reason: matches ? '' : '会话不存在或已过期'
  }, config.latencyMs)
}

/**
 * 查询结果（Mock 版）。
 *
 * 只有已交卷的会话才有成绩——没交卷就查应当返回「成绩尚未生成」而不是报错，
 * 与 HTTP 版 404 的语义保持一致。
 */
function getResult(storage, sessionId) {
  const config = mockScenario.getScenarioConfig(storage)
  const saved = sessionRepository.getSession(storage)
  const id = sessionId || ''
  const isSubmitted = !!saved && saved.status === SESSION_STATUS.SUBMITTED
  const matches = isSubmitted && (!id || saved.sessionId === id)

  return resolveLater({
    ok: matches,
    sessionId: id || (saved ? saved.sessionId : ''),
    result: matches ? fixtures.buildResultFixture(saved) : null,
    reason: matches ? '' : '成绩尚未生成'
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
  getResult,
  getSession,
  getSubjects,
  retrySubmit,
  submitSession
}
