import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Question, QuestionBank, Subject } from '../../src/types/admin'
import { getScenarioData, type PlaygroundScenario } from '../scenarios'

interface MockAdminState {
  scenario: PlaygroundScenario
  subjects: Subject[]
  questionBanks: QuestionBank[]
  questions: Question[]
  setScenario: (scenario: PlaygroundScenario) => void
  setSubjects: (subjects: Subject[]) => void
  setQuestionBanks: (questionBanks: QuestionBank[]) => void
  setQuestions: (questions: Question[]) => void
}

const initialData = getScenarioData('normal')

export const useMockAdminStore = create<MockAdminState>()(
  persist(
    (set) => ({
      scenario: 'normal',
      ...initialData,
      setScenario: (scenario) => set({ scenario, ...getScenarioData(scenario) }),
      setSubjects: (subjects) => set({ subjects }),
      setQuestionBanks: (questionBanks) => set({ questionBanks }),
      setQuestions: (questions) => set({ questions }),
    }),
    { name: 'qanda-admin-playground' },
  ),
)

export function getMockAdminState() {
  return useMockAdminStore.getState()
}
