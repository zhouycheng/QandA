import type { ContentStatus, QuestionType } from '../types/admin'

export const statusLabels: Record<ContentStatus, string> = {
  ACTIVE: '已启用',
  INACTIVE: '已停用',
}

export const questionTypeLabels: Record<QuestionType, string> = {
  SINGLE_CHOICE: '单选题',
  MULTIPLE_CHOICE: '多选题',
  TRUE_FALSE: '判断题',
}
