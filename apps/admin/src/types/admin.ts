export type ContentStatus = 'ACTIVE' | 'INACTIVE'
export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'

export interface Subject {
  id: string
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
  stem: string
  type: QuestionType
  options: QuestionOption[]
  correctAnswer: string[]
  explanation: string
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export type CreateSubjectInput = Pick<Subject, 'name' | 'status'>
export type UpdateSubjectInput = CreateSubjectInput

export type CreateQuestionBankInput = Pick<
  QuestionBank,
  'subjectId' | 'name' | 'description' | 'status'
>
export type UpdateQuestionBankInput = CreateQuestionBankInput

export type CreateQuestionInput = Pick<
  Question,
  | 'questionBankId'
  | 'stem'
  | 'type'
  | 'options'
  | 'correctAnswer'
  | 'explanation'
  | 'status'
>
export type UpdateQuestionInput = CreateQuestionInput

export interface SubjectQuery {
  keyword?: string
}

export interface QuestionBankQuery {
  keyword?: string
  subjectId?: string
}

export interface QuestionQuery {
  keyword?: string
  questionBankId?: string
  type?: QuestionType
  status?: ContentStatus
}

export interface DashboardSummary {
  subjectCount: number
  questionBankCount: number
  questionCount: number
}
