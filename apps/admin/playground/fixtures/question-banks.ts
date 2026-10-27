import type { QuestionBank } from '../../src/types/admin'

export const questionBankFixtures: QuestionBank[] = [
  {
    id: 'bank-calculus',
    subjectId: 'subject-math',
    name: '微积分基础题库',
    description: '函数、极限、导数与积分基础练习。',
    status: 'ACTIVE',
    questionCount: 2,
    textbook: '同济版高等数学 · 上册',
    owner: '内容组 · 小林',
    publicationStatus: 'PUBLISHED',
    scopeType: 'TARGETED',
    audiences: [{ majorId: 'major-computer-science' }, { majorId: 'major-software-engineering' }],
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
    textbook: '大学英语通用语法复习',
    owner: '内容组 · 小陈',
    publicationStatus: 'PUBLISHED',
    scopeType: 'ALL',
    audiences: [],
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-05T08:00:00.000Z',
  },
]
