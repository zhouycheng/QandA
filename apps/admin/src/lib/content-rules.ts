import type { CreateQuestionInput, QuestionType } from '../types/admin'

export function validateQuestion(input: CreateQuestionInput): CreateQuestionInput {
  const stem = input.stem?.trim()
  const explanation = input.explanation?.trim() ?? ''
  if (!stem || stem.length > 1000) throw new Error('题干必填，且不能超过 1000 字。')
  if (explanation.length > 2000) throw new Error('解析不能超过 2000 字。')
  if (!['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(input.type)) throw new Error('题型无效。')
  if (!['ACTIVE', 'INACTIVE'].includes(input.status)) throw new Error('题目状态无效。')
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 26)
    throw new Error('题目需要 2 至 26 个选项。')
  const options = input.options.map((o) => ({ key: o.key?.trim(), content: o.content?.trim() }))
  const keys = new Set(options.map((o) => o.key))
  if (options.some((o) => !o.key || !o.content) || keys.size !== options.length)
    throw new Error('选项内容不能为空，且选项标识不能重复。')
  const answers = input.correctAnswer
  if (
    !Array.isArray(answers) ||
    !answers.length ||
    new Set(answers).size !== answers.length ||
    answers.some((a) => !keys.has(a))
  )
    throw new Error('正确答案必须对应有效选项，且不能重复。')
  if (input.type === 'MULTIPLE_CHOICE' ? answers.length < 2 : answers.length !== 1)
    throw new Error(
      input.type === 'MULTIPLE_CHOICE' ? '多选题至少需要两个正确答案。' : '单选和判断题只能有一个正确答案。',
    )
  if (input.type === 'TRUE_FALSE' && (options.length !== 2 || !keys.has('TRUE') || !keys.has('FALSE')))
    throw new Error('判断题必须使用 TRUE / FALSE 选项。')
  return { ...input, stem, explanation, options, correctAnswer: [...answers] }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('题目格式应为对象。')
  return value as Record<string, unknown>
}

export function parseQuestionFile(text: string, questionBankId: string): CreateQuestionInput[] {
  const root: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  const rows = Array.isArray(root) ? root : record(root).questions
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000)
    throw new Error('每个文件应包含 1 至 2000 道题（数组或 questions 数组）。')
  const aliases: Record<string, QuestionType> = {
    single: 'SINGLE_CHOICE',
    multiple: 'MULTIPLE_CHOICE',
    judge: 'TRUE_FALSE',
  }
  return rows.map((row, i) => {
    try {
      const q = record(row)
      const type = aliases[String(q.type)] ?? (String(q.type) as QuestionType)
      let options = Array.isArray(q.options)
        ? q.options.map((value) => {
            const o = record(value)
            return { key: String(o.key ?? ''), content: String(o.content ?? o.text ?? '') }
          })
        : []
      let answers = q.correctAnswer ?? q.answerKeys
      if (type === 'TRUE_FALSE') {
        const source = options
        const truthKey = source.find((o) => ['正确', '对', 'true'].includes(o.content.toLowerCase()))?.key
        const falseKey = source.find((o) => ['错误', '错', 'false'].includes(o.content.toLowerCase()))?.key
        if (Array.isArray(answers))
          answers = answers.map((a) =>
            a === 'TRUE' || a === truthKey ? 'TRUE' : a === 'FALSE' || a === falseKey ? 'FALSE' : a,
          )
        options = [
          { key: 'TRUE', content: '正确' },
          { key: 'FALSE', content: '错误' },
        ]
      }
      return validateQuestion({
        questionBankId,
        chapterId: typeof q.chapterId === 'string' ? q.chapterId : undefined,
        type,
        stem: typeof q.stem === 'string' ? q.stem : '',
        options,
        correctAnswer: Array.isArray(answers) && answers.every((a) => typeof a === 'string') ? answers : [],
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
        status: (q.status ?? 'ACTIVE') as CreateQuestionInput['status'],
      })
    } catch (error) {
      throw new Error(`第 ${i + 1} 题：${error instanceof Error ? error.message : '格式无效'}`)
    }
  })
}

export async function hashPassword(password: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}
