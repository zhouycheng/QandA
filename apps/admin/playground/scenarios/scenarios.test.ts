import { describe, expect, it } from 'vitest'
import { getScenarioData } from './index'

describe('Playground 场景数据', () => {
  it('空数据场景不包含任何内容', () => {
    const data = getScenarioData('empty')
    expect(data.colleges).toHaveLength(0)
    expect(data.majors).toHaveLength(0)
    expect(data.subjects).toHaveLength(0)
    expect(data.questionBanks).toHaveLength(0)
    expect(data.questions).toHaveLength(0)
  })

  it('大数据场景生成 1000 道可区分的题目', () => {
    const data = getScenarioData('large-data')
    expect(data.questions).toHaveLength(1000)
    expect(new Set(data.questions.map((question) => question.id)).size).toBe(1000)
  })

  it('每次读取场景都会获得独立数据', () => {
    const first = getScenarioData('normal')
    first.subjects[0].name = '已修改'
    const second = getScenarioData('normal')
    expect(second.subjects[0].name).toBe('高等数学')
  })

  it('正常场景提供学院数据', () => {
    expect(getScenarioData('normal').colleges).toHaveLength(2)
  })

  it('专业和科目的关联都指向存在的数据', () => {
    const data = getScenarioData('normal')
    const collegeIds = new Set(data.colleges.map((college) => college.id))
    const majorIds = new Set(data.majors.map((major) => major.id))
    expect(data.majors.every((major) => collegeIds.has(major.collegeId))).toBe(true)
    expect(data.subjects.every((subject) => subject.majorIds.length > 0)).toBe(true)
    expect(data.subjects.every((subject) => subject.majorIds.every((majorId) => majorIds.has(majorId)))).toBe(true)
    expect(data.subjects.some((subject) => subject.majorIds.length > 1)).toBe(true)
  })
})
