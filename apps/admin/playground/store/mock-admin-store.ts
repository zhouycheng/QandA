import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { College, Major, Question, QuestionBank, Subject } from '../../src/types/admin'
import { getScenarioData, type PlaygroundScenario } from '../scenarios'

interface MockAdminState {
  scenario: PlaygroundScenario
  colleges: College[]
  majors: Major[]
  subjects: Subject[]
  questionBanks: QuestionBank[]
  questions: Question[]
  setScenario: (scenario: PlaygroundScenario) => void
  setColleges: (colleges: College[]) => void
  setMajors: (majors: Major[]) => void
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
      setColleges: (colleges) => set({ colleges }),
      setMajors: (majors) => set({ majors }),
      setSubjects: (subjects) => set({ subjects }),
      setQuestionBanks: (questionBanks) => set({ questionBanks }),
      setQuestions: (questions) => set({ questions }),
    }),
    { name: 'qanda-admin-playground-v2' },
  ),
)

export function getMockAdminState() {
  return useMockAdminStore.getState()
}
