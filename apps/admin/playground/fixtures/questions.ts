import type { Question } from '../../src/types/admin'

export const questionFixtures: Question[] = [
  {
    id: 'question-single',
    questionBankId: 'bank-calculus',
    stem: '函数 f(x) = x² 在 x = 2 处的导数是多少？',
    type: 'SINGLE_CHOICE',
    options: [
      { key: 'A', content: '2' },
      { key: 'B', content: '4' },
      { key: 'C', content: '6' },
      { key: 'D', content: '8' },
    ],
    correctAnswer: ['B'],
    explanation: 'f′(x) = 2x，因此 f′(2) = 4。',
    status: 'ACTIVE',
    createdAt: '2026-09-06T08:00:00.000Z',
    updatedAt: '2026-09-06T08:00:00.000Z',
  },
  {
    id: 'question-multiple',
    questionBankId: 'bank-calculus',
    stem: '下列哪些函数在其定义域内连续？',
    type: 'MULTIPLE_CHOICE',
    options: [
      { key: 'A', content: '常数函数' },
      { key: 'B', content: '一次函数' },
      { key: 'C', content: '正弦函数' },
      { key: 'D', content: '符号函数' },
    ],
    correctAnswer: ['A', 'B', 'C'],
    explanation: '常数函数、一次函数和正弦函数均在各自定义域内连续。',
    status: 'ACTIVE',
    createdAt: '2026-09-07T08:00:00.000Z',
    updatedAt: '2026-09-07T08:00:00.000Z',
  },
  {
    id: 'question-true-false',
    questionBankId: 'bank-english-grammar',
    stem: '“She has finished her homework.” 使用了现在完成时。',
    type: 'TRUE_FALSE',
    options: [
      { key: 'TRUE', content: '正确' },
      { key: 'FALSE', content: '错误' },
    ],
    correctAnswer: ['TRUE'],
    explanation: 'has finished 是 have/has + 过去分词结构。',
    status: 'ACTIVE',
    createdAt: '2026-09-08T08:00:00.000Z',
    updatedAt: '2026-09-08T08:00:00.000Z',
  },
]
