import { describe, expect, it } from 'vitest'
import { getScenarioData } from './index'

describe('Playground 场景数据', () => {
  it('空数据场景不包含任何内容', () => {
    const data = getScenarioData('empty')
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
})
