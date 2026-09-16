import type {
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  DashboardSummary,
  Question,
  QuestionBank,
  QuestionBankQuery,
  QuestionQuery,
  Subject,
  SubjectQuery,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
  UpdateSubjectInput,
} from '../types/admin'

export interface AdminContentGateway {
  getDashboardSummary(): Promise<DashboardSummary>

  listSubjects(query?: SubjectQuery): Promise<Subject[]>
  createSubject(input: CreateSubjectInput): Promise<Subject>
  updateSubject(id: string, input: UpdateSubjectInput): Promise<Subject>

  listQuestionBanks(query?: QuestionBankQuery): Promise<QuestionBank[]>
  createQuestionBank(input: CreateQuestionBankInput): Promise<QuestionBank>
  updateQuestionBank(id: string, input: UpdateQuestionBankInput): Promise<QuestionBank>
  deleteQuestionBank(id: string): Promise<void>

  listQuestions(query?: QuestionQuery): Promise<Question[]>
  getQuestion(id: string): Promise<Question>
  createQuestion(input: CreateQuestionInput): Promise<Question>
  updateQuestion(id: string, input: UpdateQuestionInput): Promise<Question>
  deleteQuestion(id: string): Promise<void>
}
