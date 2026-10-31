import type { BankAudience, College, Grade, Major, Question, QuestionBank, Subject } from '../types/admin'
import { validateQuestion } from './content-rules'
import { countQuestions, missingExplanations } from './question-content'
import { matchesAudience } from './recommendations'

export interface AudienceDirectory {
  colleges: College[]
  majors: Major[]
  grades: Grade[]
}

export interface ScopeGroup { id: string; collegeId?: string; majorId?: string; years: number[] }
export const emptyScopeGroup = (): ScopeGroup => ({ id: crypto.randomUUID(), years: [] })

export function audienceGroups(audiences: BankAudience[], directory: AudienceDirectory): ScopeGroup[] {
  const grouped = new Map<string, ScopeGroup>()
  const unlimited = new Set<string>()
  for (const audience of audiences) {
    const collegeId = audience.collegeId ?? directory.majors.find((m) => m.id === audience.majorId)?.collegeId
    const key = `${collegeId ?? ''}/${audience.majorId ?? ''}`
    const group = grouped.get(key) ?? { id: key, collegeId, majorId: audience.majorId, years: [] }
    if (audience.enrollmentYear === undefined) { unlimited.add(key); group.years = [] }
    else if (!unlimited.has(key)) group.years = [...new Set([...group.years, audience.enrollmentYear])]
    grouped.set(key, group)
  }
  return [...grouped.values()]
}

export function groupsToAudiences(groups: ScopeGroup[]): BankAudience[] {
  const audiences = groups.flatMap((group) => {
    const base = { ...(group.collegeId ? { collegeId: group.collegeId } : {}), ...(group.majorId ? { majorId: group.majorId } : {}) }
    return group.years.length ? group.years.map((enrollmentYear) => ({ ...base, enrollmentYear })) : Object.keys(base).length ? [base] : []
  })
  return [...new Map(audiences.map((a) => [JSON.stringify(a), a])).values()]
}

export function getScopeError(scopeType: string, audiences: BankAudience[], directory: AudienceDirectory, required = true) {
  if (!['ALL', 'TARGETED'].includes(scopeType)) return '请选择展示范围类型。'
  if (scopeType === 'ALL') return
  if (!audiences.length && required) return '请至少添加一条有效展示条件。'
  for (const audience of audiences) {
    if (!audience.collegeId && !audience.majorId && audience.enrollmentYear === undefined)
      return '每条展示条件至少填写一个条件。'
    if (audience.collegeId && !directory.colleges.some((c) => c.id === audience.collegeId))
      return '展示学院不存在，请重新选择。'
    if (audience.majorId && !directory.majors.some((m) => m.id === audience.majorId && (!audience.collegeId || m.collegeId === audience.collegeId)))
      return '展示专业不存在或不属于所选学院。'
    if (audience.enrollmentYear !== undefined) {
      if (!Number.isInteger(audience.enrollmentYear) || audience.enrollmentYear < 2000 || audience.enrollmentYear > new Date().getFullYear() + 1)
        return '请输入有效的四位入学年份。'
      if (!directory.grades.some((g) => g.enrollmentYear === audience.enrollmentYear &&
        (!audience.majorId || g.majorId === audience.majorId) &&
        (!audience.collegeId || directory.majors.some((m) => m.id === g.majorId && m.collegeId === audience.collegeId))))
        return '所选范围尚未配置该入学年级，请先在院级管理中新增。'
    }
  }
}

export function scopeLabels(bank: Pick<QuestionBank, 'scopeType' | 'audiences'>, directory: AudienceDirectory) {
  if (bank.scopeType === 'ALL') return ['全校可见']
  if (!bank.audiences.length) return ['展示范围待配置']
  return bank.audiences.map((audience) => {
    const major = directory.majors.find((m) => m.id === audience.majorId)
    const college = directory.colleges.find((c) => c.id === (audience.collegeId ?? major?.collegeId))
    return [college?.name, major?.name, audience.enrollmentYear ? `${audience.enrollmentYear} 级` : undefined].filter(Boolean).join(' · ') || '范围待检查'
  })
}

export function publicationChecks(bank: QuestionBank, subject: Subject | undefined, questions: Question[], directory: AudienceDirectory) {
  const active = questions.filter((q) => q.status === 'ACTIVE')
  const invalid = active.filter((q) => {
    try { validateQuestion(q); return false } catch { return true }
  })
  const scopeError = getScopeError(bank.scopeType, bank.audiences, directory)
  return [
    { label: '所属课程已启用', passed: subject?.status === 'ACTIVE', detail: subject?.status === 'ACTIVE' ? subject.name : '请先在课程目录中启用所属课程' },
    { label: '题库说明已填写', passed: Boolean(bank.description.trim()), detail: bank.description.trim() ? '学生可以了解题库用途与内容' : '请在基本信息中补充题库说明' },
    { label: '至少有一道启用题目', passed: countQuestions(active) > 0, detail: `当前有 ${countQuestions(active)} 道启用题目（阅读理解按小题计数）` },
    { label: '启用题目内容与解析完整', passed: invalid.length === 0 && missingExplanations(active) === 0, detail: `${invalid.length} 条题目记录格式待检查，${missingExplanations(active)} 道题目或阅读小题缺少解析` },
    { label: '展示范围已配置', passed: !scopeError, detail: scopeError ?? scopeLabels(bank, directory).join('；') },
  ]
}

export function bankVisibility(bank: QuestionBank, profile: Pick<BankAudience, 'collegeId' | 'majorId' | 'enrollmentYear'>, subjects: Subject[]) {
  const matches = bank.scopeType === 'ALL' || bank.audiences.some((a) => matchesAudience({ collegeId: profile.collegeId ?? '', majorId: profile.majorId ?? '', enrollmentYear: profile.enrollmentYear }, a))
  if (!matches) return { matches, visible: false, message: '该学生资料不在题库的展示范围内。' }
  if (bank.publicationStatus !== 'PUBLISHED') return { matches, visible: false, message: '资料匹配；题库发布后才会在学生列表中展示。' }
  if (!subjects.some((s) => s.id === bank.subjectId && s.status === 'ACTIVE')) return { matches, visible: false, message: '资料匹配，但所属课程已停用，暂不展示。' }
  if (bank.status !== 'ACTIVE' || !bank.activeQuestionCount) return { matches, visible: false, message: '资料匹配，但当前没有可练习的启用题目。' }
  return { matches, visible: true, message: '该学生将在答题端看到这个题库。' }
}
