const mockGateway = require('../playground/mock-gateway.js')

/**
 * PracticeGateway —— PRD 第 8 节要求的 Mock ⇄ HTTP 切换边界。
 *
 * 页面与 ViewModel 只依赖这里暴露的方法，不感知当前注入的是 Mock 还是 HTTP。
 * 联调时实现 HttpPracticeGateway 后 `setGateway(httpGateway)` 一行切换，
 * 页面、ViewModel 与 PracticeSession 流程都不用动（PRD 12）。
 *
 * 四个方法对齐 PRD 8 的接口定义，全部返回 Promise（真实 HTTP 一定是异步的）。
 */

let activeGateway = mockGateway

function setGateway(gateway) {
  const isUsable = gateway && typeof gateway.submitSession === 'function'

  activeGateway = isUsable ? gateway : mockGateway

  return getGatewayName()
}

function getGatewayName() {
  if (activeGateway === mockGateway) {
    return 'mock'
  }

  return typeof activeGateway.name === 'string' ? activeGateway.name : 'custom'
}

/** 恢复默认：联调出问题时可一键退回 Mock，保证端内闭环仍可走通 */
function resetGateway() {
  activeGateway = mockGateway

  return getGatewayName()
}

function getSubjects(storage) {
  return typeof activeGateway.getSubjects === 'function'
    ? activeGateway.getSubjects(storage)
    : Promise.resolve([])
}

function getQuestionBanks(storage, subjectId) {
  return typeof activeGateway.getQuestionBanks === 'function'
    ? activeGateway.getQuestionBanks(storage, subjectId)
    : Promise.resolve([])
}

function createSession(storage, input) {
  return activeGateway.createSession(storage, input)
}

/**
 * 查询会话 / 查询成绩（API PRD 8 的另外两个读接口）。
 *
 * 这两个**不在** PRD 8 的 PracticeGateway 四方法里，所以按可选能力处理：
 * 网关没实现就返回失败，而不是抛异常——将来接一个只实现了四方法的网关时，
 * 页面不该因为多调了一次查询就崩掉。
 */
function callOptional(methodName, storage, sessionId) {
  const method = activeGateway[methodName]

  if (typeof method !== 'function') {
    return Promise.resolve({
      ok: false,
      sessionId: sessionId || '',
      session: null,
      result: null,
      reason: '当前网关不支持该查询'
    })
  }

  return method(storage, sessionId)
}

function getSession(storage, sessionId) {
  return callOptional('getSession', storage, sessionId)
}

function getResult(storage, sessionId) {
  return callOptional('getResult', storage, sessionId)
}

function submitSession(storage, input) {
  return activeGateway.submitSession(storage, input)
}

/** 重试提交：与 submitSession 同签名，差别只在上层会先把场景切回 normal */
function retrySubmit(storage, input) {
  return typeof activeGateway.retrySubmit === 'function'
    ? activeGateway.retrySubmit(storage, input)
    : submitSession(storage, input)
}

module.exports = {
  DEFAULT_FAIL_REASON: mockGateway.DEFAULT_FAIL_REASON,
  createSession,
  getGatewayName,
  getQuestionBanks,
  getResult,
  getSession,
  getSubjects,
  resetGateway,
  retrySubmit,
  setGateway,
  submitSession
}
