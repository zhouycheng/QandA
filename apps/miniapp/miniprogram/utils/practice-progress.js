/**
 * 做题进度：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaProgress）：
 * {
 *   "chinese-ch001": {
 *     total: 29,
 *     answers: { "chinese-ch001-q001": 1, "chinese-ch001-q002": 0 },
 *     updatedAt: 1758000000000
 *   },
 *   "subject-chinese": { ... }   // 整科抽题 / 模拟测试
 * }
 *
 * answers 的取值：1 = 答对，0 = 答错。未作答的题不写入，因此"已做"= 键数量。
 */

const PROGRESS_STORAGE_KEY = 'qandaProgress'

function createEmptyProgress() {
  return {}
}

function normalizeProgress(rawProgress) {
  if (!rawProgress || typeof rawProgress !== 'object') {
    return createEmptyProgress()
  }

  return Object.keys(rawProgress).reduce((result, scopeKey) => {
    const entry = rawProgress[scopeKey]

    if (!entry || typeof entry !== 'object') {
      return result
    }

    const rawAnswers = entry.answers && typeof entry.answers === 'object' ? entry.answers : {}
    const answers = {}

    Object.keys(rawAnswers).forEach((questionId) => {
      const value = rawAnswers[questionId]

      if (value === 1 || value === true) {
        answers[questionId] = 1
      } else if (value === 0 || value === false) {
        answers[questionId] = 0
      }
    })

    result[scopeKey] = {
      total: Number(entry.total) || 0,
      answers,
      updatedAt: Number(entry.updatedAt) || 0
    }

    return result
  }, {})
}

function mergeScopeRecords(progress, scopeKey, records, total, timestamp) {
  if (!scopeKey) {
    return progress
  }

  const current = progress[scopeKey] || { total: 0, answers: {}, updatedAt: 0 }
  const answers = Object.assign({}, current.answers)
  let hasNewAnswer = false

  ;(records || []).forEach((record) => {
    if (!record || !record.id || !record.answered) {
      return
    }

    answers[record.id] = record.correct ? 1 : 0
    hasNewAnswer = true
  })

  if (!hasNewAnswer) {
    return progress
  }

  const nextProgress = Object.assign({}, progress)

  nextProgress[scopeKey] = {
    total: Number(total) || current.total || 0,
    answers,
    updatedAt: Number(timestamp) || Date.now()
  }

  return nextProgress
}

function mergeAnswerMaps(maps) {
  const merged = {}

  ;(maps || []).forEach((map) => {
    if (!map || typeof map !== 'object') {
      return
    }

    Object.keys(map).forEach((questionId) => {
      merged[questionId] = map[questionId]
    })
  })

  return merged
}

function summarizeAnswers(answers, total) {
  const questionIds = Object.keys(answers || {})
  const answered = questionIds.length
  const correct = questionIds.reduce((sum, questionId) => sum + (answers[questionId] === 1 ? 1 : 0), 0)
  const totalCount = Number(total) || answered
  const wrong = answered - correct
  // 正确率按"已做题目"计算，未做的不拉低正确率
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0
  // 进度按"已做 / 总题量"计算，反映掌握范围
  const progressPercent = totalCount ? Math.min(Math.round((answered / totalCount) * 100), 100) : 0

  return {
    total: totalCount,
    answered,
    correct,
    wrong,
    accuracy,
    accuracyText: `${accuracy}%`,
    progressPercent,
    answeredText: `${answered} / ${totalCount}`,
    hasProgress: answered > 0,
    totalText: `${totalCount} 题`
  }
}

function collectAnswerMaps(progress, scopeKeys) {
  return (scopeKeys || [])
    .map((scopeKey) => {
      const entry = progress[scopeKey]
      return entry ? entry.answers : null
    })
    .filter(Boolean)
}

/**
 * 汇总一个科目下的所有题库进度。
 * @param {object} progress 已规范化的进度表
 * @param {object} subject 科目（需含 banks 与 questionCount）
 */
function summarizeSubjectProgress(progress, subject) {
  if (!subject) {
    return summarizeAnswers({}, 0)
  }

  const bankIds = (subject.banks || []).map((bank) => bank.id)
  // 科目自身的 scope（整科抽题 / 模拟测试）也并入，题目 id 天然去重
  const maps = collectAnswerMaps(progress, bankIds.concat([subject.id]))

  return summarizeAnswers(mergeAnswerMaps(maps), subject.questionCount)
}

function summarizeBankProgress(progress, bank) {
  if (!bank) {
    return summarizeAnswers({}, 0)
  }

  const entry = progress[bank.id]

  return summarizeAnswers(entry ? entry.answers : {}, bank.questionCount)
}

/**
 * 汇总全部科目进度（多科目间按题目 id 去重）。
 * @param {object} progress 已规范化的进度表
 * @param {Array} subjects 科目列表，每项需含 banks 与 questionCount
 */
function summarizeOverallProgress(progress, subjects) {
  const scopeKeys = []
  let total = 0

  ;(subjects || []).forEach((subject) => {
    total += Number(subject.questionCount) || 0
    ;(subject.banks || []).forEach((bank) => scopeKeys.push(bank.id))
    scopeKeys.push(subject.id)
  })

  return summarizeAnswers(mergeAnswerMaps(collectAnswerMaps(progress, scopeKeys)), total)
}

/**
 * 从一次交卷结果构造写入用的题目记录。
 * @param {Array} questions 本次练习的题目
 * @param {Array} answers 与 questions 同序的作答数组
 */
function buildAnswerRecords(questions, answers) {
  return (questions || []).map((question, index) => {
    const answer = (answers || [])[index]

    return {
      id: question ? question.id : '',
      answered: !!answer,
      correct: !!(answer && answer.isCorrect)
    }
  })
}

module.exports = {
  PROGRESS_STORAGE_KEY,
  buildAnswerRecords,
  createEmptyProgress,
  mergeAnswerMaps,
  mergeScopeRecords,
  normalizeProgress,
  summarizeAnswers,
  summarizeBankProgress,
  summarizeOverallProgress,
  summarizeSubjectProgress
}
