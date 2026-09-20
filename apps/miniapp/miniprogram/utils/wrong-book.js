/**
 * 错题本：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaWrongBook）：
 * {
 *   "q-cc-ch001-homework-001": {
 *     wrongCount: 2,
 *     rightCount: 1,
 *     streak: 1,        // 当前连续答对次数
 *     mastered: false,  // 连续答对 MASTER_STREAK 次视为已攻克
 *     updatedAt: 1758000000000
 *   }
 * }
 *
 * 判定规则：
 * - 答错或未作答：计入错题本，wrongCount + 1，连续答对清零；
 * - 答对：若该题从未错过则不入库（避免做过的题全部堆进错题本）；
 *   已在错题本中的题目答对时 rightCount + 1、连续答对 + 1，
 *   达到 MASTER_STREAK 后移出待复习列表（记录保留在「已攻克」）。
 */

const WRONG_BOOK_STORAGE_KEY = 'qandaWrongBook'
const MASTER_STREAK = 2

function createEmptyWrongBook() {
  return {}
}

function normalizeRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') {
    return null
  }

  const wrongCount = Number(rawRecord.wrongCount) || 0
  const rightCount = Number(rawRecord.rightCount) || 0
  const streak = Number(rawRecord.streak) || 0

  return {
    wrongCount,
    rightCount,
    streak,
    mastered: rawRecord.mastered === true || streak >= MASTER_STREAK,
    updatedAt: Number(rawRecord.updatedAt) || 0
  }
}

function normalizeWrongBook(rawWrongBook) {
  if (!rawWrongBook || typeof rawWrongBook !== 'object') {
    return createEmptyWrongBook()
  }

  return Object.keys(rawWrongBook).reduce((result, questionId) => {
    const record = normalizeRecord(rawWrongBook[questionId])

    if (record && questionId) {
      result[questionId] = record
    }

    return result
  }, {})
}

/**
 * 把一次交卷的逐题结果并入错题本。
 * @param {object} wrongBook 已规范化的错题本
 * @param {Array} records [{ id, answered, correct }]，未作答按答错处理
 * @param {number} timestamp 时间戳
 */
function mergeResults(wrongBook, records, timestamp) {
  const normalized = normalizeWrongBook(wrongBook)
  const next = Object.assign({}, normalized)
  const time = Number(timestamp) || Date.now()
  let changed = false

  ;(records || []).forEach((record) => {
    if (!record || !record.id) {
      return
    }

    const isCorrect = !!record.answered && !!record.correct
    const existing = next[record.id] || null

    // 从没做错的题不进错题本，否则做过的题会被全部收录
    if (isCorrect && (!existing || existing.wrongCount === 0)) {
      return
    }

    const current = existing || {
      wrongCount: 0,
      rightCount: 0,
      streak: 0,
      mastered: false,
      updatedAt: 0
    }
    const streak = isCorrect ? current.streak + 1 : 0

    next[record.id] = {
      wrongCount: current.wrongCount + (isCorrect ? 0 : 1),
      rightCount: current.rightCount + (isCorrect ? 1 : 0),
      streak,
      mastered: streak >= MASTER_STREAK,
      updatedAt: time
    }
    changed = true
  })

  return changed ? next : normalized
}

function collectIds(wrongBook, mastered) {
  return Object.keys(normalizeWrongBook(wrongBook))
    .filter((questionId) => {
      const record = wrongBook[questionId]
      return mastered ? record.mastered : !record.mastered
    })
    .sort((left, right) => wrongBook[right].updatedAt - wrongBook[left].updatedAt)
}

function getPendingIds(wrongBook) {
  return collectIds(normalizeWrongBook(wrongBook), false)
}

function getMasteredIds(wrongBook) {
  return collectIds(normalizeWrongBook(wrongBook), true)
}

function summarizeWrongBook(wrongBook) {
  const normalized = normalizeWrongBook(wrongBook)

  return {
    pending: collectIds(normalized, false).length,
    mastered: collectIds(normalized, true).length,
    total: Object.keys(normalized).length
  }
}

function removeIds(wrongBook, questionIds, timestamp) {
  const normalized = normalizeWrongBook(wrongBook)
  const next = Object.assign({}, normalized)
  const time = Number(timestamp) || Date.now()
  let changed = false

  ;(questionIds || []).forEach((questionId) => {
    if (next[questionId]) {
      delete next[questionId]
      changed = true
    }
  })

  if (!changed) {
    return normalized
  }

  // 删除后重新写入时间戳，保证列表排序稳定
  return Object.keys(next).reduce((result, questionId) => {
    result[questionId] = Object.assign({}, next[questionId], { updatedAt: time })
    return result
  }, {})
}

module.exports = {
  MASTER_STREAK,
  WRONG_BOOK_STORAGE_KEY,
  createEmptyWrongBook,
  getMasteredIds,
  getPendingIds,
  mergeResults,
  normalizeWrongBook,
  removeIds,
  summarizeWrongBook
}
