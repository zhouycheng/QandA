const { createSessionId } = require('../models/practice-session-state.js')

/**
 * Playground fixtures（PRD 第 7 节的 fixtures/：subjects / question-banks / questions / results）。
 *
 * 题目是运行时生成的，不写成静态数据文件——100 题压力场景如果落盘会白白占包体，
 * 而生成规则是可预测的（同一 bankId + 序号 → 同一道题），反复取卷结果稳定。
 *
 * 题型按 index % 3 循环出单选 / 多选 / 判断，正好覆盖 PRD 11「交互」要求验证的三种题型。
 */

const PLAYGROUND_SUBJECT_ID = 'subject-playground'

const BANK_DEFS = [
  {
    id: 'playground-normal',
    name: 'Playground · 正常题库',
    questionCount: 20
  },
  {
    id: 'playground-empty',
    name: 'Playground · 空题库',
    questionCount: 0
  },
  {
    id: 'playground-stress',
    name: 'Playground · 100 题压力',
    questionCount: 100
  }
]

const TYPE_CYCLE = ['single', 'multiple', 'judge']

const TYPE_TEXT = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题'
}

const OPTION_KEYS = ['A', 'B', 'C', 'D']

function getTypeAt(index) {
  return TYPE_CYCLE[Math.abs(Number(index) || 0) % TYPE_CYCLE.length]
}

function buildOptions(type) {
  if (type === 'judge') {
    return [
      { key: 'A', label: 'A', text: '正确' },
      { key: 'B', label: 'B', text: '错误' }
    ]
  }

  return OPTION_KEYS.map((key) => ({
    key,
    label: key,
    text: `选项 ${key}`
  }))
}

function buildAnswerKeys(type, index) {
  const step = Math.abs(Number(index) || 0)

  if (type === 'judge') {
    return [step % 2 === 0 ? 'A' : 'B']
  }

  if (type === 'multiple') {
    return ['A', 'C']
  }

  return [OPTION_KEYS[step % OPTION_KEYS.length]]
}

function buildQuestion(bankId, index) {
  const type = getTypeAt(index)
  const number = index + 1
  const answerKeys = buildAnswerKeys(type, index)

  return {
    id: `${bankId}-q${number}`,
    type,
    stem: `【Playground】第 ${number} 题 · ${TYPE_TEXT[type]}`,
    options: buildOptions(type),
    answerKeys,
    explanation: `Playground 生成题，正确答案 ${answerKeys.join('')}。`,
    weight: 1,
    difficulty: index % 3 === 0 ? 'easy' : index % 3 === 1 ? 'normal' : 'hard',
    tags: ['playground', type]
  }
}

function buildQuestions(bankId, count) {
  const safeCount = Math.max(Math.floor(Number(count) || 0), 0)
  const questions = []

  for (let index = 0; index < safeCount; index += 1) {
    questions.push(buildQuestion(bankId, index))
  }

  return questions
}

function findBankDef(bankId) {
  return BANK_DEFS.find((item) => item.id === bankId) || null
}

/** fixtures/question-banks：供 Gateway 的 getQuestionBanks 返回 */
function getPlaygroundBanks(subjectId) {
  if (subjectId && subjectId !== PLAYGROUND_SUBJECT_ID) {
    return []
  }

  return BANK_DEFS.map((bank) => ({
    id: bank.id,
    subjectId: PLAYGROUND_SUBJECT_ID,
    subjectName: 'Playground',
    name: bank.name,
    questionCount: bank.questionCount
  }))
}

/** fixtures/questions：按题库 id 取题。空题库返回空数组，用于验证空态不崩 */
function getPlaygroundQuestions(bankId) {
  const bank = findBankDef(bankId)

  return bank ? buildQuestions(bank.id, bank.questionCount) : []
}

/**
 * fixtures/subjects：返回与 data/catalog.js 同形的科目结构，
 * 这样注入 catalog 后首页 / 题库页无需任何特殊分支。
 */
