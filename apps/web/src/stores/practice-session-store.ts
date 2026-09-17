import { create } from 'zustand'
import type { PracticeSession, SyncStatus } from '../types/practice'

interface PracticeSessionState {
  session: PracticeSession | null
  setSession: (session: PracticeSession | null) => void
  answer: (questionId: string, answer: string[]) => void
  confirmAnswer: (questionId: string) => void
  goTo: (index: number) => void
  tick: () => void
  setSyncStatus: (syncStatus: SyncStatus) => void
  markSubmitted: () => void
}

function updateSession(
  session: PracticeSession | null,
  update: (value: PracticeSession) => PracticeSession,
) {
  if (!session) return null
  return { ...update(session), updatedAt: new Date().toISOString() }
}

export const usePracticeSessionStore = create<PracticeSessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  answer: (questionId, answer) => set((state) => ({
    session: updateSession(state.session, (session) => ({
      ...session,
      answers: { ...session.answers, [questionId]: answer },
      confirmedQuestionIds: session.confirmedQuestionIds.filter((id) => id !== questionId),
    })),
  })),
  confirmAnswer: (questionId) => set((state) => ({
    session: updateSession(state.session, (session) => ({
      ...session,
      confirmedQuestionIds: session.confirmedQuestionIds.includes(questionId)
        ? session.confirmedQuestionIds
        : [...session.confirmedQuestionIds, questionId],
    })),
  })),
  goTo: (index) => set((state) => ({
    session: updateSession(state.session, (session) => ({
      ...session,
      currentIndex: Math.min(Math.max(index, 0), session.questionIds.length - 1),
    })),
  })),
  tick: () => set((state) => ({
    session: updateSession(state.session, (session) => ({
      ...session,
      elapsedSeconds: session.elapsedSeconds + 1,
    })),
  })),
  setSyncStatus: (syncStatus) => set((state) => ({
    session: updateSession(state.session, (session) => ({ ...session, syncStatus })),
  })),
  markSubmitted: () => set((state) => ({
    session: updateSession(state.session, (session) => ({
      ...session,
      status: 'SUBMITTED',
      syncStatus: 'SYNCED',
    })),
  })),
}))
