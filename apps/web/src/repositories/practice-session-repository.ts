import type { PracticeSession } from '../types/practice'

export interface PracticeSessionRepository {
  save(session: PracticeSession): Promise<void>
  get(sessionId: string): Promise<PracticeSession | null>
  getActiveForBank(questionBankId: string): Promise<PracticeSession | null>
  remove(sessionId: string): Promise<void>
}
