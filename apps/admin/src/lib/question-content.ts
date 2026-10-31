import type { AtomicQuestionContent, QuestionContent, QuestionType } from '../types/admin'

export function createQuestionContent(type: QuestionType = 'SINGLE_CHOICE'): QuestionContent {
  const base = { type, stem: '', explanation: '', options: [], correctAnswer: [] }
  if (type === 'READING') return { ...base, passage: '', subQuestions: [] }
  if (type === 'FILL_BLANK') return { ...base, stem: '{{1}}', blanks: [{ answers: [] }], blankMatch: { ignoreCase: true, trimWhitespace: true } }
  if (type === 'SHORT_ANSWER') return { ...base, referenceAnswer: '', scoringPoints: [] }
  return { ...base, options: type === 'TRUE_FALSE'
    ? [{ key: 'TRUE', content: '正确' }, { key: 'FALSE', content: '错误' }]
    : ['A', 'B', 'C', 'D'].map((key) => ({ key, content: '' })) }
}

export function questionItems(question: QuestionContent): AtomicQuestionContent[] {
  return question.type === 'READING' ? question.subQuestions ?? [] : [{ ...question, type: question.type }]
}

export function countQuestions(questions: QuestionContent[]) {
  return questions.reduce((total, question) => total + questionItems(question).length, 0)
}

export function missingExplanations(questions: QuestionContent[]) {
  return questions.flatMap(questionItems).filter((question) => !question.explanation.trim()).length
}

export function questionSearchText(question: QuestionContent) {
  return [question.stem, question.passage ?? '', ...questionItems(question).map((q) => `${q.stem} ${q.options.map((o) => o.content).join(' ')}`)].join(' ')
}

export function answerSummary(question: QuestionContent) {
  if (question.type === 'READING') return `${question.subQuestions?.length ?? 0} 道小题 · 共用阅读材料`
  if (question.type === 'SHORT_ANSWER') return `参考答案 · ${question.scoringPoints?.length ?? 0} 条评分要点 · 学生自评`
  if (question.type === 'FILL_BLANK') return `${question.blanks?.length ?? 0} 个空 · ${question.blanks?.map((blank, i) => `${i + 1}：${blank.answers.join(' / ')}`).join('；') ?? ''}`
  return `答案 ${question.correctAnswer.map((a) => a === 'TRUE' ? '正确' : a === 'FALSE' ? '错误' : a).join('、')}`
}

export function contentFingerprint(question: QuestionContent) {
  return JSON.stringify([question.type, question.stem, question.options, question.correctAnswer, question.explanation,
    question.blanks, question.blankMatch, question.referenceAnswer, question.scoringPoints, question.passage, question.subQuestions])
}
