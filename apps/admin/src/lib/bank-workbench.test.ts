import { describe, expect, it } from 'vitest'
import { getScenarioData } from '../../playground/scenarios'
import { audienceGroups, bankVisibility, getScopeError, groupsToAudiences, publicationChecks } from './bank-workbench'

describe('题库展示范围与发布预检', () => {
  const data = getScenarioData('normal')
  const directory = { colleges: data.colleges, majors: data.majors, grades: data.grades }
  const bank = { ...data.questionBanks[0], activeQuestionCount: 2 }

  it('多年份范围合并再展开不丢条件，并消除重复条件', () => {
    const audiences = [{ majorId: 'major-computer-science', enrollmentYear: 2025 }, { majorId: 'major-computer-science', enrollmentYear: 2026 }]
    const groups = audienceGroups(audiences, directory)
    expect(groups).toHaveLength(1)
    expect(groups[0].years).toEqual([2025, 2026])
    const restored = groupsToAudiences([...groups, ...groups])
    expect(restored).toHaveLength(2)
    expect(restored.every((a) => a.collegeId === 'college-computer-science')).toBe(true)
    expect(restored.map((a) => a.enrollmentYear)).toEqual([2025, 2026])
    expect(groupsToAudiences([{ id: 'empty', years: [] }])).toEqual([])
  })

  it('同一范围的不限年级条件不会被合并成限定年级', () => {
    for (const audiences of [[{ majorId: 'major-english' }, { majorId: 'major-english', enrollmentYear: 2025 }], [{ majorId: 'major-english', enrollmentYear: 2025 }, { majorId: 'major-english' }]]) {
      expect(groupsToAudiences(audienceGroups(audiences, directory))).toEqual([{ collegeId: 'college-foreign-languages', majorId: 'major-english' }])
    }
  })

  it('范围必须来自院级目录，草稿可暂缺范围，发布需要明确配置', () => {
    expect(getScopeError('TARGETED', [], directory, false)).toBeUndefined()
    expect(getScopeError('TARGETED', [], directory)).toContain('至少添加')
    expect(getScopeError('TARGETED', [{ majorId: 'major-english', enrollmentYear: 2023 }], directory)).toContain('尚未配置')
    expect(getScopeError('TARGETED', [{ majorId: 'major-english', enrollmentYear: 2025 }], directory)).toBeUndefined()
  })

  it('学院、专业和年份同时匹配，多条展示范围满足任意一条', () => {
    const targeted = { ...bank, audiences: [{ collegeId: 'college-computer-science', majorId: 'major-computer-science', enrollmentYear: 2025 }, { majorId: 'major-english', enrollmentYear: 2026 }] }
    expect(bankVisibility(targeted, { collegeId: 'college-computer-science', majorId: 'major-computer-science', enrollmentYear: 2025 }, data.subjects).visible).toBe(true)
    expect(bankVisibility(targeted, { collegeId: 'college-computer-science', majorId: 'major-computer-science', enrollmentYear: 2024 }, data.subjects).visible).toBe(false)
    expect(bankVisibility(targeted, { majorId: 'major-english', enrollmentYear: 2026 }, data.subjects).visible).toBe(true)
    expect(bankVisibility(targeted, {}, data.subjects).visible).toBe(false)
  })

  it('资料变化只改变匹配结果，全校题库、草稿、下架和课程停用分别处理', () => {
    const user = structuredClone(data.users[0])
    expect(bankVisibility(bank, user, data.subjects).visible).toBe(true)
    expect(bankVisibility(bank, { ...user, majorId: 'major-english' }, data.subjects).visible).toBe(false)
    expect(user).toEqual(data.users[0])
    expect(bankVisibility({ ...bank, scopeType: 'ALL', audiences: [] }, {}, data.subjects).visible).toBe(true)
    expect(bankVisibility({ ...bank, publicationStatus: 'DRAFT' }, user, data.subjects)).toMatchObject({ matches: true, visible: false })
    expect(bankVisibility({ ...bank, publicationStatus: 'UNPUBLISHED' }, user, data.subjects).visible).toBe(false)
    expect(bankVisibility(bank, user, data.subjects.map((s) => ({ ...s, status: 'INACTIVE' }))).visible).toBe(false)
  })

  it('发布预检能指出缺说明、题目、解析和范围，不被草稿状态误阻止', () => {
    const questions = data.questions.filter((q) => q.questionBankId === bank.id)
    expect(publicationChecks(bank, data.subjects[0], questions, directory).every((c) => c.passed)).toBe(true)
    const invalid = { ...bank, description: '', scopeType: 'TARGETED' as const, audiences: [] }
    expect(publicationChecks(invalid, data.subjects[0], [], directory).filter((c) => !c.passed).map((c) => c.label)).toEqual(['题库说明已填写', '至少有一道启用题目', '展示范围已配置'])
    expect(publicationChecks(bank, data.subjects[0], questions.map((q) => ({ ...q, explanation: '' })), directory).find((c) => c.label === '启用题目内容与解析完整')?.passed).toBe(false)
  })
})
