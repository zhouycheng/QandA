import type { AdminContentGateway } from '../../src/gateways/admin-content-gateway'
import type {
  CollegeQuery,
  CreateCollegeInput,
  CreateMajorInput,
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  MajorQuery,
  QuestionBankQuery,
  QuestionQuery,
  SubjectQuery,
  UpdateCollegeInput,
  UpdateMajorInput,
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
    const { colleges, subjects, questionBanks, questions } = getMockAdminState()
    return {
      collegeCount: colleges.length,
      subjectCount: subjects.length,
      questionBankCount: questionBanks.length,
      questionCount: questions.length,
    }
  }

  async listColleges(query?: CollegeQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().colleges.filter((college) =>
      normalize(`${college.name} ${college.code}`).includes(keyword),
    )
  }

  async createCollege(input: CreateCollegeInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (state.colleges.some((college) => normalize(college.name) === normalize(name))) {
      throw new Error('学院名称已存在。')
    }
    if (state.colleges.some((college) => normalize(college.code) === normalize(code))) {
      throw new Error('学院代码已存在。')
    }
    const now = new Date().toISOString()
    const college = { ...input, name, code, id: createId('college'), createdAt: now, updatedAt: now }
    state.setColleges([college, ...state.colleges])
    return college
  }

  async updateCollege(id: string, input: UpdateCollegeInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.colleges.find((college) => college.id === id)
    if (!current) throw new Error('学院不存在。')
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (state.colleges.some((college) => college.id !== id && normalize(college.name) === normalize(name))) {
      throw new Error('学院名称已存在。')
    }
    if (state.colleges.some((college) => college.id !== id && normalize(college.code) === normalize(code))) {
      throw new Error('学院代码已存在。')
    }
    const college = { ...current, ...input, name, code, updatedAt: new Date().toISOString() }
    state.setColleges(state.colleges.map((item) => (item.id === id ? college : item)))
    return college
  }

  async deleteCollege(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.majors.some((major) => major.collegeId === id)) {
      throw new Error('学院下仍有专业，请先删除或迁移专业。')
    }
    state.setColleges(state.colleges.filter((college) => college.id !== id))
  }

  async listMajors(query?: MajorQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().majors
      .filter((major) => !query?.collegeId || major.collegeId === query.collegeId)
      .filter((major) => normalize(`${major.name} ${major.code}`).includes(keyword))
  }

  async createMajor(input: CreateMajorInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (!state.colleges.some((college) => college.id === input.collegeId)) {
      throw new Error('所属学院不存在。')
    }
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (state.majors.some((major) => major.collegeId === input.collegeId && normalize(major.name) === normalize(name))) {
      throw new Error('该学院下已存在同名专业。')
    }
    if (state.majors.some((major) => major.collegeId === input.collegeId && normalize(major.code) === normalize(code))) {
      throw new Error('该学院下已存在相同专业代码。')
    }
    const now = new Date().toISOString()
    const major = { ...input, name, code, id: createId('major'), createdAt: now, updatedAt: now }
    state.setMajors([major, ...state.majors])
    return major
  }

  async updateMajor(id: string, input: UpdateMajorInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.majors.find((major) => major.id === id)
    if (!current) throw new Error('专业不存在。')
    if (!state.colleges.some((college) => college.id === input.collegeId)) {
      throw new Error('所属学院不存在。')
    }
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (state.majors.some((major) => major.id !== id && major.collegeId === input.collegeId && normalize(major.name) === normalize(name))) {
      throw new Error('该学院下已存在同名专业。')
    }
    if (state.majors.some((major) => major.id !== id && major.collegeId === input.collegeId && normalize(major.code) === normalize(code))) {
      throw new Error('该学院下已存在相同专业代码。')
    }
    const major = { ...current, ...input, name, code, updatedAt: new Date().toISOString() }
    state.setMajors(state.majors.map((item) => (item.id === id ? major : item)))
    return major
  }

  async deleteMajor(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.subjects.some((subject) => subject.majorIds.includes(id))) {
      throw new Error('专业仍关联科目，请先解除关联。')
    }
    state.setMajors(state.majors.filter((major) => major.id !== id))
  }

  async listSubjects(query?: SubjectQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().subjects
      .filter((subject) => !query?.majorId || subject.majorIds.includes(query.majorId))
      .filter((subject) => normalize(subject.name).includes(keyword))
  }

  async createSubject(input: CreateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const majorIds = [...new Set(input.majorIds)]
    if (majorIds.length === 0) {
      throw new Error('请至少选择一个适用专业。')
    }
    if (majorIds.some((majorId) => !state.majors.some((major) => major.id === majorId))) {
      throw new Error('选择的专业不存在。')
    }
    if (state.subjects.some((subject) => normalize(subject.name) === normalize(input.name))) {
      throw new Error('科目名称已存在，可编辑已有科目并关联专业。')
    }
    const now = new Date().toISOString()
    const subject = { ...input, majorIds, name: input.name.trim(), id: createId('subject'), createdAt: now, updatedAt: now }
    state.setSubjects([subject, ...state.subjects])
    return subject
  }

  async updateSubject(id: string, input: UpdateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.subjects.find((subject) => subject.id === id)
    if (!current) throw new Error('科目不存在。')
    const majorIds = [...new Set(input.majorIds)]
    if (majorIds.length === 0) {
      throw new Error('请至少选择一个适用专业。')
    }
    if (majorIds.some((majorId) => !state.majors.some((major) => major.id === majorId))) {
      throw new Error('选择的专业不存在。')
    }
    if (state.subjects.some((subject) => subject.id !== id && normalize(subject.name) === normalize(input.name))) {
      throw new Error('科目名称已存在。')
    }
    const subject = { ...current, ...input, majorIds, name: input.name.trim(), updatedAt: new Date().toISOString() }
    state.setSubjects(state.subjects.map((item) => (item.id === id ? subject : item)))
    return subject
  }

  async deleteSubject(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.questionBanks.some((bank) => bank.subjectId === id)) {
      throw new Error('科目下仍有题库，请先删除或迁移题库。')
    }
    state.setSubjects(state.subjects.filter((subject) => subject.id !== id))
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
