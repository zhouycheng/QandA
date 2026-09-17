import { describe, expect, it } from 'vitest'
import type { PracticeSession, Question } from '../../src/types/practice'
import { buildPracticeResult } from './mock-practice-gateway'

const question: Question = {
  id: 'q1', questionBankId: 'bank', type: 'MULTIPLE_CHOICE', stem: '示例',
  options: [{ key: 'A', content: 'A' }, { key: 'B', content: 'B' }],
  correctAnswer: ['A', 'B'], explanation: '解析',
}

const baseSession: PracticeSession = {
  id: 'session', subjectId: 'subject', questionBankId: 'bank',
  config: { questionCount: 1, order: 'SEQUENTIAL', feedbackMode: 'DEFERRED', autoNext: false, timerMode: 'OFF' },
  questionIds: ['q1'], currentIndex: 0, answers: {}, confirmedQuestionIds: [],
  elapsedSeconds: 42, status: 'IN_PROGRESS', syncStatus: 'LOCAL_ONLY',
  startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('buildPracticeResult', () => {
  it('按集合比较多选答案并计算成绩', () => {
    const result = buildPracticeResult({ ...baseSession, answers: { q1: ['B', 'A'] } }, [question])
    expect(result.correctCount).toBe(1)
    expect(result.accuracy).toBe(100)
    expect(result.questionResults[0].status).toBe('CORRECT')
  })

  it('保留未答状态', () => {
    const result = buildPracticeResult(baseSession, [question])
    expect(result.unansweredCount).toBe(1)
    expect(result.questionResults[0].status).toBe('UNANSWERED')
  })
})
