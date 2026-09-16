import type { AdminContentGateway } from '../../src/gateways/admin-content-gateway'
import type {
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  QuestionBankQuery,
  QuestionQuery,
  SubjectQuery,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
  UpdateSubjectInput,
} from '../../src/types/admin'
import { getMockAdminState } from '../store/mock-admin-store'

const DEFAULT_DELAY = 300

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function simulateRequest(operation: 'read' | 'write' = 'read') {
  const { scenario } = getMockAdminState()
  const delay = scenario === 'slow' ? 3000 : DEFAULT_DELAY
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (scenario === 'error' || (scenario === 'write-error' && operation === 'write')) {
    throw new Error('Playground 已模拟服务异常，请切换场景后重试。')
  }
}

function normalize(value?: string) {
  return value?.trim().toLocaleLowerCase() ?? ''
}

export class MockAdminContentGateway implements AdminContentGateway {
  async getDashboardSummary() {
    await simulateRequest()
    const { subjects, questionBanks, questions } = getMockAdminState()
    return {
      subjectCount: subjects.length,
      questionBankCount: questionBanks.length,
      questionCount: questions.length,
    }
  }

  async listSubjects(query?: SubjectQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().subjects.filter((subject) =>
      normalize(subject.name).includes(keyword),
    )
  }

  async createSubject(input: CreateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.subjects.some((subject) => subject.name === input.name.trim())) {
      throw new Error('科目名称已存在。')
    }
    const now = new Date().toISOString()
    const subject = { ...input, name: input.name.trim(), id: createId('subject'), createdAt: now, updatedAt: now }
    state.setSubjects([subject, ...state.subjects])
    return subject
  }

  async updateSubject(id: string, input: UpdateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.subjects.find((subject) => subject.id === id)
    if (!current) throw new Error('科目不存在。')
    if (state.subjects.some((subject) => subject.id !== id && subject.name === input.name.trim())) {
      throw new Error('科目名称已存在。')
    }
    const subject = { ...current, ...input, name: input.name.trim(), updatedAt: new Date().toISOString() }
    state.setSubjects(state.subjects.map((item) => (item.id === id ? subject : item)))
    return subject
  }

  async listQuestionBanks(query?: QuestionBankQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    const { questionBanks, questions } = getMockAdminState()
    return questionBanks
      .filter((bank) => !query?.subjectId || bank.subjectId === query.subjectId)
      .filter((bank) => normalize(bank.name).includes(keyword))
      .map((bank) => ({
        ...bank,
        questionCount: questions.filter((question) => question.questionBankId === bank.id).length,
      }))
  }

  async createQuestionBank(input: CreateQuestionBankInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const now = new Date().toISOString()
    const bank = {
      ...input,
      name: input.name.trim(),
      description: input.description.trim(),
      id: createId('bank'),
      questionCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    state.setQuestionBanks([bank, ...state.questionBanks])
    return bank
  }

  async updateQuestionBank(id: string, input: UpdateQuestionBankInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.questionBanks.find((bank) => bank.id === id)
    if (!current) throw new Error('题库不存在。')
    const bank = {
      ...current,
      ...input,
      name: input.name.trim(),
      description: input.description.trim(),
      updatedAt: new Date().toISOString(),
    }
    state.setQuestionBanks(state.questionBanks.map((item) => (item.id === id ? bank : item)))
    return bank
  }

  async deleteQuestionBank(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.questions.some((question) => question.questionBankId === id)) {
      throw new Error('题库中仍有题目，请先删除或迁移题目。')
    }
    state.setQuestionBanks(state.questionBanks.filter((bank) => bank.id !== id))
  }

  async listQuestions(query?: QuestionQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().questions
      .filter((question) => !query?.questionBankId || question.questionBankId === query.questionBankId)
      .filter((question) => !query?.type || question.type === query.type)
      .filter((question) => !query?.status || question.status === query.status)
      .filter((question) => {
        const searchable = `${question.stem} ${question.options.map((option) => option.content).join(' ')}`
        return normalize(searchable).includes(keyword)
      })
  }

  async getQuestion(id: string) {
    await simulateRequest()
    const question = getMockAdminState().questions.find((item) => item.id === id)
    if (!question) throw new Error('题目不存在。')
    return question
  }

  async createQuestion(input: CreateQuestionInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const now = new Date().toISOString()
    const question = { ...input, id: createId('question'), createdAt: now, updatedAt: now }
    state.setQuestions([question, ...state.questions])
    return question
  }

  async updateQuestion(id: string, input: UpdateQuestionInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.questions.find((question) => question.id === id)
    if (!current) throw new Error('题目不存在。')
    const question = { ...current, ...input, updatedAt: new Date().toISOString() }
    state.setQuestions(state.questions.map((item) => (item.id === id ? question : item)))
    return question
  }

  async deleteQuestion(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    state.setQuestions(state.questions.filter((question) => question.id !== id))
  }
}
