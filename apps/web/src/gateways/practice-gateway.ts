import type {
  CreateSessionInput,
  PracticeResult,
  PracticeSession,
  Question,
  QuestionBank,
  Subject,
} from '../types/practice'

export interface PracticeGateway {
  listSubjects(): Promise<Subject[]>
  listQuestionBanks(subjectId: string): Promise<QuestionBank[]>
  getQuestionBank(questionBankId: string): Promise<QuestionBank>
  createSession(input: CreateSessionInput): Promise<PracticeSession>
  getQuestions(questionIds: string[]): Promise<Question[]>
  submitSession(session: PracticeSession): Promise<PracticeResult>
  getResult(sessionId: string): Promise<PracticeResult>
}
