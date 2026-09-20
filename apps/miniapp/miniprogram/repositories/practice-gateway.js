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
  getSubjects,
  resetGateway,
  retrySubmit,
  setGateway,
  submitSession
}
