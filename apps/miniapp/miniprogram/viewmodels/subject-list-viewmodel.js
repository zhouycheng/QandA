const practiceRepository = require('../repositories/practice-repository.js')
const {
  summarizeAnswers,
  summarizeOverallProgress
} = require('../utils/practice-progress.js')
const { TIP_ACTIONS, buildHomeContent } = require('../utils/home-content.js')
const { formatStudyDuration } = require('../utils/study-time.js')
const { buildExamCountdown } = require('../utils/exam-countdown.js')
const questionSearch = require('../utils/question-search.js')

/**
 * 「我的学习空间」四宫格。
 * 顺序固定为 最近练习 / 模拟考试 / 我的错题 / 我的收藏，与原型一致；
 * `key` 是点击分发的唯一依据，页面不写死中文。
 */
const STUDY_ENTRIES = [
  {
    key: 'recent',
    label: '最近练习',
    description: '接着上次的题库继续'
  },
  {
    key: 'mock',
    label: '模拟考试',
    description: '按题量与时长抽一套'
  },
  {
    key: 'wrong',
    label: '我的错题',
    description: '答错与跳过的题'
  },
  {
    key: 'favorite',
    label: '我的收藏',
    description: '手动标记的题目'
  }
]

/** 一键模拟考试：抽题上限与时长下限（详见 openMock 注释） */
const MOCK_EXAM_QUESTION_COUNT = 20
const MOCK_EXAM_MIN_MINUTES = 10

