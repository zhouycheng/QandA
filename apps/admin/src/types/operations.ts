import type { ContentStatus, CreateQuestionInput } from './admin'

export type UserStatus = 'ACTIVE' | 'PENDING' | 'DISABLED'
export type LoginPlatform = 'MINIAPP' | 'WEB'

export interface ManagedUser {
  id: string
  name: string
  account: string
  email: string
  wechatBound: boolean
  collegeId: string
  majorId: string
  enrollmentYear?: number
  registeredAt?: string
  status: UserStatus
  answeredCount: number
  activeDays: number
  preferredHours: string
  platforms: LoginPlatform[]
  lastActiveAt: string
}
export interface UserQuery {
  keyword?: string
  collegeId?: string
  majorId?: string
  status?: UserStatus
}

export interface AdminAccount {
  id: string
  name: string
  username: string
  status: ContentStatus
  createdAt: string
  lastLoginAt?: string
}
export interface AdminAccountInput {
  name: string
  username: string
  status: ContentStatus
  password?: string
}
export interface StoredAdminAccount extends AdminAccount {
  passwordHash: string
}

export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED'
export interface Announcement {
  id: string
  title: string
  summary: string
  body: string
  audience: 'ALL' | 'SELECTED'
  userIds: string[]
  platforms: LoginPlatform[]
  status: AnnouncementStatus
  publishAt?: string
  updatedAt: string
}
export type AnnouncementInput = Omit<Announcement, 'id' | 'updatedAt'>

export interface UserCourse {
  userId: string
  subjectId: string
  preferredBankId?: string
  addedAt: string
}

export type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED'
export interface StudentFeedback {
  id: string
  kind: 'QUESTION' | 'COURSE_REQUEST'
  userId: string
  title: string
  body: string
  category: string
  questionId?: string
  questionBankId?: string
  questionRevision?: number
  questionSnapshot?: Pick<import('./admin').Question, 'stem' | 'options' | 'correctAnswer' | 'explanation'>
  status: FeedbackStatus
  response: string
  createdAt: string
  updatedAt: string
}

export interface SecuritySettings {
  lockEnabled: boolean
  maxAttempts: number
  lockMinutes: number
  sessionMinutes: number
  newDeviceVerification: boolean
  minPasswordLength: number
  requireLetter: boolean
  requireNumber: boolean
  requireMixedCase: boolean
  changeInitialPassword: boolean
  updatedAt?: string
}

export interface OperationLog {
  id: string
  createdAt: string
  actor: string
  module: string
  content: string
  result: 'SUCCESS' | 'FAILURE'
  ip: string
}
export interface LogQuery {
  keyword?: string
  module?: string
  result?: OperationLog['result']
  start?: string
  end?: string
}

export interface ActivityRecord {
  date: string
  platform: LoginPlatform
  userIds: string[]
  newUsers: number
  returningUsers: number
  answeredCount: number
  correctCount: number
  hours: number[]
}
export interface ActivityQuery {
  start: string
  end: string
  platform?: LoginPlatform
}
export interface ActivitySummary {
  dailyActive: number
  weeklyActive: number
  monthlyActive: number
  retention: number
  records: ActivityRecord[]
  ranking: ManagedUser[]
}
export interface ImportQuestionsInput {
  questionBankId: string
  questions: CreateQuestionInput[]
}
