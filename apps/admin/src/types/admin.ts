export type ContentStatus = 'ACTIVE' | 'INACTIVE'
export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'
export type BankPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'

export interface BankAudience {
  collegeId?: string
  majorId?: string
  enrollmentYear?: number
}

export interface Chapter {
  id: string
  questionBankId: string
  name: string
  sortOrder: number
}

export interface College {
  id: string
  name: string
  code: string
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export interface Major {
  id: string
  collegeId: string
  name: string
  code: string
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export interface Subject {
  id: string
  majorIds: string[]
  name: string
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export interface QuestionBank {
  id: string
  subjectId: string
  name: string
  description: string
  status: ContentStatus
  questionCount: number
  activeQuestionCount?: number
  textbook: string
  owner: string
  publicationStatus: BankPublicationStatus
  scopeType: 'ALL' | 'TARGETED'
  audiences: BankAudience[]
  createdAt: string
  updatedAt: string
}

export interface QuestionOption {
  key: string
  content: string
}

export interface Question {
  id: string
  questionBankId: string
  chapterId?: string
  revision?: number
  stem: string
  type: QuestionType
  options: QuestionOption[]
  correctAnswer: string[]
  explanation: string
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export type CreateSubjectInput = Pick<Subject, 'majorIds' | 'name' | 'status'>
export type UpdateSubjectInput = CreateSubjectInput
export type CreateCollegeInput = Pick<College, 'name' | 'code' | 'status'>
export type UpdateCollegeInput = CreateCollegeInput
export type CreateMajorInput = Pick<Major, 'collegeId' | 'name' | 'code' | 'status'>
export type UpdateMajorInput = CreateMajorInput

export type CreateQuestionBankInput = Pick<QuestionBank, 'subjectId' | 'name' | 'description' | 'status'> &
  Partial<Pick<QuestionBank, 'textbook' | 'owner' | 'scopeType' | 'audiences'>>
export type UpdateQuestionBankInput = CreateQuestionBankInput

export type CreateQuestionInput = Pick<
  Question,
  'questionBankId' | 'chapterId' | 'stem' | 'type' | 'options' | 'correctAnswer' | 'explanation' | 'status'
>
export type UpdateQuestionInput = CreateQuestionInput

export interface SubjectQuery {
  keyword?: string
  majorId?: string
}

export interface CollegeQuery {
  keyword?: string
}

export interface MajorQuery {
  keyword?: string
  collegeId?: string
}

export interface QuestionBankQuery {
  keyword?: string
  subjectId?: string
}

export interface QuestionQuery {
  keyword?: string
  questionBankId?: string
  chapterId?: string
  type?: QuestionType
  status?: ContentStatus
}

export interface DashboardSummary {
  collegeCount: number
  subjectCount: number
  questionBankCount: number
  questionCount: number
  userCount: number
  answeredCount: number
  choiceCount: number
  trueFalseCount: number
}
