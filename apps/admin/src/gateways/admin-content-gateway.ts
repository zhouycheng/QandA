import type {
  College,
  CollegeQuery,
  CreateCollegeInput,
  CreateMajorInput,
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  DashboardSummary,
  Major,
  MajorQuery,
  Question,
  QuestionBank,
  QuestionBankQuery,
  QuestionQuery,
  Subject,
  SubjectQuery,
  UpdateCollegeInput,
  UpdateMajorInput,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
  UpdateSubjectInput,
} from '../types/admin'

export interface AdminContentGateway {
  getDashboardSummary(): Promise<DashboardSummary>

  listColleges(query?: CollegeQuery): Promise<College[]>
  createCollege(input: CreateCollegeInput): Promise<College>
  updateCollege(id: string, input: UpdateCollegeInput): Promise<College>
  deleteCollege(id: string): Promise<void>

  listMajors(query?: MajorQuery): Promise<Major[]>
  createMajor(input: CreateMajorInput): Promise<Major>
  updateMajor(id: string, input: UpdateMajorInput): Promise<Major>
  deleteMajor(id: string): Promise<void>

  listSubjects(query?: SubjectQuery): Promise<Subject[]>
  createSubject(input: CreateSubjectInput): Promise<Subject>
  updateSubject(id: string, input: UpdateSubjectInput): Promise<Subject>
  deleteSubject(id: string): Promise<void>

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
