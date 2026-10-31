import type {
  BankPublicationStatus,
  Chapter,
  College,
  CollegeQuery,
  CreateCollegeInput,
  CreateMajorInput,
  CreateGradesInput,
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  DashboardSummary,
  Major,
  Grade,
  MajorQuery,
  Question,
  QuestionBank,
  QuestionBankQuery,
  QuestionQuery,
  Subject,
  SubjectQuery,
  UpdateCollegeInput,
  UpdateMajorInput,
  UpdateGradeInput,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
  UpdateSubjectInput,
} from '../types/admin'
import type {
  StudentFeedback,
  UserCourse,
  UserStatus,
  ActivityQuery,
  ActivitySummary,
  AdminAccount,
  AdminAccountInput,
  Announcement,
  AnnouncementInput,
  ImportQuestionsInput,
  LogQuery,
  ManagedUser,
  OperationLog,
  SecuritySettings,
  UserQuery,
} from '../types/operations'

export interface AdminContentGateway {
  listChapters(questionBankId?: string): Promise<Chapter[]>
  saveChapter(id: string | undefined, input: Omit<Chapter, 'id'>): Promise<Chapter>
  deleteChapter(id: string): Promise<void>
  reorderChapters(questionBankId: string, ids: string[]): Promise<void>
  setBankPublication(id: string, status: BankPublicationStatus): Promise<QuestionBank>
  listFeedback(): Promise<StudentFeedback[]>
  updateFeedback(id: string, input: Pick<StudentFeedback, 'status' | 'response'>): Promise<StudentFeedback>
  listUserCourses(userId?: string): Promise<UserCourse[]>
  setUserStatus(id: string, status: UserStatus): Promise<ManagedUser>
  listUsers(query?: UserQuery): Promise<ManagedUser[]>
  listAdminAccounts(): Promise<AdminAccount[]>
  saveAdminAccount(id: string | undefined, input: AdminAccountInput): Promise<AdminAccount>
  deleteAdminAccount(id: string): Promise<void>
  loginAdmin(username: string, password: string): Promise<AdminAccount>
  listAnnouncements(): Promise<Announcement[]>
  saveAnnouncement(id: string | undefined, input: AnnouncementInput): Promise<Announcement>
  deleteAnnouncement(id: string): Promise<void>
  getSecuritySettings(): Promise<SecuritySettings>
  saveSecuritySettings(input: SecuritySettings): Promise<SecuritySettings>
  listOperationLogs(query?: LogQuery): Promise<OperationLog[]>
  getActivity(query: ActivityQuery): Promise<ActivitySummary>
  importQuestions(input: ImportQuestionsInput): Promise<number>
  getDashboardSummary(): Promise<DashboardSummary>

  listColleges(query?: CollegeQuery): Promise<College[]>
  createCollege(input: CreateCollegeInput): Promise<College>
  updateCollege(id: string, input: UpdateCollegeInput): Promise<College>
  deleteCollege(id: string): Promise<void>

  listMajors(query?: MajorQuery): Promise<Major[]>
  createMajor(input: CreateMajorInput): Promise<Major>
  updateMajor(id: string, input: UpdateMajorInput): Promise<Major>
  deleteMajor(id: string): Promise<void>

  listGrades(majorId?: string): Promise<Grade[]>
  createGrades(input: CreateGradesInput): Promise<Grade[]>
  updateGrade(id: string, input: UpdateGradeInput): Promise<Grade>
  deleteGrade(id: string): Promise<void>

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
