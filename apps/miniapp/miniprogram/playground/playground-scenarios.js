const mockScenario = require('../utils/mock-scenario.js')
const sessionRepository = require('../repositories/session-repository.js')
const fixtures = require('./playground-fixtures.js')

/**
 * Playground 场景（PRD 第 7 节的 scenarios/）。
 *
 * 一个场景 = 「题库形态 + 会话预设 + 网关行为」三件事的组合：
 * - 题库形态决定进哪套 fixture 卷（正常 / 空 / 100 题）；
 * - 会话预设决定进来时有没有进度（全部未答 / 完成一半）；
 * - 网关行为交给 utils/mock-scenario.js（成功 / 失败 / 延迟）。
 *
 * PRD 原文要求的八个：正常题库、空题库、练习完成一半、全部未答、提交成功、提交失败、网络延迟、100 题压力。
 */

const SUBJECT_ID = fixtures.PLAYGROUND_SUBJECT_ID

const SCENARIOS = {
  normal: {
    key: 'normal',
    label: '正常题库',
    hint: '20 题，全部未答，提交成功',
    bankId: 'playground-normal',
    preset: 'none'
  },
  empty: {
    key: 'empty',
    label: '空题库',
    hint: '0 题，验证空态不白屏不崩溃',
    bankId: 'playground-empty',
    preset: 'none'
  },
  halfCompleted: {
    key: 'halfCompleted',
    label: '完成一半',
    hint: '前 10 题已答，进来即可验证进度恢复',
    bankId: 'playground-normal',
    preset: 'half'
  },
  allUnanswered: {
    key: 'allUnanswered',
    label: '全部未答',
    hint: '一题未答直接交卷，验证未作答统计',
    bankId: 'playground-normal',
    preset: 'none'
  },
  submitSuccess: {
    key: 'submitSuccess',
    label: '提交成功',
    hint: '交卷直接同步成功，结果页无重试条',
    bankId: 'playground-normal',
    preset: 'none'
  },
  submitFailed: {
    key: 'submitFailed',
    label: '提交失败',
    hint: '交卷失败 → SYNC_PENDING，结果页出现重试条且不清 Session',
    bankId: 'playground-normal',
    preset: 'none'
  },
  slowNetwork: {
    key: 'slowNetwork',
    label: '网络延迟',
    hint: '提交延迟 2 秒返回，验证 loading 与重复点击',
    bankId: 'playground-normal',
    preset: 'none'
  },
  stress100: {
    key: 'stress100',
    label: '100 题压力',
    hint: '100 题卷，验证大卷滚动与落盘性能',
    bankId: 'playground-stress',
    preset: 'none'
  }
}

const DEFAULT_SCENARIO = 'normal'

function normalizeScenarioName(name) {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, name) ? name : DEFAULT_SCENARIO
}

function getScenario(name) {
  return SCENARIOS[normalizeScenarioName(name)]
}

/** 面板渲染用：顺序固定，避免对象遍历顺序在不同引擎下不一致 */
function listScenarios() {
  return Object.keys(SCENARIOS).map((key) => SCENARIOS[key])
}

function buildPracticeUrl(bankId, preset) {
  const query = [
    `subjectId=${encodeURIComponent(SUBJECT_ID)}`,
    `bankId=${encodeURIComponent(bankId)}`,
    'mode=order'
  ]

  if (preset === 'half') {
    query.push('resume=1')
  }

  return `/page/practice/index?${query.join('&')}`
}

/**
 * 应用一个场景：切网关行为 + 写会话预设，然后返回可直接跳转的练习链接。
 *
 * 「完成一半」是唯一需要预置 Session 的场景——预置比手动点 10 题退出快，
 * 也是 PRD 11「可靠性」里 currentIndex 可恢复的验证入口。
 */
function applyScenario(storage, name) {
  const scenario = getScenario(name)

  mockScenario.setScenario(storage, scenario.key)

  if (scenario.preset === 'half') {
    sessionRepository.saveSession(storage, fixtures.buildHalfCompletedSession(scenario.bankId))
  } else {
    sessionRepository.clearSession(storage)
  }

  return {
    name: scenario.key,
    label: scenario.label,
    hint: scenario.hint,
    bankId: scenario.bankId,
    questionCount: fixtures.getPlaygroundQuestions(scenario.bankId).length,
    url: buildPracticeUrl(scenario.bankId, scenario.preset)
  }
}

module.exports = {
  DEFAULT_SCENARIO,
  SCENARIOS,
  SUBJECT_ID,
  applyScenario,
  buildPracticeUrl,
  getScenario,
  listScenarios,
  normalizeScenarioName
}
