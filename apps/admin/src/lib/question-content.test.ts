import { describe, expect, it } from 'vitest'
import { getScenarioData } from '../../playground/scenarios'
import type { CreateQuestionInput, Question, QuestionContent } from '../types/admin'
import { publicationChecks } from './bank-workbench'
import { parseQuestionFile, validateQuestion } from './content-rules'
import { answerSummary, contentFingerprint, countQuestions, missingExplanations, questionSearchText } from './question-content'
import { questionImportExamples as examples } from './question-import-examples'

const input = (content: QuestionContent): CreateQuestionInput => ({ ...structuredClone(content), questionBankId: 'bank-calculus', status: 'ACTIVE' })

describe('新增题型的录入与导入边界', () => {
  it('六种题型的公开 JSON 示例都可导入，非选择题无需选项和答案字母', () => {
    const questions = parseQuestionFile(JSON.stringify({ questions: Object.values(examples) }), 'target')
    expect(questions.map((q) => q.type)).toEqual(Object.keys(examples))
    expect(questions.every((q) => q.questionBankId === 'target')).toBe(true)
    expect(countQuestions(questions)).toBe(7)
    expect(questions.find((q) => q.type === 'FILL_BLANK')?.blanks?.[0].answers).toEqual(['H₂O', 'H2O'])
    expect(questions.find((q) => q.type === 'SHORT_ANSWER')?.scoringPoints).toHaveLength(2)
  })

  it('填空位必须与题干中的规范标记一一对应，拒绝缺失、重复和越界', () => {
    for (const stem of ['没有标记', '{{1}} {{1}}', '{{1}} {{3}}', '{{1}} {{02}}', '{{1}} {{2}} {{extra}}']) {
      expect(() => validateQuestion({ ...input(examples.FILL_BLANK), stem })).toThrow('空位标记与答案不一致')
    }
    expect(() => validateQuestion({ ...input(examples.FILL_BLANK), blanks: [{ answers: [] }, { answers: ['100'] }] })).toThrow('第 1 空')
    expect(() => validateQuestion({ ...input(examples.FILL_BLANK), blanks: [{ answers: ['  '] }, { answers: ['100'] }] })).toThrow('答案必填')
  })

  it('填空匹配设置不会意外丢失区分首尾空格的答案，默认仅修剪首尾', () => {
    const question = { ...input(examples.FILL_BLANK), stem: '{{1}}', blanks: [{ answers: [' H2O ', 'H2O'] }] }
    expect(validateQuestion(question).blanks?.[0].answers).toEqual(['H2O'])
    expect(validateQuestion({ ...question, blankMatch: { ignoreCase: false, trimWhitespace: false } }).blanks?.[0].answers).toEqual([' H2O ', 'H2O'])
    expect(validateQuestion({ ...question, blanks: [{ answers: ['two words'] }] }).blanks?.[0].answers).toEqual(['two words'])
  })

  it('简答题必须有参考答案和评分要点，拒绝空内容及超长要点', () => {
    expect(() => validateQuestion({ ...input(examples.SHORT_ANSWER), referenceAnswer: '' })).toThrow('参考答案必填')
    expect(() => validateQuestion({ ...input(examples.SHORT_ANSWER), scoringPoints: [] })).toThrow('评分要点')
    expect(() => validateQuestion({ ...input(examples.SHORT_ANSWER), scoringPoints: [' '] })).toThrow('评分要点必填')
    expect(() => validateQuestion({ ...input(examples.SHORT_ANSWER), scoringPoints: ['a'.repeat(501)] })).toThrow('500')
  })

  it('阅读题组需要材料和小题，不能嵌套题组或复用小题标识', () => {
    const reading = input(examples.READING)
    expect(() => validateQuestion({ ...reading, passage: '' })).toThrow('阅读材料必填')
    expect(() => validateQuestion({ ...reading, subQuestions: [] })).toThrow('需要 1 至 50')
    expect(() => parseQuestionFile(JSON.stringify([{ ...reading, subQuestions: [examples.READING] }]), 'target')).toThrow('不能嵌套')
    expect(() => validateQuestion({ ...reading, subQuestions: [reading.subQuestions![0], reading.subQuestions![0]] })).toThrow('小题标识不能为空或重复')
  })

  it('阅读小题错误包含文件题号和小题序号，无标识的小题在导入时生成标识', () => {
    const reading = input(examples.READING)
    const subQuestions = reading.subQuestions!.map((sub) => ({ ...sub, id: undefined }))
    const [parsed] = parseQuestionFile(JSON.stringify([{ ...reading, subQuestions }]), 'target')
    expect(parsed.subQuestions?.every((sub) => sub.id)).toBe(true)
    expect(new Set(parsed.subQuestions?.map((sub) => sub.id)).size).toBe(2)
    expect(() => parseQuestionFile(JSON.stringify([{ ...reading, subQuestions: [subQuestions[0], { ...subQuestions[1], referenceAnswer: '' }] }]), 'target')).toThrow('第 1 题：第 2 小题：参考答案必填')
  })

  it('导入题量限制按阅读小题计算，不能用题组绕过每文件上限', () => {
    expect(() => parseQuestionFile(JSON.stringify(Array.from({ length: 1001 }, () => examples.READING)), 'target')).toThrow('每个文件最多 2000 道题')
  })
})

