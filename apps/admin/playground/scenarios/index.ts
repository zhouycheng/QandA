import type { Question } from '../../src/types/admin'
import { collegeFixtures } from '../fixtures/colleges'
import { majorFixtures } from '../fixtures/majors'
import { questionBankFixtures } from '../fixtures/question-banks'
import { questionFixtures } from '../fixtures/questions'
import { subjectFixtures } from '../fixtures/subjects'
import { chapterFixtures, feedbackFixtures, userCourseFixtures } from '../fixtures/platform'
import {
  adminAccountFixtures,
  announcementFixtures,
  createActivityFixtures,
  defaultSecurity,
  userFixtures,
} from '../fixtures/operations'

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
  const baseQuestions = structuredClone(questionFixtures).map((q) => ({
    ...q,
    revision: 1,
    chapterId:
      q.id === 'question-single'
        ? 'chapter-derivatives'
        : q.id === 'question-multiple'
          ? 'chapter-limits'
          : 'chapter-tense',
  }))
  const operations = {
    adminAccounts: structuredClone(adminAccountFixtures),
    security: structuredClone(defaultSecurity),
    users: scenario === 'empty' ? [] : structuredClone(userFixtures),
    announcements: scenario === 'empty' ? [] : structuredClone(announcementFixtures),
    activityRecords: scenario === 'empty' ? [] : createActivityFixtures(),
    operationLogs: [] as import('../../src/types/operations').OperationLog[],
    chapters: scenario === 'empty' ? [] : structuredClone(chapterFixtures),
    feedback: scenario === 'empty' ? [] : structuredClone(feedbackFixtures),
    userCourses: scenario === 'empty' ? [] : structuredClone(userCourseFixtures),
  }
  if (scenario === 'empty') {
    return { colleges: [], majors: [], subjects: [], questionBanks: [], questions: [], ...operations }
  }

  return {
    ...operations,
    colleges: structuredClone(collegeFixtures),
    majors: structuredClone(majorFixtures),
    subjects: structuredClone(subjectFixtures),
    questionBanks: structuredClone(questionBankFixtures),
    questions:
      scenario === 'large-data'
        ? [
            ...baseQuestions,
            ...Array.from({ length: 1000 - baseQuestions.length }, (_, index) => createLargeQuestion(index)),
          ]
        : baseQuestions,
  }
}
