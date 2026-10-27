import type { Chapter } from '../../src/types/admin'
import type { StudentFeedback, UserCourse } from '../../src/types/operations'
import { questionFixtures } from './questions'

export const chapterFixtures: Chapter[] = [
  { id: 'chapter-limits', questionBankId: 'bank-calculus', name: '函数与极限', sortOrder: 0 },
  { id: 'chapter-derivatives', questionBankId: 'bank-calculus', name: '导数与微分', sortOrder: 1 },
  { id: 'chapter-tense', questionBankId: 'bank-english-grammar', name: '动词时态', sortOrder: 0 },
]

export const userCourseFixtures: UserCourse[] = [
  {
    userId: 'user-1',
    subjectId: 'subject-math',
    preferredBankId: 'bank-calculus',
    addedAt: '2026-10-20T08:00:00Z',
  },
  {
    userId: 'user-1',
    subjectId: 'subject-english',
    preferredBankId: 'bank-english-grammar',
    addedAt: '2026-10-21T08:00:00Z',
  },
  {
    userId: 'user-6',
    subjectId: 'subject-math',
    preferredBankId: 'bank-calculus',
    addedAt: '2026-10-22T08:00:00Z',
  },
]

export const feedbackFixtures: StudentFeedback[] = [
  {
    id: 'feedback-1',
    kind: 'QUESTION',
    userId: 'user-1',
    title: '导数题的解析可以更详细一些吗？',
    body: '答案我理解了，但希望补充求导公式和代入的步骤。',
    category: '解析建议',
    questionId: 'question-single',
    questionBankId: 'bank-calculus',
    questionRevision: 1,
    questionSnapshot: structuredClone(questionFixtures[0]),
    status: 'OPEN',
    response: '',
    createdAt: '2026-10-24T11:30:00Z',
    updatedAt: '2026-10-24T11:30:00Z',
  },
  {
    id: 'feedback-2',
    kind: 'COURSE_REQUEST',
    userId: 'user-2',
    title: '希望增加数据结构期末题库',
    body: '软件工程专业，希望有线性表、栈、队列和树的章节练习。',
    category: '缺课需求',
    status: 'OPEN',
    response: '',
    createdAt: '2026-10-24T09:00:00Z',
    updatedAt: '2026-10-24T09:00:00Z',
  },
  {
    id: 'feedback-3',
    kind: 'COURSE_REQUEST',
    userId: 'user-3',
    title: '希望增加大学语文复习题',
    body: '想复习古诗文和文学常识。',
    category: '缺课需求',
    status: 'IN_PROGRESS',
    response: '正在整理首批内容，发布后会通过公告通知。',
    createdAt: '2026-10-23T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
  },
]
