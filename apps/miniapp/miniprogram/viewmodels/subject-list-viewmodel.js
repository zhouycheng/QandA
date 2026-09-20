const practiceRepository = require('../repositories/practice-repository.js')
const {
  summarizeAnswers,
  summarizeOverallProgress
} = require('../utils/practice-progress.js')
const { TIP_ACTIONS, buildHomeContent } = require('../utils/home-content.js')
const { formatStudyDuration } = require('../utils/study-time.js')

function getInitialSubjectListViewData() {
  return {
    // 科目列表已归位到「题库」tab，首页只保留全局汇总，不再下发 subjects
    overall: null,
    lastPractice: null,
    home: {
      greeting: '',
      dateText: '',
      advice: '',
      quote: '',
      wrongCount: 0,
      studyTimeText: '尚未开始',
      tip: null
    },
    routeLoadingVisible: false,
    routeLoadingTitle: '正在打开',
    routeLoadingDescription: ''
  }
}

class SubjectListViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || null
  }

  static getInitialData() {
    return getInitialSubjectListViewData()
  }

  load() {
    const subjects = this.repository.getSubjectSummaries()
    const progress = this.repository.getProgress(this.storage)
    const overallStats = summarizeOverallProgress(progress, subjects)
    const wrongSummary = this.getWrongBookSummary()
    const studyTime = this.getStudyTime()

    // 首页文案与统计口径共用同一份 summary，
    // 避免出现「横幅说还有 3 道错题、卡片写 5 道」这类前后不一致
    const summary = {
      answered: overallStats.answered,
      total: overallStats.total,
      accuracyText: overallStats.accuracyText,
      progressPercent: overallStats.progressPercent,
      pendingWrong: wrongSummary.pending,
      masteredWrong: wrongSummary.mastered,
      studySeconds: studyTime.totalSeconds,
      studySessionCount: studyTime.sessionCount
    }

    return {
      data: Object.assign(getInitialSubjectListViewData(), {
        overall: Object.assign({}, overallStats, {
          subjectCount: subjects.length,
          bankCount: subjects.reduce((total, subject) => total + (subject.bankCount || 0), 0)
        }),
        home: Object.assign({}, buildHomeContent(summary), {
          wrongCount: wrongSummary.pending,
          studyTimeText: formatStudyDuration(studyTime.totalSeconds)
        }),
        lastPractice: this.buildLastPractice(progress)
      })
    }
  }

  /** 错题本汇总；仓储未提供对应方法时退化为空，保证首页仍能渲染 */
  getWrongBookSummary() {
    if (!this.repository.getWrongBook || !this.repository.summarizeWrongBook) {
      return { pending: 0, mastered: 0, total: 0 }
    }

    return this.repository.summarizeWrongBook(this.repository.getWrongBook(this.storage))
  }

  getStudyTime() {
    if (!this.repository.getStudyTime) {
      return { totalSeconds: 0, sessionCount: 0, updatedAt: 0 }
    }

    return this.repository.getStudyTime(this.storage)
  }

  /**
   * 找出「继续练习」的入口。
   *
   * 优先用未完成的 PracticeSession：它才是真正的"半场练习"，
   * 能接着原来的题序和答案往下做。没有未完成会话时，
   * 才退回"最近做过哪个题库"（只有进度统计，进入即新开一轮）。
   */
  buildLastPractice(progress) {
    const resumed = this.buildResumablePractice()

    if (resumed) {
      return resumed
    }

    return this.buildLatestProgressPractice(progress)
  }

  buildResumablePractice() {
    if (typeof this.repository.getResumableSession !== 'function') {
      return null
    }

    const session = this.repository.getResumableSession(this.storage)

    if (!session) {
      return null
    }

    const config = session.config || {}
    const scopeKey = config.bankId || config.subjectId || ''
    const meta = typeof this.repository.getScopeMeta === 'function'
      ? this.repository.getScopeMeta(scopeKey)
      : null
    const answered = (session.answers || []).filter(Boolean).length
    const total = (session.questionIds || []).length
    const title = (config.title && String(config.title)) ||
      (meta && meta.title) ||
      '继续上次练习'

    return {
      resumed: true,
      scopeKey,
      title,
      description: (meta && meta.description) || '',
      url: `/page/practice/index?sessionId=${encodeURIComponent(session.sessionId)}`,
      metaText: answered > 0
        ? `进行中 · 已答 ${answered} / ${total} 题`
        : `进行中 · 共 ${total} 题`
    }
  }

  /** 没有未完成会话时的兜底：最近做过哪个题库 */
  buildLatestProgressPractice(progress) {
    const scopeKeys = Object.keys(progress || {})

    if (!scopeKeys.length) {
      return null
    }

    const latestScopeKey = scopeKeys.reduce((latest, scopeKey) => {
      if (!latest) {
        return scopeKey
      }

      const currentUpdatedAt = (progress[scopeKey] && progress[scopeKey].updatedAt) || 0
      const latestUpdatedAt = (progress[latest] && progress[latest].updatedAt) || 0

      return currentUpdatedAt > latestUpdatedAt ? scopeKey : latest
    }, '')

    const meta = this.repository.getScopeMeta(latestScopeKey)

    if (!meta) {
      return null
    }

    const entry = progress[latestScopeKey] || { answers: {}, total: 0 }
    const stats = summarizeAnswers(entry.answers, entry.total)

    return Object.assign({}, meta, {
      stats,
      metaText: `已做 ${stats.answered} 题 · 正确率 ${stats.accuracyText}`
    })
  }

  openPractice(url, title) {
    if (!url) {
      return null
    }

    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url,
          title: '正在开始练习',
          description: title || ''
        }
      }
    }
  }

  /** 学习数据卡右上角「详情」→ 统计 tab */
  openStats() {
    return {
      command: {
        type: 'switchTab',
        url: '/page/stats/index'
      }
    }
  }

  /** 「去刷题」→ 题库 tab。不带 subjectId，保留题库页当前选中的科目 */
  openBank() {
    return {
      command: {
        type: 'switchTab',
        url: '/page/bank-detail/index'
      }
    }
  }

  /** 「待复习错题」格 → 错题本 */
  openWrongBook() {
    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: '/page/wrong-book/index?tab=wrong',
          title: '正在打开错题本',
          description: '读取待复习题目'
        }
      }
    }
  }

  /** 公告条「去复习 / 去刷题」：按文案层给出的 action 决定去向 */
  openTipAction(action) {
    if (action === TIP_ACTIONS.STATS) {
      return this.openStats()
    }

    if (action === TIP_ACTIONS.WRONG_BOOK) {
      return this.openWrongBook()
    }

    return this.openBank()
  }

  closeRouteLoading() {
    return {
      data: {
        routeLoadingVisible: false
      }
    }
  }

  getShareMessage() {
    return {
      title: 'QandA 题库',
      path: '/page/subject-list/index'
    }
  }
}

module.exports = {
  SubjectListViewModel
}
