import type { PracticeGateway } from '../../src/gateways/practice-gateway'
import { answerEquals } from '../../src/lib/format'
import type {
  CreateSessionInput,
  PracticeResult,
  PracticeSession,
  Question,
} from '../../src/types/practice'
import { createLargeQuestionSet, questionBanks, questions, subjects } from '../fixtures/practice-data'
import { getPlaygroundScenario } from '../store/playground-store'

const RESULTS_KEY = 'qanda.web.practice-results.v1'

function createId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function shuffle<T>(values: T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

async function simulateRequest(operation: 'read' | 'submit' = 'read') {
  const scenario = getPlaygroundScenario()
  const delay = scenario === 'slow' ? 3000 : 260
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (scenario === 'error' || (scenario === 'submit-error' && operation === 'submit')) {
    throw new Error(operation === 'submit'
      ? '模拟提交失败。答案已保存在此设备，可以稍后重试。'
      : '模拟请求失败，请切换场景后重试。')
  }
}

function readResults(): PracticeResult[] {
  try {
    return JSON.parse(window.localStorage.getItem(RESULTS_KEY) ?? '[]') as PracticeResult[]
  } catch {
    return []
  }
}

function saveResult(result: PracticeResult) {
  const results = readResults().filter((item) => item.sessionId !== result.sessionId)
  window.localStorage.setItem(RESULTS_KEY, JSON.stringify([result, ...results]))
}

export function buildPracticeResult(session: PracticeSession, sourceQuestions: Question[]): PracticeResult {
  const questionResults = sourceQuestions.map((question) => {
    const userAnswer = session.answers[question.id] ?? []
    const status = userAnswer.length === 0
      ? 'UNANSWERED' as const
      : answerEquals(userAnswer, question.correctAnswer)
        ? 'CORRECT' as const
        : 'WRONG' as const
    return {
      questionId: question.id,
      stem: question.stem,
      options: question.options,
      type: question.type,
      userAnswer,
      correctAnswer: question.correctAnswer,
      status,
      explanation: question.explanation,
    }
  })
  const correctCount = questionResults.filter((item) => item.status === 'CORRECT').length
  const wrongCount = questionResults.filter((item) => item.status === 'WRONG').length
  const unansweredCount = questionResults.filter((item) => item.status === 'UNANSWERED').length
  return {
    sessionId: session.id,
    subjectId: session.subjectId,
    questionBankId: session.questionBankId,
    totalCount: questionResults.length,
    answeredCount: questionResults.length - unansweredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    accuracy: questionResults.length ? Math.round((correctCount / questionResults.length) * 100) : 0,
    duration: session.elapsedSeconds,
    questionResults,
    submittedAt: new Date().toISOString(),
  }
}

export class MockPracticeGateway implements PracticeGateway {
  async listSubjects() {
    await simulateRequest()
    return getPlaygroundScenario() === 'empty' ? [] : subjects
  }

  async listQuestionBanks(subjectId: string) {
    await simulateRequest()
    return getPlaygroundScenario() === 'empty'
      ? []
      : questionBanks.filter((bank) => bank.subjectId === subjectId)
  }

  async getQuestionBank(questionBankId: string) {
    await simulateRequest()
    const bank = questionBanks.find((item) => item.id === questionBankId)
    if (!bank) throw new Error('题库不存在或已停用。')
    return bank
  }

  async createSession(input: CreateSessionInput) {
    await simulateRequest()
    const source = getPlaygroundScenario() === 'large'
      ? createLargeQuestionSet(input.questionBankId)
      : questions.filter((question) => question.questionBankId === input.questionBankId)
    if (!source.length) throw new Error('该题库暂时没有可练习的题目。')
    const ordered = input.config.order === 'RANDOM' ? shuffle(source) : source
    const selected = ordered.slice(0, Math.min(input.config.questionCount, ordered.length))
    const now = new Date().toISOString()
    return {
      id: createId(),
      subjectId: input.subjectId,
      questionBankId: input.questionBankId,
      config: input.config,
      questionIds: selected.map((question) => question.id),
      currentIndex: 0,
      answers: {},
      confirmedQuestionIds: [],
      elapsedSeconds: 0,
      status: 'IN_PROGRESS',
      syncStatus: 'LOCAL_ONLY',
      startedAt: now,
      updatedAt: now,
    } satisfies PracticeSession
  }

  async getQuestions(questionIds: string[]) {
    await simulateRequest()
    const allQuestions = getPlaygroundScenario() === 'large'
      ? questionBanks.flatMap((bank) => createLargeQuestionSet(bank.id))
      : questions
    const byId = new Map(allQuestions.map((question) => [question.id, question]))
    return questionIds.map((id) => byId.get(id)).filter((value): value is Question => Boolean(value))
  }

  async submitSession(session: PracticeSession) {
    await simulateRequest('submit')
    const sessionQuestions = await this.getQuestions(session.questionIds)
    const result = buildPracticeResult(session, sessionQuestions)
    saveResult(result)
    return result
  }

  async getResult(sessionId: string) {
    await simulateRequest()
    const result = readResults().find((item) => item.sessionId === sessionId)
    if (!result) throw new Error('练习结果不存在，请重新提交。')
    return result
  }
}
