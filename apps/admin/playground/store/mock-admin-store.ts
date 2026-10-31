import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Chapter, College, Grade, Major, Question, QuestionBank, Subject } from '../../src/types/admin'
import { createGradeFixtures } from '../fixtures/grades'
import { getScenarioData, type PlaygroundScenario } from '../scenarios'
import type {
  ActivityRecord,
  Announcement,
  ManagedUser,
  OperationLog,
  SecuritySettings,
  StoredAdminAccount,
  StudentFeedback,
  UserCourse,
} from '../../src/types/operations'

interface OperationsData {
  chapters: Chapter[]
  feedback: StudentFeedback[]
  userCourses: UserCourse[]
  users: ManagedUser[]
  adminAccounts: StoredAdminAccount[]
  announcements: Announcement[]
  security: SecuritySettings
  activityRecords: ActivityRecord[]
  operationLogs: OperationLog[]
}

interface MockAdminState extends OperationsData {
  scenario: PlaygroundScenario
  scenarioRevision: number
  colleges: College[]
  majors: Major[]
  grades: Grade[]
  subjects: Subject[]
  questionBanks: QuestionBank[]
  questions: Question[]
  setScenario: (scenario: PlaygroundScenario) => void
  setColleges: (colleges: College[]) => void
  setMajors: (majors: Major[]) => void
  setGrades: (grades: Grade[]) => void
  setSubjects: (subjects: Subject[]) => void
  setQuestionBanks: (questionBanks: QuestionBank[]) => void
  setQuestions: (questions: Question[]) => void
  setOperations: (patch: Partial<OperationsData>) => void
}

const initialData = getScenarioData('normal')

export const useMockAdminStore = create<MockAdminState>()(
  persist(
    (set) => ({
      scenario: 'normal',
      scenarioRevision: 0,
      ...initialData,
      setScenario: (scenario) =>
        set((state) => ({
          scenario,
          ...getScenarioData(scenario),
          scenarioRevision: state.scenarioRevision + 1,
        })),
      setColleges: (colleges) => set({ colleges }),
      setMajors: (majors) => set({ majors }),
      setGrades: (grades) => set({ grades }),
      setSubjects: (subjects) => set({ subjects }),
      setQuestionBanks: (questionBanks) => set({ questionBanks }),
      setQuestions: (questions) => set({ questions }),
      setOperations: (patch) => set(patch),
    }),
    {
      name: 'qanda-admin-playground-v3',
      version: 2,
      migrate: (persisted, version) => {
        const old = persisted as MockAdminState
        return {
          ...old,
          chapters: old.chapters ?? [],
          feedback: old.feedback ?? [],
          userCourses: old.userCourses ?? [],
          grades: old.grades ?? createGradeFixtures(old.majors, old.users, old.questionBanks),
          questionBanks: version >= 1 ? old.questionBanks : old.questionBanks.map((bank) => ({
            ...bank,
            textbook: bank.textbook ?? '',
            owner: bank.owner ?? '',
            publicationStatus: bank.publicationStatus ?? 'DRAFT',
            status: bank.publicationStatus === 'PUBLISHED' ? 'ACTIVE' : 'INACTIVE',
            scopeType: bank.scopeType ?? 'TARGETED',
            audiences:
              bank.audiences ??
              old.subjects.find((s) => s.id === bank.subjectId)?.majorIds.map((majorId) => ({ majorId })) ??
              [],
          })),
        }
      },
    },
  ),
)

export function getMockAdminState() {
  return useMockAdminStore.getState()
}
