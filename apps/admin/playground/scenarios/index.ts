import type { Question } from '../../src/types/admin'
import { questionBankFixtures } from '../fixtures/question-banks'
import { questionFixtures } from '../fixtures/questions'
import { subjectFixtures } from '../fixtures/subjects'

export type PlaygroundScenario = 'normal' | 'empty' | 'error' | 'write-error' | 'slow' | 'large-data'

export const scenarioLabels: Record<PlaygroundScenario, string> = {
  normal: '正常数据',
  empty: '空数据',
  error: '请求失败',
  'write-error': '写入失败',
  slow: '3 秒延迟',
  'large-data': '1000 道题',
}

function createLargeQuestion(index: number): Question {
  const id = index + 1
  return {
    id: `question-large-${id}`,
    questionBankId: id % 3 === 0 ? 'bank-english-grammar' : 'bank-calculus',
    stem: `性能验证题目 ${id}：请选择正确答案。`,
    type: id % 3 === 0 ? 'TRUE_FALSE' : id % 2 === 0 ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
    options:
      id % 3 === 0
        ? [
            { key: 'TRUE', content: '正确' },
            { key: 'FALSE', content: '错误' },
          ]
        : [
            { key: 'A', content: '选项 A' },
            { key: 'B', content: '选项 B' },
            { key: 'C', content: '选项 C' },
            { key: 'D', content: '选项 D' },
          ],
    correctAnswer: id % 3 === 0 ? ['TRUE'] : id % 2 === 0 ? ['A', 'B'] : ['A'],
    explanation: `这是性能验证题目 ${id} 的解析。`,
    status: id % 10 === 0 ? 'INACTIVE' : 'ACTIVE',
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  }
}

export function getScenarioData(scenario: PlaygroundScenario) {
  if (scenario === 'empty') {
    return { subjects: [], questionBanks: [], questions: [] }
  }

  return {
    subjects: structuredClone(subjectFixtures),
    questionBanks: structuredClone(questionBankFixtures),
    questions:
      scenario === 'large-data'
        ? Array.from({ length: 1000 }, (_, index) => createLargeQuestion(index))
        : structuredClone(questionFixtures),
  }
}
