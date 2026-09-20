const {
  getSubjectSummaries,
  loadBank,
  normalizeQuestionView
} = require('./question-bank-catalog.js')

/**
 * 题目反查：错题本与收藏只保存题目 id，展示时按 id 从运行态题库还原正文。
 * 索引在首次访问时惰性构建并缓存，题库为本地静态数据，无需失效处理。
 */
let indexCache = null

function buildQuestionIndex() {
  const index = {}

  getSubjectSummaries().forEach((subject) => {
    ;(subject.banks || []).forEach((bank) => {
      const rawBank = loadBank(bank.id)

      if (!rawBank || !Array.isArray(rawBank.questions)) {
        return
      }

      rawBank.questions.forEach((question) => {
        if (!question || !question.id) {
          return
        }

        index[question.id] = {
          id: question.id,
          question: normalizeQuestionView(question),
          subjectId: subject.id,
          subjectName: subject.name,
          bankId: bank.id,
          bankName: bank.name
        }
      })
    })
  })

  return index
}

function getQuestionIndex() {
  if (!indexCache) {
    indexCache = buildQuestionIndex()
  }

  return indexCache
}

function findQuestionEntries(questionIds) {
  const index = getQuestionIndex()

  return (questionIds || [])
    .map((questionId) => index[questionId] || null)
    .filter(Boolean)
}

function findQuestionsByIds(questionIds) {
  return findQuestionEntries(questionIds).map((entry) => entry.question)
}

/**
 * 用一组题目 id 组装练习卷，用于错题重练 / 收藏练习。
 * 题目可能跨科目与题库，因此不写入历史最佳（storageKey 为空）。
 */
function getQuizByIds(questionIds, title) {
  const entries = findQuestionEntries(questionIds)

  if (!entries.length) {
    return null
  }

  return {
    subjectId: entries[0].subjectId,
    subjectName: entries[0].subjectName,
    bankId: '',
    bankName: '自定义练习',
    title: title || '自定义练习',
    sharePath: '/page/practice/index',
    storageKey: '',
    questions: entries.map((entry) => entry.question),
    sourceEntries: entries
  }
}

module.exports = {
  buildQuestionIndex,
  findQuestionEntries,
  findQuestionsByIds,
  getQuestionIndex,
  getQuizByIds
}
