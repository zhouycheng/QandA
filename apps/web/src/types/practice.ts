export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'
export type QuestionOrder = 'SEQUENTIAL' | 'RANDOM'
export type FeedbackMode = 'IMMEDIATE' | 'DEFERRED'
export type TimerMode = 'OFF' | 'COUNT_UP'
export type SessionStatus = 'IN_PROGRESS' | 'SUBMITTED'
export type SyncStatus = 'LOCAL_ONLY' | 'SYNC_PENDING' | 'SYNCING' | 'SYNCED' | 'SYNC_FAILED'
export type QuestionResultStatus = 'CORRECT' | 'WRONG' | 'UNANSWERED'

export interface Subject {
  id: string
  name: string
  description: string
  questionBankCount: number
  questionCount: number
}

export interface QuestionBank {
  id: string
  subjectId: string
  name: string
  description: string
  questionCount: number
  difficulty: '基础' | '进阶' | '综合'
}

export interface QuestionOption {
  key: string
  content: string
}

export interface Question {
  id: string
  questionBankId: string
  type: QuestionType
  stem: string
  options: QuestionOption[]
  correctAnswer: string[]
  explanation: string
}

export interface PracticeConfig {
  questionCount: number
  order: QuestionOrder
  feedbackMode: FeedbackMode
  autoNext: boolean
  timerMode: TimerMode
}

export interface CreateSessionInput {
  subjectId: string
  questionBankId: string
  config: PracticeConfig
}

export interface PracticeSession {
  id: string
  subjectId: string
  questionBankId: string
  config: PracticeConfig
  questionIds: string[]
  currentIndex: number
  answers: Record<string, string[]>
  confirmedQuestionIds: string[]
  elapsedSeconds: number
  status: SessionStatus
  syncStatus: SyncStatus
  startedAt: string
  updatedAt: string
}

export interface QuestionResult {
  questionId: string
  stem: string
  options: QuestionOption[]
  type: QuestionType
  userAnswer: string[]
  correctAnswer: string[]
  status: QuestionResultStatus
  explanation: string
}

export interface PracticeResult {
  sessionId: string
  subjectId: string
  questionBankId: string
  totalCount: number
  answeredCount: number
  correctCount: number
  wrongCount: number
  unansweredCount: number
  accuracy: number
  duration: number
  questionResults: QuestionResult[]
  submittedAt: string
}
