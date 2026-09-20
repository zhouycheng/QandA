const practiceRepository = require('../repositories/practice-repository.js')

/**
 * 题目详情（PRD 第 5 页清单中的 question-detail）。
 *
 * 题目正文按 id 从运行态题库反查，不进 storage；
 * 「你的答案」来自落盘的 PracticeSession，没带 sessionId 时只显示题目与解析。
 */
function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getInitialQuestionDetailData() {
  return {
    ready: false,
    emptyText: '',
    questionId: '',
    subjectName: '',
    bankName: '',
    typeText: '',
    stem: '',
    options: [],
    hasAnswer: false,
    answered: false,
    isCorrect: false,
    selectedText: '',
    correctText: '',
    explanation: '',
    isFavorite: false
  }
}

function decodeOptionValue(value) {
  return value ? decodeURIComponent(value) : ''
}

function getAnswerText(question, keys) {
  if (!question || !keys || !keys.length) {
    return ''
  }

  return keys
    .map((key) => {
      const option = question.options.find((item) => item.key === key)

      return option ? `${key}. ${option.text}` : key
    })
    .join('  ')
}

class QuestionDetailViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialQuestionDetailData()
  }

  load(options) {
    const normalizedOptions = options || {}
    const questionId = decodeOptionValue(normalizedOptions.id)
    const sessionId = decodeOptionValue(normalizedOptions.sessionId)

    if (!questionId) {
      return {
        data: Object.assign(getInitialQuestionDetailData(), {
          ready: true,
          emptyText: '未指定题目'
        })
      }
    }

    const entries = typeof this.repository.findQuestionEntries === 'function'
      ? this.repository.findQuestionEntries([questionId])
      : []
    const entry = entries && entries.length ? entries[0] : null

    if (!entry) {
      return {
        data: Object.assign(getInitialQuestionDetailData(), {
          ready: true,
          emptyText: '题目不存在或已被移除'
        })
      }
    }

    const question = entry.question
    const answer = this.findSessionAnswer(sessionId, questionId)
    const favoriteIds = typeof this.repository.getFavoriteIds === 'function'
      ? this.repository.getFavoriteIds(this.repository.getFavorites(this.storage))
      : []
    const selectedKeys = answer ? answer.selectedKeys : []

    return {
      data: {
        ready: true,
        emptyText: '',
        questionId: question.id,
        subjectName: entry.subjectName || '',
        bankName: entry.bankName || '',
        typeText: question.typeText || '',
        stem: question.stem || '',
        options: (question.options || []).map((option) => ({
          key: option.key,
          label: option.label || option.key,
          text: option.text || '',
          isCorrectOption: question.answerKeys.indexOf(option.key) >= 0,
          isSelected: selectedKeys.indexOf(option.key) >= 0
        })),
        hasAnswer: !!answer,
        answered: !!answer,
        isCorrect: answer ? !!answer.isCorrect : false,
        selectedText: answer ? getAnswerText(question, answer.selectedKeys) || '未作答' : '',
        correctText: getAnswerText(question, question.answerKeys),
        explanation: question.explanation || '本题暂无解析。',
        isFavorite: favoriteIds.indexOf(question.id) >= 0
      }
    }
  }

  /** 用户答案只认同一场会话：sessionId 对不上就当作没答过 */
  findSessionAnswer(sessionId, questionId) {
    if (!sessionId || typeof this.repository.getSession !== 'function') {
      return null
    }

    const session = this.repository.getSession(this.storage)

    if (!session || session.sessionId !== sessionId) {
      return null
    }

    const index = (session.questionIds || []).indexOf(questionId)

    if (index < 0) {
      return null
    }

    // answers 按展示顺序存，questionOrder 才是下标映射
    const order = session.questionOrder || []
    const position = order.indexOf(index)
    const answer = position >= 0 ? (session.answers || [])[position] : null

    return answer || null
  }

  toggleFavorite(questionId) {
    if (!questionId || typeof this.repository.toggleQuestionFavorite !== 'function') {
      return null
    }

    const result = this.repository.toggleQuestionFavorite(this.storage, questionId)

    return {
      data: {
        isFavorite: !!result.value
      }
    }
  }
}

module.exports = {
  QuestionDetailViewModel,
  getInitialQuestionDetailData
}