/** 每题 1 分钟，向上取整到 5 分钟倍数，保底下限 */
function resolveMockDuration(count) {
  const rounded = Math.ceil(Number(count) / 5) * 5

  return Math.max(MOCK_EXAM_MIN_MINUTES, rounded)
}

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
      // 封面图由 home-content 按时段给出（早/中/晚三张），初始值只是占位
      dayPart: 'noon',
      coverImage: '/assets/home/cover-noon.jpg',
      wrongCount: 0,
      studyTimeText: '尚未开始',
      tip: null
    },
    // 倒计时卡：未设置考试时 configured=false，卡片变成「去设置」引导
    exam: buildExamCountdown(null),
    // 四宫格上显示的计数 / 状态徽标
    entries: STUDY_ENTRIES.map((item) => Object.assign({}, item, { badge: '', disabled: false })),
    // 公告弹层（内容取 home.tip，按学习状态推导，不是写死的一篇）
    announcementSheetVisible: false,
    // 题目搜索
    searchVisible: false,
    searchKeyword: '',
    searchResults: [],
    searchLoading: false,
    searchSearched: false,
    searchResultCount: 0,
    searchHasMore: false,
    // 搜索面板空态文案：题库总数用于「在全部 N 道题里查」
    searchTotalText: '',
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
    this.searchPage = 0
    this.searchResults = []
    this.searchText = ''
  }

  refreshRemote(subjectId) {
    if (!this.repository.isRemoteEnabled || !this.repository.isRemoteEnabled()) return Promise.resolve(null)
    return this.repository.refreshRemote(this.storage, 'all').then(() => this.load()).catch((error) => ({ command: { type: 'toast', title: error.message } }))
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
    const preferences = this.getPreferences()

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

    const lastPractice = this.buildLastPractice(progress)

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
        exam: buildExamCountdown({ examName: preferences.examName, examDate: preferences.examDate }),
        entries: this.buildEntries(lastPractice),
        searchTotalText: overallStats.total > 0 ? `在全部 ${overallStats.total} 道题里查题干与选项` : '题库还是空的，先去导入或切换题库',
        lastPractice
      })
    }
  }

  /** 读偏好失败时退回默认值：首页是 tabBar 主页面，不能因为一个字段崩掉 */
  getPreferences() {
    try {
      return this.repository.getPreferences(this.storage) || {}
    } catch (error) {
      return {}
    }
  }

  /**
   * 四宫格徽标。
   * 有数字的显示数字（错题 / 收藏 / 最近练习的已答题数），
   * 没有的留空——空徽标比写「0」更克制，不会让四项看起来都"空"。
   */
  buildEntries(lastPractice) {
    const wrongCount = this.getWrongBookSummary().pending
    const favoriteCount = this.getFavoriteCount()
    const recentAnswered = lastPractice && lastPractice.stats ? lastPractice.stats.answered : 0

    return STUDY_ENTRIES.map((item) => {
      if (item.key === 'wrong') {
        return Object.assign({}, item, { badge: wrongCount > 0 ? String(wrongCount) : '' })
      }

      if (item.key === 'favorite') {
        return Object.assign({}, item, { badge: favoriteCount > 0 ? String(favoriteCount) : '' })
      }

      if (item.key === 'recent') {
        return Object.assign({}, item, { badge: recentAnswered > 0 ? String(recentAnswered) : '' })
      }

      return Object.assign({}, item, { badge: '' })
    })
  }

  getFavoriteCount() {
    if (typeof this.repository.getFavoriteIds !== 'function' || typeof this.repository.getFavorites !== 'function') {
      return 0
    }

    try {
      return this.repository.getFavoriteIds(this.repository.getFavorites(this.storage)).length
    } catch (error) {
      return 0
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
    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled()) {
      const recent = this.repository.getRemoteRecent(this.storage).find((item) => item.status === 'IN_PROGRESS')
      if (recent) { const meta = this.repository.getScopeMeta(recent.questionBankId || recent.bankId); return { resumed: true, scopeKey: recent.questionBankId || recent.bankId, title: meta ? meta.title : '继续练习', description: meta ? meta.description : '', url: `/page/practice/index?sessionId=${recent.id}`, metaText: '云端练习 · 继续答题' } }
      return null
    }
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

  // ---------- 四宫格 ----------

  /** 四宫格分发：只在 ViewModel 里决定去向，页面只按 key 调一次 */
  openEntry(key) {
    if (key === 'wrong') {
      return this.openWrongBook()
    }

    if (key === 'favorite') {
      return {
        command: {
          type: 'openRouteWithLoading',
          payload: {
            url: '/page/wrong-book/index?tab=favorite',
            title: '正在打开收藏',
            description: '读取已收藏题目'
          }
        }
      }
    }

    if (key === 'recent') {
      return this.openRecent()
    }

    if (key === 'mock') {
      return this.openMock()
    }

    return null
  }

  /**
   * 最近练习：有半场会话就直接续做；只有历史进度时提示去题库，
   * 不硬造一个「重新开始」——用户点「最近练习」期待的是接着上次，不是重来。
   */
  openRecent() {
    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled()) {
      const recent = this.repository.getRemoteRecent(this.storage)
      const runtime = require('../repositories/online-practice.js').current()
      const waiting = runtime ? runtime.waitingIds().map(id => { const record = runtime.getWaiting(id); return record ? Object.assign({ id }, record) : null }).filter(Boolean) : []
      if (waiting.length) {
        const choices = waiting.map(item => ({ id: item.id, label: item.writer && item.writer.writerToken ? '同步完成 · 继续答题' : '等待同步 · 查看进度' }))
        recent.filter(item => !choices.some(choice => choice.id === item.id)).forEach(item => {
          const meta = this.repository.getScopeMeta(item.questionBankId)
          choices.push({ id: item.id, label: `${item.status === 'SUBMITTED' ? '结果' : '继续'} · ${meta ? meta.title : '练习'} · ${(item.createdAt || '').slice(0, 10)}` })
        })
        return { command: { type: 'choosePractice', choices } }
      }
      const record = recent.find((item) => item.status === 'IN_PROGRESS') || recent.find((item) => item.status === 'SUBMITTED')
      if (record) return this.openPractice(`/page/practice/index?sessionId=${encodeURIComponent(record.id)}`, record.status === 'SUBMITTED' ? '查看练习结果' : '继续练习')
    }
    const lastPractice = this.buildLastPractice(this.repository.getProgress(this.storage))

    if (lastPractice && lastPractice.resumed && lastPractice.url) {
      return this.openPractice(lastPractice.url, lastPractice.title)
    }

    if (lastPractice) {
      return {
        command: {
          type: 'toast',
          title: `上次做过「${lastPractice.title}」，去题库继续`
        }
      }
    }

    return {
      command: {
        type: 'toast',
        title: '还没有练习记录，先去题库开始第一套'
      }
    }
  }

  /**
   * 模拟考试：一键直接开考，不再让用户先去题库选科目。
   *
   * 抽题规则（只此一处，题库页抽屉里用户手动确认的场合不适用）：
   * - 科目：优先「上次练过的那科」，没练过就取题库第一个科目（与题库 tab 默认选中同源）
   * - 题量：抽 MOCK_EXAM_QUESTION_COUNT 道，不够就按整科全量
   * - 时长：每题 1 分钟，向上取整到 5 分钟，保底 MOCK_EXAM_MIN_MINUTES 分钟
   */
  openMock(selectedBankId) {
    const subjectId = this.resolveMockSubjectId()
    const empty = {
      command: {
        type: 'toast',
        title: '当前没有可练习题库'
      }
    }

    if (!subjectId) {
      return empty
    }

    const online = this.repository.isRemoteEnabled && this.repository.isRemoteEnabled()
    const detail = online ? this.repository.getSubjectDetail(subjectId) : null
    const banks = detail ? detail.banks.filter((item) => item.questionCount > 0) : []
    if (online && banks.length > 1 && !selectedBankId) return { command: { type: 'chooseBank', banks, subjectId } }
    const bank = banks.find((item) => item.id === selectedBankId) || banks[0]
    const total = online ? (bank ? bank.questionCount : 0) : this.countSubjectQuestions(subjectId)

    if (!total) {
      return empty
    }

    const count = Math.min(MOCK_EXAM_QUESTION_COUNT, total)
    const duration = resolveMockDuration(count)
    const query = [
      `subjectId=${encodeURIComponent(subjectId)}`,
      online ? `bankId=${encodeURIComponent(bank.id)}` : 'scope=subject',
      'mode=test',
      `count=${encodeURIComponent(count)}`,
      `duration=${encodeURIComponent(duration)}`,
      `seed=${Date.now()}`
    ]

    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/practice/index?${query.join('&')}`,
          title: '正在生成试卷',
          description: `${this.getSubjectName(subjectId)} · ${count} 题 / ${duration} 分钟`
        }
      }
    }
  }

  /** 模拟考试用哪科：上次练过优先，否则题库第一个科目 */
  resolveMockSubjectId() {
    const lastPractice = this.buildLastPractice(this.repository.getProgress(this.storage))
    const meta = lastPractice && lastPractice.scopeKey
      ? this.repository.getScopeMeta(lastPractice.scopeKey)
      : null

    if (meta && meta.subjectId) {
      return meta.subjectId
    }

    const subjects = this.repository.getSubjectSummaries()
    const usable = subjects.find((item) => Number(item.questionCount) > 0)

    return usable ? usable.id : ''
  }

  countSubjectQuestions(subjectId) {
    try {
      const quiz = this.repository.getSubjectQuiz(subjectId)
      return quiz ? Number(quiz.questionCount) || (quiz.questions || []).length : 0
    } catch (error) {
      return 0
    }
  }

  getSubjectName(subjectId) {
    const subjects = this.repository.getSubjectSummaries()
    const subject = subjects.find((item) => item.id === subjectId)

    return subject ? subject.name : '模拟考试'
  }

  // ---------- 公告 ----------

  /**
   * 公告内容就是 home.tip，由 buildHomeContent 按学习状态推导：
   * 有错题 → 催复习；有进度 → 报剩余；全新用户 → 引导上手。
   * 首页不再单独算一份文案，避免弹层与卡片口径不一致。
   */
  openAnnouncement() {
    return {
      data: {
        announcementSheetVisible: true
      }
    }
  }

  closeAnnouncement() {
    return {
      data: {
        announcementSheetVisible: false
      }
    }
  }

  // ---------- 题目搜索 ----------

  openSearch() {
    return {
      data: {
        searchVisible: true
      }
    }
  }

  closeSearch() {
    this.searchText = ''
    this.searchRequestRevision = (this.searchRequestRevision || 0) + 1
    return {
      data: {
        searchVisible: false,
        searchHasMore: false,
        searchLoading: false,
        searchKeyword: '',
        searchResults: [],
        searchSearched: false,
        searchResultCount: 0
      }
    }
  }

  /** 在线按关键词分页检索；本地开发场景复用索引自检。 */
  searchQuestions(keyword) {
    const text = questionSearch.normalizeKeyword(keyword)
    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled()) return this.searchRemote(text, 1)

    if (!text) {
      return {
        data: {
          searchKeyword: '',
          searchResults: [],
          searchSearched: false,
          searchResultCount: 0
        }
      }
    }

    let results = []

    try {
      const index = typeof this.repository.getQuestionIndex === 'function'
        ? this.repository.getQuestionIndex()
        : {}
      results = questionSearch.searchQuestions(index, text)
    } catch (error) {
      results = []
    }

    return {
      data: {
        searchKeyword: text,
        searchResults: results,
        searchSearched: true,
        searchResultCount: results.length
      }
    }
  }

  searchRemote(text, page) {
    const revision = (this.searchRequestRevision || 0) + 1
    this.searchRequestRevision = revision
    if (!text) { this.searchText = ''; this.searchResults = []; this.searchPage = 0; return { data: { searchKeyword: '', searchResults: [], searchLoading: false, searchSearched: false, searchResultCount: 0, searchHasMore: false } } }
    if (page === 1) { this.searchText = text; this.searchResults = [] }
    return this.repository.searchRemoteQuestions(this.storage, text, page).then((result) => {
      if (text !== this.searchText || revision !== this.searchRequestRevision) return null
      this.searchResults = page === 1 ? result.items : this.searchResults.concat(result.items)
      this.searchPage = page
      return { data: { searchKeyword: text, searchResults: this.searchResults, searchLoading: false, searchSearched: true, searchResultCount: result.total, searchHasMore: this.searchResults.length < result.total } }
    })
  }

  loadMoreSearch() { return this.searchRemote(this.searchText, this.searchPage + 1) }

  openSearchResult(questionId) {
    if (!questionId) {
      return null
    }

    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/question-detail/index?id=${encodeURIComponent(questionId)}`,
          title: '正在打开题目',
          description: '读取题目与解析'
        }
      }
    }
  }

  /** 倒计时卡未设置时点进去就是设置页的倒计时分组 */
  openExamSettings() {
    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: '/page/settings/index?focus=exam',
          title: '正在打开设置',
          description: '设置考试倒计时'
        }
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
  STUDY_ENTRIES,
  SubjectListViewModel
}
