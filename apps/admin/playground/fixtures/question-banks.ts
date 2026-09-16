import type { QuestionBank } from '../../src/types/admin'

export const questionBankFixtures: QuestionBank[] = [
  {
    id: 'bank-calculus',
    subjectId: 'subject-math',
    name: '微积分基础题库',
    description: '函数、极限、导数与积分基础练习。',
    status: 'ACTIVE',
    questionCount: 2,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
  },
  {
    id: 'bank-english-grammar',
    subjectId: 'subject-english',
    name: '英语语法题库',
    description: '大学英语常用语法练习。',
    status: 'ACTIVE',
    questionCount: 1,
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-05T08:00:00.000Z',
  },
]