describe('题组统计、搜索与发布检查', () => {
  it('题组自身不计题数，筛选和摘要能覆盖材料、子题与不同答案', () => {
    const questions = [examples.READING, examples.FILL_BLANK, examples.SHORT_ANSWER]
    expect(countQuestions(questions)).toBe(4)
    expect(missingExplanations(questions)).toBe(0)
    expect(questionSearchText(examples.READING)).toContain('小林每天制定学习计划')
    expect(questionSearchText(examples.READING)).toContain('良好学习习惯')
    expect(answerSummary(examples.READING)).toContain('2 道小题')
    expect(answerSummary(examples.FILL_BLANK)).toContain('H₂O / H2O')
    expect(answerSummary(examples.SHORT_ANSWER)).toContain('学生自评')
  })

  it('材料说明可选，每道启用小题需要独立解析', () => {
    const data = getScenarioData('normal')
    const bank = data.questionBanks[0]
    const reading = { ...input(examples.READING), id: 'reading', createdAt: '', updatedAt: '', explanation: '' } as Question
    const checks = (question: Question) => publicationChecks(bank, data.subjects[0], [question], data)
    expect(checks(reading).every((check) => check.passed)).toBe(true)
    const invalid = { ...reading, subQuestions: reading.subQuestions!.map((sub, index) => index ? { ...sub, explanation: '' } : sub) }
    expect(checks(invalid).find((check) => check.label === '启用题目内容与解析完整')?.passed).toBe(false)
    expect(missingExplanations([invalid])).toBe(1)
  })

  it('答案、匹配规则、评分要点、材料及小题顺序变化都能识别为内容修改', () => {
    const fill = examples.FILL_BLANK
    expect(contentFingerprint(fill)).not.toBe(contentFingerprint({ ...fill, blankMatch: { ignoreCase: false, trimWhitespace: true } }))
    expect(contentFingerprint(fill)).not.toBe(contentFingerprint({ ...fill, blanks: [{ answers: ['water'] }, fill.blanks![1]] }))
    const short = examples.SHORT_ANSWER
    expect(contentFingerprint(short)).not.toBe(contentFingerprint({ ...short, scoringPoints: ['新的要点'] }))
    const reading = examples.READING
    expect(contentFingerprint(reading)).not.toBe(contentFingerprint({ ...reading, passage: '新的材料' }))
    expect(contentFingerprint(reading)).not.toBe(contentFingerprint({ ...reading, subQuestions: [...reading.subQuestions!].reverse() }))
  })
})
