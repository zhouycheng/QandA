/**
 * PracticeSession 的状态定义与序列化。
 *
 * 全部为纯函数，不依赖 wx 与 storage，便于在 Node 里直接跑断言。
 * 字段对齐 PRD 第 9 节「PracticeSession 核心状态」。
 */

const STORAGE_KEY = 'qandaSession'

/** 业务状态：一次练习在其生命周期内只能沿这个方向前进 */
const SESSION_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  SUBMITTED: 'SUBMITTED'
}

/** 同步状态：MVP 阶段只在 LOCAL_ONLY / SYNC_PENDING / SYNCED 之间流转 */
const SYNC_STATUS = {
  LOCAL_ONLY: 'LOCAL_ONLY',
  SYNC_PENDING: 'SYNC_PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  SYNC_FAILED: 'SYNC_FAILED'
}

/** 单题状态：「当前题」由 currentIndex 派生，不占存储 */
const QUESTION_STATE = {
  UNANSWERED: 'unanswered',
  CORRECT: 'correct',
  WRONG: 'wrong'
}

const VALID_SESSION_STATUS = Object.keys(SESSION_STATUS)
const VALID_SYNC_STATUS = Object.keys(SYNC_STATUS)
const VALID_QUESTION_STATES = [QUESTION_STATE.UNANSWERED, QUESTION_STATE.CORRECT, QUESTION_STATE.WRONG]

const CONFIG_KEYS = ['mode', 'scope', 'subjectId', 'bankId', 'count', 'seed', 'durationMinutes', 'title', 'ids']

/**
 * 生成 sessionId。
 * now / random 可注入，保证单测里 id 可预期；生产环境走默认值即可。
 */
function createSessionId(now, random) {
  const timestamp = typeof now === 'number' ? now : Date.now()
  const suffix = typeof random === 'number'
    ? Math.floor(Math.abs(random) * 46656)
    : Math.floor(Math.random() * 46656)

  return `sess_${timestamp.toString(36)}_${suffix.toString(36)}`
}

function pickValid(value, validList, fallback) {
  return validList.indexOf(value) >= 0 ? value : fallback
}

/**
 * 把内存态压成可落盘的结构。
 *
 * 关键取舍：**只存题目 id，不存题目本体**。
 * 234 道题全部写进 storage 会顶到单键 1MB 的上限，而且题库更新后存储里的
 * 旧题会变成脏数据。存 id 后，恢复时用 config 重新取卷、用 questionOrder 还原题序。
 */
function serializeSession(rawSession) {
  const session = rawSession || {}
  const config = session.config || {}
  const normalizedConfig = {}

  CONFIG_KEYS.forEach((key) => {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      normalizedConfig[key] = config[key]
    }
  })

  // 上层（PracticeSession.getPersistedState）通常已经算好 questionIds / questionOrder，
  // 此时不能再从 questions 重算——它只会拿到空数组并把算好的值覆盖掉。
  const questions = Array.isArray(session.questions) ? session.questions : []
  const hasPreparedIds = Array.isArray(session.questionIds) && session.questionIds.length > 0
  const questionIds = hasPreparedIds
    ? session.questionIds.slice()
    : questions.map((question) => (question && question.id) || '')
  const questionOrder = Array.isArray(session.questionOrder) && session.questionOrder.length
    ? session.questionOrder.filter((index) => Number.isInteger(index) && index >= 0 && index < questionIds.length)
    : questionIds.map((_, index) => index)
  const answers = Array.isArray(session.answers) ? session.answers : []
  const rawStates = Array.isArray(session.questionStates) ? session.questionStates : []

  return {
    sessionId: session.sessionId || '',
    subjectId: session.subjectId || '',
    questionBankId: session.questionBankId || '',
    config: normalizedConfig,
    questionIds,
    questionOrder,
    currentIndex: Number(session.currentIndex) || 0,
    // 稀疏数组：未作答的题保留 null 占位，反序列化时下标才对得上
    answers: questionIds.map((_, index) => {
      const answer = answers[index]

      if (!answer) {
        return null
      }

      return {
        questionId: answer.questionId || questionIds[index],
        selectedKeys: Array.isArray(answer.selectedKeys) ? answer.selectedKeys.slice() : [],
        isCorrect: !!answer.isCorrect
      }
    }),
    questionStates: questionIds.map((_, index) => pickValid(rawStates[index], VALID_QUESTION_STATES, QUESTION_STATE.UNANSWERED)),
    elapsedTime: Math.max(Number(session.elapsedTime) || 0, 0),
    status: pickValid(session.status, VALID_SESSION_STATUS, SESSION_STATUS.IN_PROGRESS),
    syncStatus: pickValid(session.syncStatus, VALID_SYNC_STATUS, SYNC_STATUS.LOCAL_ONLY),
    createdAt: Number(session.createdAt) || 0,
    updatedAt: Number(session.updatedAt) || 0
  }
}

