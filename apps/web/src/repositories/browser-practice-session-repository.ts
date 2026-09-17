import type { PracticeSession } from '../types/practice'
import type { PracticeSessionRepository } from './practice-session-repository'

const STORAGE_KEY = 'qanda.web.practice-sessions.v1'

function readAll(): PracticeSession[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value ? (JSON.parse(value) as PracticeSession[]) : []
  } catch {
    return []
  }
}

function writeAll(sessions: PracticeSession[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export class BrowserPracticeSessionRepository implements PracticeSessionRepository {
  async save(session: PracticeSession) {
    const sessions = readAll()
    const next = sessions.some((item) => item.id === session.id)
      ? sessions.map((item) => (item.id === session.id ? session : item))
      : [session, ...sessions]
    writeAll(next)
  }

  async get(sessionId: string) {
    return readAll().find((session) => session.id === sessionId) ?? null
  }

  async getActiveForBank(questionBankId: string) {
    return readAll().find(
      (session) => session.questionBankId === questionBankId && session.status === 'IN_PROGRESS',
    ) ?? null
  }

  async remove(sessionId: string) {
    writeAll(readAll().filter((session) => session.id !== sessionId))
  }
}
