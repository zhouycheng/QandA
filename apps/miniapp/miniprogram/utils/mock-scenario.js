/**
 * Mock 场景开关（PRD 第 7 节 Playground 的最小可用版本）。
 *
 * MVP 阶段没有真实后端，但「提交失败」这条分支必须能被真实走到，
 * 否则 SYNC_PENDING / 重试就是一段永远不执行的死代码。
 * 因此把成败交给一个可切换的场景，而不是写死成功。
 */

const STORAGE_KEY = 'qandaMockScenario'

const DEFAULT_SCENARIO = 'normal'

/**
 * 场景表对齐 PRD 第 7 节「Playground 至少能够模拟」的八种情况。
 * 这里只描述**网关行为**（失败 / 延迟），题库形态与进度由 playground/playground-scenarios.js 负责。
 */
const MOCK_SCENARIOS = {
  normal: {
    label: '正常',
    submitFails: false,
    latencyMs: 0
  },
  empty: {
    label: '空题库',
    submitFails: false,
    latencyMs: 0
  },
  halfCompleted: {
    label: '完成一半',
    submitFails: false,
    latencyMs: 0
  },
  allUnanswered: {
    label: '全部未答',
    submitFails: false,
    latencyMs: 0
  },
  submitSuccess: {
    label: '提交成功',
    submitFails: false,
    latencyMs: 0
  },
  submitFailed: {
    label: '提交失败',
    submitFails: true,
    latencyMs: 0
  },
  slowNetwork: {
    label: '网络延迟',
    submitFails: false,
    latencyMs: 2000
  },
  stress100: {
    label: '100 题压力',
    submitFails: false,
    latencyMs: 0
  }
}

function normalizeScenario(name) {
  return Object.prototype.hasOwnProperty.call(MOCK_SCENARIOS, name) ? name : DEFAULT_SCENARIO
}

function getScenario(storage) {
  const raw = storage && typeof storage.get === 'function' ? storage.get(STORAGE_KEY) : null
  const name = typeof raw === 'string' ? raw : ''

  return normalizeScenario(name)
}

function setScenario(storage, name) {
  const normalized = normalizeScenario(name)

  if (storage && typeof storage.set === 'function') {
    storage.set(STORAGE_KEY, normalized)
  }

  return normalized
}

function clearScenario(storage) {
  if (storage && typeof storage.remove === 'function') {
    storage.remove(STORAGE_KEY)
  }

  return DEFAULT_SCENARIO
}

function getScenarioConfig(storage) {
  return MOCK_SCENARIOS[getScenario(storage)]
}

module.exports = {
  DEFAULT_SCENARIO,
  MOCK_SCENARIOS,
  STORAGE_KEY,
  clearScenario,
  getScenario,
  getScenarioConfig,
  normalizeScenario,
  setScenario
}