/**
 * 反序列化，并对脏数据做兜底。
 *
 * 真实 wx.getStorageSync 在键不存在时返回空字符串 ''，而内存 mock 返回 null，
 * 两种都要能吃下；历史版本缺字段（例如没有 questionStates）也必须能读出来。
 */
function normalizeSession(rawSession) {
  if (!rawSession || typeof rawSession !== 'object') {
    return null
  }

  const sessionId = typeof rawSession.sessionId === 'string' ? rawSession.sessionId : ''

  if (!sessionId) {
    return null
  }

  const questionIds = Array.isArray(rawSession.questionIds)
    ? rawSession.questionIds.filter((id) => typeof id === 'string' && id)
    : []

  if (!questionIds.length) {
    return null
  }

  const rawOrder = Array.isArray(rawSession.questionOrder) ? rawSession.questionOrder : []
  // 顺序里混进越界或非整数下标会直接把题目列表读乱，这里先过滤再补齐
  const seen = {}
  const questionOrder = rawOrder.filter((index) => {
    const value = Number(index)

    if (!Number.isInteger(value) || value < 0 || value >= questionIds.length || seen[value]) {
      return false
    }

    seen[value] = true
    return true
  })

  questionIds.forEach((_, index) => {
    if (!seen[index]) {
      questionOrder.push(index)
    }
  })

  const rawAnswers = Array.isArray(rawSession.answers) ? rawSession.answers : []
  const rawStates = Array.isArray(rawSession.questionStates) ? rawSession.questionStates : []
  const config = rawSession.config && typeof rawSession.config === 'object' ? rawSession.config : {}
  const normalizedConfig = {}

  CONFIG_KEYS.forEach((key) => {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      normalizedConfig[key] = config[key]
    }
  })

  return {
    sessionId,
    subjectId: typeof rawSession.subjectId === 'string' ? rawSession.subjectId : '',
    questionBankId: typeof rawSession.questionBankId === 'string' ? rawSession.questionBankId : '',
    config: normalizedConfig,
    questionIds,
    questionOrder,
    currentIndex: Math.min(
      Math.max(Number(rawSession.currentIndex) || 0, 0),
      questionIds.length - 1
    ),
    answers: questionIds.map((id, index) => {
      const answer = rawAnswers[index]

      if (!answer || typeof answer !== 'object') {
        return null
      }

      return {
        questionId: typeof answer.questionId === 'string' && answer.questionId ? answer.questionId : id,
        selectedKeys: Array.isArray(answer.selectedKeys)
          ? answer.selectedKeys.filter((key) => typeof key === 'string')
          : [],
        isCorrect: !!answer.isCorrect
      }
    }),
    questionStates: questionIds.map((id, index) => {
      const rawState = rawStates[index]

      if (validQuestionState(rawState)) {
        return rawState
      }

      const answer = rawAnswers[index]
      return answer ? (answer.isCorrect ? QUESTION_STATE.CORRECT : QUESTION_STATE.WRONG) : QUESTION_STATE.UNANSWERED
    }),
    elapsedTime: Math.max(Number(rawSession.elapsedTime) || 0, 0),
    status: pickValid(rawSession.status, VALID_SESSION_STATUS, SESSION_STATUS.IN_PROGRESS),
    syncStatus: pickValid(rawSession.syncStatus, VALID_SYNC_STATUS, SYNC_STATUS.LOCAL_ONLY),
    createdAt: Number(rawSession.createdAt) || 0,
    updatedAt: Number(rawSession.updatedAt) || 0
  }
}

function validQuestionState(value) {
  return VALID_QUESTION_STATES.indexOf(value) >= 0
}

/** 未完成 = 还能继续答。SUBMITTED 后不再进恢复流程 */
function isResumable(session) {
  return !!session && session.status !== SESSION_STATUS.SUBMITTED
}

/** 由答案数组派生单题状态，避免两处维护同一套规则 */
function deriveQuestionStates(answers, total) {
  const safeTotal = Math.max(Number(total) || 0, 0)

  return Array.from({ length: safeTotal }, (_, index) => {
    const answer = answers[index]

    if (!answer) {
      return QUESTION_STATE.UNANSWERED
    }

    return answer.isCorrect ? QUESTION_STATE.CORRECT : QUESTION_STATE.WRONG
  })
}

module.exports = {
  CONFIG_KEYS,
  QUESTION_STATE,
  SESSION_STATUS,
  STORAGE_KEY,
  SYNC_STATUS,
  VALID_QUESTION_STATES,
  VALID_SESSION_STATUS,
  VALID_SYNC_STATUS,
  createSessionId,
  deriveQuestionStates,
  isResumable,
  normalizeSession,
  serializeSession
}