function getPlaygroundSubjects() {
  const banks = BANK_DEFS.map((bank) => ({
    id: bank.id,
    name: bank.name,
    questionCount: bank.questionCount
  }))

  return [
    {
      id: PLAYGROUND_SUBJECT_ID,
      name: 'Playground',
      theme: 'playground',
      order: 900,
      bankCount: banks.length,
      questionCount: banks.reduce((total, bank) => total + bank.questionCount, 0),
      banks
    }
  ]
}

/**
 * scenarios/half-completed：造一份「答了一半」的会话。
 *
 * 直接写 session-repository 能读的结构，答题页用 ?resume=1 进来就会落在这个进度上——
 * 比手动点 10 题再退出快得多，也是 PRD 11「可靠性」里 currentIndex 可恢复的验证入口。
 */
function buildHalfCompletedSession(bankId, now) {
  const safeBankId = findBankDef(bankId) ? bankId : BANK_DEFS[0].id
  const questions = getPlaygroundQuestions(safeBankId)
  const answeredCount = Math.floor(questions.length / 2)
  const timestamp = typeof now === 'number' ? now : Date.now()

  // 与真实落盘保持一致：questionIds 按 id 排序（与出题顺序解耦），questionOrder 是它的下标排列
  const questionIds = questions.map((question) => question.id).slice().sort()
  const questionOrder = questionIds.map((_, index) => index)

  const answers = questionIds.map((id, index) => {
    if (index >= answeredCount) {
      return null
    }

    const question = questions.find((item) => item.id === id)

    return {
      questionId: id,
      selectedKeys: question ? question.answerKeys.slice() : [],
      isCorrect: true
    }
  })

  return {
    sessionId: createSessionId(timestamp, 0.5),
    subjectId: PLAYGROUND_SUBJECT_ID,
    questionBankId: safeBankId,
    config: {
      mode: 'order',
      subjectId: PLAYGROUND_SUBJECT_ID,
      bankId: safeBankId,
      title: `Playground · ${safeBankId}`
    },
    questionIds,
    questionOrder,
    currentIndex: Math.min(answeredCount, Math.max(questionIds.length - 1, 0)),
    answers,
    elapsedTime: 120,
    status: 'IN_PROGRESS',
    syncStatus: 'LOCAL_ONLY',
    createdAt: timestamp,
    updatedAt: timestamp,
    answeredCount
  }
}

/**
 * fixtures/results：造一份结果快照，字段对齐 API PRD 7.6。
 * 供 Playground 面板展示「结果长什么样」，也让 HTTP 网关有可断言的返回形状。
 */
function buildResultFixture(session) {
  const safeSession = session || {}
  const questionIds = Array.isArray(safeSession.questionIds) ? safeSession.questionIds : []
  const answers = Array.isArray(safeSession.answers) ? safeSession.answers : []
  const questionResults = questionIds.map((id, index) => {
    const answer = answers[index]
    const answered = !!answer

    return {
      questionId: id,
      userAnswer: answered ? (answer.selectedKeys || []).join('') : '',
      correctAnswer: 'A',
      status: !answered ? 'unanswered' : answer.isCorrect ? 'correct' : 'wrong',
      explanation: 'Playground 生成的结果快照。'
    }
  })

  const answeredCount = questionResults.filter((item) => item.status !== 'unanswered').length
  const correctCount = questionResults.filter((item) => item.status === 'correct').length
  const totalCount = questionResults.length

  return {
    sessionId: safeSession.sessionId || '',
    totalCount,
    answeredCount,
    correctCount,
    wrongCount: answeredCount - correctCount,
    unansweredCount: totalCount - answeredCount,
    accuracy: answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0,
    duration: Number(safeSession.elapsedTime) || 0,
    questionResults
  }
}

module.exports = {
  BANK_DEFS,
  PLAYGROUND_SUBJECT_ID,
  TYPE_TEXT,
  buildHalfCompletedSession,
  buildQuestion,
  buildQuestions,
  buildResultFixture,
  getPlaygroundBanks,
  getPlaygroundQuestions,
  getPlaygroundSubjects
}
