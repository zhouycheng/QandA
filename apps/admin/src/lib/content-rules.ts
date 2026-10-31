import type { AtomicQuestionContent, CreateQuestionInput, QuestionContent, QuestionType, ReadingSubQuestion } from '../types/admin'
import { countQuestions } from './question-content'

function textValue(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function boundedText(value: unknown, label: string, max: number, required = true) {
  const text = textValue(value)
  if ((required && !text) || text.length > max) throw new Error(`${label}${required ? '必填，且' : ''}不能超过 ${max} 字。`)
  return text
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('题目格式应为对象。')
  return value as Record<string, unknown>
}

function validateContent(input: QuestionContent, allowReading = true): QuestionContent {
  const stem = boundedText(input.stem, input.type === 'READING' ? '题组标题' : '题干', 1000)
  const explanation = boundedText(input.explanation, '解析', 2000, false)
  const base = { type: input.type, stem, explanation, options: [], correctAnswer: [] }
  if (input.type === 'READING') {
    if (!allowReading) throw new Error('阅读小题不能嵌套阅读题组。')
    const passage = boundedText(input.passage, '阅读材料', 20000)
    if (!Array.isArray(input.subQuestions) || !input.subQuestions.length || input.subQuestions.length > 50)
      throw new Error('每个阅读题组需要 1 至 50 道小题。')
    const ids = new Set<string>()
    const subQuestions = input.subQuestions.map((question, index): ReadingSubQuestion => {
      try {
        if (typeof question.id !== 'string' || !question.id.trim() || ids.has(question.id)) throw new Error('小题标识不能为空或重复。')
        ids.add(question.id)
        return { ...validateContent(question, false) as AtomicQuestionContent, id: question.id }
      } catch (error) { throw new Error(`第 ${index + 1} 小题：${error instanceof Error ? error.message : '格式无效'}`) }
    })
    return { ...base, passage, subQuestions }
  }
  if (input.type === 'FILL_BLANK') {
    if (!Array.isArray(input.blanks) || !input.blanks.length || input.blanks.length > 20) throw new Error('填空题需要 1 至 20 个空位。')
    if (input.blankMatch && (typeof input.blankMatch.ignoreCase !== 'boolean' || typeof input.blankMatch.trimWhitespace !== 'boolean')) throw new Error('填空答案匹配设置无效。')
    const blankMatch = input.blankMatch ?? { ignoreCase: true, trimWhitespace: true }
    const blanks = input.blanks.map((blank, index) => {
      if (!Array.isArray(blank?.answers) || !blank.answers.length || blank.answers.length > 20) throw new Error(`第 ${index + 1} 空需要 1 至 20 个可接受答案。`)
      const answers = [...new Set(blank.answers.map((answer) => {
        const trimmed = boundedText(answer, `第 ${index + 1} 空的答案`, 500)
        if (answer.length > 500) throw new Error('每个填空答案不能超过 500 字。')
        return blankMatch.trimWhitespace ? trimmed : answer
      }))]
      return { answers }
    })
    const tokens = [...stem.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1])
    const markers = tokens.map(Number)
    if (markers.length !== blanks.length || new Set(markers).size !== blanks.length || markers.some((n, i) => !Number.isInteger(n) || n < 1 || n > blanks.length || String(n) !== tokens[i]))
      throw new Error('空位标记与答案不一致，请在题干中按 {{1}}、{{2}} 的格式各标记一次。')
    return { ...base, blanks, blankMatch }
  }
  if (input.type === 'SHORT_ANSWER') {
    const referenceAnswer = boundedText(input.referenceAnswer, '参考答案', 4000)
    if (!Array.isArray(input.scoringPoints) || !input.scoringPoints.length || input.scoringPoints.length > 30) throw new Error('简答题需要 1 至 30 条评分要点。')
    const scoringPoints = input.scoringPoints.map((point) => boundedText(point, '评分要点', 500))
    return { ...base, referenceAnswer, scoringPoints }
  }
  if (!['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(input.type)) throw new Error('题型无效。')
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 26) throw new Error('题目需要 2 至 26 个选项。')
  const options = input.options.map((o) => ({ key: textValue(o?.key), content: textValue(o?.content) }))
  const keys = new Set(options.map((o) => o.key))
  if (options.some((o) => !o.key || !o.content) || keys.size !== options.length) throw new Error('选项内容不能为空，且选项标识不能重复。')
  const answers = input.correctAnswer
  if (!Array.isArray(answers) || !answers.length || new Set(answers).size !== answers.length || answers.some((a) => !keys.has(a)))
    throw new Error('正确答案必须对应有效选项，且不能重复。')
  if (input.type === 'MULTIPLE_CHOICE' ? answers.length < 2 : answers.length !== 1)
    throw new Error(input.type === 'MULTIPLE_CHOICE' ? '多选题至少需要两个正确答案。' : '单选和判断题只能有一个正确答案。')
  if (input.type === 'TRUE_FALSE' && (options.length !== 2 || !keys.has('TRUE') || !keys.has('FALSE'))) throw new Error('判断题必须使用 TRUE / FALSE 选项。')
  return { ...base, options, correctAnswer: [...answers] }
}

export function validateQuestion(input: CreateQuestionInput): CreateQuestionInput {
  if (!['ACTIVE', 'INACTIVE'].includes(input.status)) throw new Error('题目状态无效。')
  return { ...validateContent(input), questionBankId: input.questionBankId, chapterId: input.chapterId, status: input.status }
}

function parseContent(row: unknown, allowReading = true): QuestionContent {
  const q = record(row)
  const aliases: Record<string, QuestionType> = { single: 'SINGLE_CHOICE', multiple: 'MULTIPLE_CHOICE', judge: 'TRUE_FALSE', fill: 'FILL_BLANK', short: 'SHORT_ANSWER', reading: 'READING' }
  const type = aliases[String(q.type)] ?? String(q.type) as QuestionType
  if (type === 'READING' && !allowReading) throw new Error('阅读小题不能嵌套阅读题组。')
  let options = Array.isArray(q.options) ? q.options.map((value) => {
    const o = record(value)
    return { key: String(o.key ?? ''), content: String(o.content ?? o.text ?? '') }
  }) : []
  let answers = q.correctAnswer ?? q.answerKeys
  if (type === 'TRUE_FALSE') {
    const truthKey = options.find((o) => ['正确', '对', 'true'].includes(o.content.toLowerCase()))?.key
    const falseKey = options.find((o) => ['错误', '错', 'false'].includes(o.content.toLowerCase()))?.key
    if (Array.isArray(answers)) answers = answers.map((a) => a === 'TRUE' || a === truthKey ? 'TRUE' : a === 'FALSE' || a === falseKey ? 'FALSE' : a)
    options = [{ key: 'TRUE', content: '正确' }, { key: 'FALSE', content: '错误' }]
  }
  let subQuestions: ReadingSubQuestion[] | undefined
  if (type === 'READING' && Array.isArray(q.subQuestions)) {
    if (q.subQuestions.length > 50) throw new Error('每个阅读题组最多 50 道小题。')
    subQuestions = q.subQuestions.map((sub, index) => {
      try { return { ...parseContent(sub, false) as AtomicQuestionContent, id: textValue(record(sub).id) || crypto.randomUUID() } }
      catch (error) { throw new Error(`第 ${index + 1} 小题：${error instanceof Error ? error.message : '格式无效'}`) }
    })
  }
  return validateContent({
    type, stem: typeof q.stem === 'string' ? q.stem : '', options,
    correctAnswer: Array.isArray(answers) && answers.every((a) => typeof a === 'string') ? answers : [],
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
    blanks: q.blanks as QuestionContent['blanks'], blankMatch: q.blankMatch as QuestionContent['blankMatch'],
    referenceAnswer: q.referenceAnswer as string | undefined, scoringPoints: q.scoringPoints as string[] | undefined,
    passage: q.passage as string | undefined, subQuestions,
  }, allowReading)
}

export function parseQuestionFile(text: string, questionBankId: string): CreateQuestionInput[] {
  const root: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  const rows = Array.isArray(root) ? root : record(root).questions
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error('每个文件应包含 1 至 2000 道题（数组或 questions 数组）。')
  const questions = rows.map((row, index) => {
    try {
      const q = record(row)
      return validateQuestion({ ...parseContent(q), questionBankId, chapterId: typeof q.chapterId === 'string' ? q.chapterId : undefined, status: (q.status ?? 'ACTIVE') as CreateQuestionInput['status'] })
    } catch (error) { throw new Error(`第 ${index + 1} 题：${error instanceof Error ? error.message : '格式无效'}`) }
  })
  if (countQuestions(questions) > 2000) throw new Error('每个文件最多 2000 道题，阅读理解按小题计数。')
  return questions
}

export async function hashPassword(password: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}
