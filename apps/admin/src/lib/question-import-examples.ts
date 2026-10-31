import type { QuestionContent, QuestionType } from '../types/admin'

const single: QuestionContent = {
  type: 'SINGLE_CHOICE', stem: '1 + 1 等于？', options: [{ key: 'A', content: '2' }, { key: 'B', content: '3' }], correctAnswer: ['A'], explanation: '1 + 1 = 2。',
}
const short: QuestionContent = {
  type: 'SHORT_ANSWER', stem: '简述良好学习习惯的两个特点。', options: [], correctAnswer: [], referenceAnswer: '制定合理计划，并通过定期复习巩固知识。', scoringPoints: ['说明计划性', '说明定期复习的重要性'], explanation: '可结合自己的学习经历展开，围绕计划与复习两个方面自评。',
}
export const questionImportExamples: Record<QuestionType, QuestionContent> = {
  SINGLE_CHOICE: single,
  MULTIPLE_CHOICE: { type: 'MULTIPLE_CHOICE', stem: '以下哪些是偶数？', options: [{ key: 'A', content: '2' }, { key: 'B', content: '4' }, { key: 'C', content: '5' }], correctAnswer: ['A', 'B'], explanation: '2 和 4 都能被 2 整除。' },
  TRUE_FALSE: { type: 'TRUE_FALSE', stem: '2 是偶数。', options: [{ key: 'TRUE', content: '正确' }, { key: 'FALSE', content: '错误' }], correctAnswer: ['TRUE'], explanation: '2 能被 2 整除。' },
  FILL_BLANK: { type: 'FILL_BLANK', stem: '水的化学式是 {{1}}，常压沸点是 {{2}} ℃。', options: [], correctAnswer: [], blanks: [{ answers: ['H₂O', 'H2O'] }, { answers: ['100', '一百'] }], blankMatch: { ignoreCase: true, trimWhitespace: true }, explanation: '水由氢、氧组成，在标准大气压下沸点为 100 ℃。' },
  SHORT_ANSWER: short,
  READING: { type: 'READING', stem: '学习方法 · 材料阅读', options: [], correctAnswer: [], passage: '小林每天制定学习计划，并在周末复习本周内容。他发现，规律的学习安排有助于长期记忆。', explanation: '结合材料理解计划与复习的作用。', subQuestions: [
    { ...single, type: 'SINGLE_CHOICE', id: 'reading-sub-1', stem: '小林什么时候复习本周内容？', options: [{ key: 'A', content: '周末' }, { key: 'B', content: '从不复习' }], explanation: '材料明确提到他在周末复习本周内容。' },
    { ...short, type: 'SHORT_ANSWER', id: 'reading-sub-2' },
  ] },
}
