/**
 * 题库页 ViewModel。
 *
 * 2026-10-27 按设计稿改版，页面结构从「科目栏 + 参数按钮堆」改成
 * 「页内标题 + 搜索 / 筛选 + 科目栏 + 章节列表 + 答题配置抽屉」：
 *
 *   1. 参数不再常驻页面，全部收进抽屉（模式 / 顺序 / 限时 / 只答错题）；
 *   2. 列表一行一章（灰条），点一行 = 配这一章的答题参数；
 *   3. 左栏首项「最近在刷」是快捷入口：跳到上次练习的科目，不另存数据。
 *
 * ⚠️ 抽屉里的开关都是**本次答题**的参数，不写学习偏好。
 *    偏好（解析自动展开 / 答对自动翻页）只在「我的」页维护，两处能改同一状态必出 bug。
 */

const practiceRepository = require('../repositories/practice-repository.js')
const {
  summarizeBankProgress,
  summarizeSubjectProgress
} = require('../utils/practice-progress.js')
const { getPendingIds } = require('../utils/wrong-book.js')

const CN_NUMBERS = [
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'
]

const MAX_KEYWORD_LENGTH = 20
const DEFAULT_DURATION_MINUTES = 10

// 模式只保留三种语义：练习（即时给反馈）/ 模拟考（交卷才判）/ 背题（先看答案）
const MODE_OPTIONS = [
  { value: 'practice', label: '练习' },
  { value: 'test', label: '模拟考' },
  { value: 'view', label: '背题' }
]

const ORDER_OPTIONS = [
  { value: 'order', label: '顺序' },
  { value: 'random', label: '随机' }
]

const DURATION_OPTIONS = [5, 10, 15, 20].map((value) => ({
  value,
  label: `${value} 分钟`
}))

const DEFAULT_SHEET = {
  mode: 'practice',
  order: 'order',
  timed: false,
  duration: DEFAULT_DURATION_MINUTES,
  onlyWrong: false
}

function getInitialBankDetailViewData() {
  return {
    subjectId: '',
    subject: null,
    subjects: [],
    stats: null,

    // 左栏：'recent' = 最近在刷，'subject' = 某个科目
    railMode: 'subject',
    recentSubjectId: '',
    recentSubjectName: '',

    // 右栏章节列表（按当前面板的科目）
    rows: [],
    hiddenRowCount: 0,
    listEmptyText: '这个科目还没有章节',

    // 搜索
    searchKeyword: '',
    searchActive: false,
    searchResults: [],
    searchEmptyText: '',

    // 筛选：只看没刷完的章节
    filterUnfinished: false,
    filterEnabled: false,

    // 答题配置抽屉
    configSheetVisible: false,
    configTitle: '答题配置',
    configSubtitle: '',
    configTargetName: '',
    sheetMode: DEFAULT_SHEET.mode,
    sheetOrder: DEFAULT_SHEET.order,
    sheetTimed: DEFAULT_SHEET.timed,
    sheetDuration: DEFAULT_SHEET.duration,
    sheetOnlyWrong: DEFAULT_SHEET.onlyWrong,
    sheetWrongCount: 0,
    sheetOrderDisabled: false,
    modeOptions: MODE_OPTIONS,
    orderOptions: ORDER_OPTIONS,
    durationOptions: DURATION_OPTIONS,
    sheetStartText: '开始答题',

    // 兼容旧字段：答题页跳转仍按 mode / 时长参数拼链接
    mode: 'order',
    isViewMode: false,
    selectedDuration: DEFAULT_DURATION_MINUTES,

    routeLoadingVisible: false,
    routeLoadingTitle: '正在开始练习',
    routeLoadingDescription: ''
  }
}

function resolveModeValue(value) {
  const matched = MODE_OPTIONS.find((option) => option.value === value)

  return matched ? matched.value : DEFAULT_SHEET.mode
}

function resolveOrderValue(value) {
  const matched = ORDER_OPTIONS.find((option) => option.value === value)

  return matched ? matched.value : DEFAULT_SHEET.order
}

function chapterTitle(index, name) {
  const text = String(name === undefined || name === null ? '' : name).trim()

  // 有些题库名本身就带序号（「第一单元」），再套一层就成了「第一章：第一单元」
  if (/^第[一二三四五六七八九十百\d]+[章单元节讲]/.test(text)) {
    return text
  }

  const cn = CN_NUMBERS[index] || String(index + 1)
  return `第${cn}章：${text}`
}

function chapterMetaText(stats, hasProgress) {
  if (!stats) {
    return ''
  }

  return hasProgress ? `${stats.answered}/${stats.total}` : stats.totalText
}

class BankDetailViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || null

    this.railMode = 'subject'
    this.filterUnfinished = false
    this.sheet = Object.assign({}, DEFAULT_SHEET)
    this.sheetTarget = null
    // 搜索索引：全部科目的章节，一次建好复用（题库是本地数据，30 来条）
    this.bankIndex = null
  }

  refreshRemote(subjectId) {
    if (!this.repository.isRemoteEnabled || !this.repository.isRemoteEnabled()) return Promise.resolve(null)
    return this.repository.refreshRemote(this.storage, 'all').then(() => this.sheetTarget ? null : this.load(this.currentSubjectId || subjectId)).catch((error) => ({ command: { type: 'toast', title: error.message } }))
  }

  static getInitialData() {
    return getInitialBankDetailViewData()
  }

  load(subjectId) {
    const subjects = this.repository.getSubjectSummaries()
    const firstSubjectId = subjects.length ? subjects[0].id : ''
    // 题库是 tabBar 页面，参数失效时不能靠「返回」兜底，
    // 因此回落到第一个科目，避免停在一个空工作台。
    const detail = this.repository.getSubjectDetail(subjectId || firstSubjectId) ||
      this.repository.getSubjectDetail(firstSubjectId)

    if (!detail) {
      return {
        command: {
          type: 'toast',
          title: '题库数据暂不可用'
        }
      }
    }

    this.railMode = 'subject'
    this.sheet = Object.assign({}, DEFAULT_SHEET)
    this.sheetTarget = null

    return {
      data: this.buildViewData(subjects, detail)
    }
  }

  switchSubject(subjectId) {
    const detail = this.repository.getSubjectDetail(subjectId)

    if (!detail) {
      return null
    }

    this.railMode = 'subject'

    return {
      data: this.buildViewData(this.repository.getSubjectSummaries(), detail)
    }
  }

  /**
   * 「最近在刷」：跳到上次练习的科目。
   *
   * 不额外存「最近浏览」，只认真实练习记录（进度表里 updatedAt 最新的那条），
   * 这样它不会变成一个点了没反应、或者和真实学习状态不符的假入口。
   */
  enterRecent() {
    const subjects = this.repository.getSubjectSummaries()
    const recent = this.resolveRecentSubject(subjects)
    const detail = this.repository.getSubjectDetail(recent ? recent.subjectId : '') ||
      this.repository.getSubjectDetail(subjects.length ? subjects[0].id : '')

    if (!detail) {
      return null
    }

    this.railMode = 'recent'

    return {
      data: this.buildViewData(subjects, detail)
    }
  }

  /** 回到当前所在面板（不切换 rail 语义），页面 onShow 刷新用 */
  refresh(state) {
    const current = state || {}

    if (current.railMode === 'recent') {
      return this.enterRecent()
    }

    return this.switchSubject(current.subjectId) || this.load(current.subjectId)
  }

  resolveRecentSubject(subjects) {
    const progress = this.safeProgress()
    const entries = Object.keys(progress)
      .map((key) => ({ key, at: Number(progress[key] && progress[key].updatedAt) || 0 }))
      .filter((entry) => entry.at > 0)
      .sort((left, right) => right.at - left.at)

    for (let i = 0; i < entries.length; i += 1) {
      const scopeKey = entries[i].key
      const matched = subjects.find((subject) => {
        if (subject.id === scopeKey) {
          return true
        }

        const detail = this.repository.getSubjectDetail(subject.id)
        return !!detail && (detail.banks || []).some((bank) => bank.id === scopeKey)
      })

      if (matched) {
        return { subjectId: matched.id, scopeKey }
      }
    }

    return null
  }

  safeProgress() {
    try {
      return this.repository.getProgress(this.storage) || {}
    } catch (error) {
      return {}
    }
  }

  /**
   * 组装左栏、统计卡、章节列表。
   */
  buildViewData(subjects, detail) {
    this.currentSubjectId = detail.id
    const progress = this.safeProgress()
    const subjectStats = summarizeSubjectProgress(progress, detail)
    const allRows = (detail.banks || []).map((bank, index) => {
      const bankStats = summarizeBankProgress(progress, bank)
      const hasProgress = !!bankStats && bankStats.hasProgress

      return {
        bankId: bank.id,
        subjectId: detail.id,
        index,
        title: chapterTitle(index, bank.name),
        unitText: bank.unitText || `单元 ${index + 1}`,
        metaText: chapterMetaText(bankStats, hasProgress),
        questionCount: bank.questionCount || 0,
        answered: bankStats ? bankStats.answered : 0,
        progressPercent: bankStats ? bankStats.progressPercent : 0,
        hasProgress,
        isComplete: !!bankStats && bankStats.progressPercent >= 100
      }
    })
    const rows = this.filterRows(allRows)
    const recent = this.resolveRecentSubject(subjects)

    // 筛选切换只重算列表，不重新取卷：统计卡与左栏都不受影响
    this.allRows = allRows
    this.bankIndex = this.buildBankIndex(subjects)

    return Object.assign({
      subjectId: detail.id,
      subject: this.buildSubjectView(detail),
      stats: subjectStats,
      subjects: subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        theme: subject.theme,
        active: this.railMode === 'subject' && subject.id === detail.id,
        recentActive: this.railMode === 'recent'
      })),
      railMode: this.railMode,
      recentSubjectId: recent ? recent.subjectId : '',
      recentSubjectName: recent ? this.subjectNameOf(subjects, recent.subjectId) : '',
      rows,
      hiddenRowCount: allRows.length - rows.length,
      listEmptyText: this.resolveListEmptyText(allRows.length, rows.length),
      filterEnabled: allRows.length > 0,
      // 搜索面板与抽屉由用户操作驱动，重新加载时一律回到关闭态
      searchKeyword: '',
      searchActive: false,
      searchResults: [],
      searchEmptyText: '',
      configSheetVisible: false
    }, this.buildSheetData())
  }

  /**
   * 筛选只影响「列表显示」，不影响统计卡 —— 统计永远按整科算，
   * 否则打开筛选后数字会变，看起来像进度丢了。
   */
  filterRows(allRows) {
    const rows = Array.isArray(allRows) ? allRows : []

    if (!this.filterUnfinished) {
      return rows
    }

    return rows.filter((row) => !row.isComplete)
  }

  resolveListEmptyText(totalCount, visibleCount) {
    if (!totalCount) {
      return '这个科目还没有章节'
    }

    if (!visibleCount && this.filterUnfinished) {
      return '所有章节都刷完了，关掉筛选看看'
    }

    return '没有符合条件的章节'
  }

  buildSubjectView(detail) {
    return {
      id: detail.id,
      name: detail.name,
      theme: detail.theme,
      description: detail.description,
      bankCount: detail.bankCount,
      questionCount: detail.questionCount
    }
  }

  subjectNameOf(subjects, subjectId) {
    const matched = (subjects || []).find((subject) => subject.id === subjectId)
    return matched ? matched.name : ''
  }

  /** 搜索索引：跨科目搜章节名 / 科目名，命中后能直接跳到那一章 */
  buildBankIndex(subjects) {
    const index = []

    ;(subjects || []).forEach((subject) => {
      const detail = this.repository.getSubjectDetail(subject.id)

      if (!detail) {
        return
      }

      ;(detail.banks || []).forEach((bank, position) => {
        index.push({
          bankId: bank.id,
          subjectId: detail.id,
          subjectName: detail.name,
          title: bank.name,
          chapterTitle: chapterTitle(position, bank.name),
          metaText: bank.questionText || `${bank.questionCount} 题`,
          progressPercent: bank.progressPercent || 0
        })
      })
    })

    return index
  }

  updateSearch(keyword) {
    const text = String(keyword === undefined || keyword === null ? '' : keyword)
      .trim()
      .slice(0, MAX_KEYWORD_LENGTH)

    if (!text) {
      return {
        data: {
          searchKeyword: '',
          searchActive: false,
          searchResults: [],
          searchEmptyText: ''
        }
      }
    }

    const pool = Array.isArray(this.bankIndex) ? this.bankIndex : []
    const lower = text.toLowerCase()
    const results = pool
      .filter((item) => {
        const haystack = `${item.subjectName}${item.title}${item.chapterTitle}`.toLowerCase()
        return haystack.indexOf(lower) >= 0
      })
      .slice(0, 12)
      .map((item) => ({
        bankId: item.bankId,
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        title: item.title,
        chapterTitle: item.chapterTitle,
        metaText: item.metaText
      }))

    return {
      data: {
        searchKeyword: text,
        searchActive: true,
        searchResults: results,
        searchEmptyText: results.length ? '' : `没有匹配「${text}」的章节`
      }
    }
  }

  clearSearch() {
    return this.updateSearch('')
  }

  toggleFilter() {
    this.filterUnfinished = !this.filterUnfinished

    const allRows = Array.isArray(this.allRows) ? this.allRows : []
    const rows = this.filterRows(allRows)

    return {
      data: {
        filterUnfinished: this.filterUnfinished,
        rows,
        hiddenRowCount: allRows.length - rows.length,
        listEmptyText: this.resolveListEmptyText(allRows.length, rows.length)
      }
    }
  }

  /**
   * 打开答题配置抽屉。
   *
   * @param {object} target { type: 'bank' | 'subject', bankId?, subjectId? }
   */
  openConfig(target) {
    const normalized = target || {}
    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled() && normalized.type !== 'bank') {
      const subject = this.repository.getSubjectDetail(normalized.subjectId)
      if (subject && subject.banks.length === 1) return this.openConfig({ type: 'bank', subjectId: subject.id, bankId: subject.banks[0].id })
      return { command: { type: 'chooseBank', subjectId: normalized.subjectId, banks: subject ? subject.banks.filter((bank) => bank.questionCount > 0) : [] } }
    }
    const detail = this.repository.getSubjectDetail(normalized.subjectId)
    const sheet = Object.assign({}, DEFAULT_SHEET)

    if (!detail) {
      return null
    }

    if (normalized.type === 'bank') {
      const bank = (detail.banks || []).find((item) => item.id === normalized.bankId)

      if (!bank) {
        return null
      }

      this.sheetTarget = {
        type: 'bank',
        subjectId: detail.id,
        bankId: bank.id,
        name: bank.name,
        title: chapterTitle((detail.banks || []).indexOf(bank), bank.name),
        questionCount: bank.questionCount || 0
      }
    } else {
      this.sheetTarget = {
        type: 'subject',
        subjectId: detail.id,
        bankId: '',
        name: detail.name,
        title: detail.name,
        questionCount: detail.questionCount || 0
      }
    }

    this.sheet = sheet

    return this.buildConfigOpenResult()
  }

  openBankConfig(subjectId, bankId) {
    return this.openConfig({ type: 'bank', subjectId, bankId })
  }

  openSubjectConfig(subjectId) {
    return this.openConfig({ type: 'subject', subjectId })
  }

  buildConfigOpenResult() {
    const subjects = this.repository.getSubjectSummaries()
    const detail = this.repository.getSubjectDetail(this.sheetTarget.subjectId)

    this.railMode = 'subject'

    return {
      data: Object.assign(this.buildViewData(subjects, detail), this.buildSheetData(), {
        configSheetVisible: true,
        searchKeyword: '',
        searchActive: false,
        searchResults: []
      })
    }
  }

  closeConfig() {
    this.sheetTarget = null
    this.sheet = Object.assign({}, DEFAULT_SHEET)

    return {
      data: {
        configSheetVisible: false
      }
    }
  }

  setSheetMode(mode) {
    this.sheet.mode = resolveModeValue(mode)
    this.sheet.timed = this.sheet.mode === 'test' ? true : this.sheet.timed

    return {
      data: this.buildSheetData()
    }
  }

  setSheetOrder(order) {
    this.sheet.order = resolveOrderValue(order)

    return {
      data: this.buildSheetData()
    }
  }

  setSheetTimed(timed) {
    this.sheet.timed = !!timed
    this.sheet.duration = this.sheet.duration || DEFAULT_DURATION_MINUTES

    return {
      data: this.buildSheetData()
    }
  }

  selectDuration(value) {
    const duration = Number(value)

    if (!Number.isFinite(duration) || duration <= 0) {
      return null
    }

    this.sheet.duration = duration

    return {
      data: this.buildSheetData()
    }
  }

  setSheetOnlyWrong(onlyWrong) {
    const target = this.sheetTarget
    const wrongCount = target ? this.collectWrongIds(target).length : 0

    if (onlyWrong && !wrongCount) {
      // 这一章没有错题：开关不生效，用 toast 说清楚，避免点了没反应
      return {
        data: Object.assign(this.buildSheetData(), { sheetOnlyWrong: false }),
        command: {
          type: 'toast',
          title: '这一章还没有错题'
        }
      }
    }

    this.sheet.onlyWrong = !!onlyWrong

    return {
      data: this.buildSheetData()
    }
  }

  buildSheetData() {
    const target = this.sheetTarget
    const wrongCount = target ? this.collectWrongIds(target).length : 0
    const isView = this.sheet.mode === 'view'
    const startText = this.sheet.mode === 'test'
      ? '开始测试'
      : (isView ? '开始背题' : '开始答题')

    return {
      configTitle: '答题配置',
      configSubtitle: target ? `${target.title} · ${target.questionCount} 题` : '',
      configTargetName: target ? target.name : '',
      sheetMode: this.sheet.mode,
      sheetOrder: this.sheet.order,
      sheetTimed: this.sheet.timed,
      sheetDuration: this.sheet.duration,
      sheetOnlyWrong: this.sheet.onlyWrong,
      sheetWrongCount: wrongCount,
      // 背题模式固定按原顺序看，顺序/随机没有意义
      sheetOrderDisabled: isView,
      modeOptions: MODE_OPTIONS,
      orderOptions: ORDER_OPTIONS,
      durationOptions: DURATION_OPTIONS,
      sheetStartText: startText,
      // 旧字段映射：页面按钮文案与存量调用还认这两个
      mode: this.resolveRouteMode(),
      isViewMode: isView,
      selectedDuration: this.sheet.timed ? this.sheet.duration : 0
    }
  }

  /** 抽屉参数 → 答题页的 mode 参数 */
  resolveRouteMode() {
    if (this.sheet.mode === 'view') {
      return 'view'
    }

    if (this.sheet.mode === 'test') {
      return 'test'
    }

    return this.sheet.order === 'random' ? 'practice' : 'order'
  }

  /**
   * 这一章（或整科）的错题 id。
   *
   * 错题本按题目 id 记账，而题目 id 和题库 id 不同前缀（q-cc-ch001-homework-001
   * 对 chinese-ch001），所以只能取卷后按集合求交，不能靠字符串前缀。
   */
  collectWrongIds(target) {
    if (!target) {
      return []
    }

    try {
      const wrongBook = typeof this.repository.getWrongBook === 'function'
        ? this.repository.getWrongBook(this.storage)
        : null
      const pending = getPendingIds(wrongBook)

      if (!pending.length) {
        return []
      }

      const quiz = target.type === 'bank'
        ? this.repository.getBankQuiz(target.subjectId, target.bankId)
        : this.repository.getSubjectQuiz(target.subjectId)
      const ids = ((quiz && quiz.questions) || []).map((question) => question.id)
      const pendingSet = {}

      pending.forEach((id) => {
        pendingSet[id] = true
      })

      return ids.filter((id) => pendingSet[id])
    } catch (error) {
      return []
    }
  }

  /**
   * 「开始答题」：按抽屉里的参数拼跳转链接。
   *
   * scope 的优先级容易踩坑：答题页先判断 scope === 'subject'，再判断 ids，
   * 所以「整科 + 只答错题」必须传 ids 且**不能**带 scope=subject，否则错题筛选被忽略。
   */
  confirmConfig(currentState) {
    const state = currentState || {}
    const target = this.sheetTarget || {
      type: 'subject',
      subjectId: state.subjectId || '',
      bankId: '',
      name: '',
      title: '',
      questionCount: (state.stats && state.stats.total) || 0
    }
    const wrongIds = this.sheet.onlyWrong ? this.collectWrongIds(target) : []
    const routeMode = this.resolveRouteMode()
    const query = []

    if (target.type === 'bank') {
      query.push(`subjectId=${encodeURIComponent(target.subjectId)}`)
      query.push(`bankId=${encodeURIComponent(target.bankId)}`)
    } else if (!wrongIds.length) {
      query.push(`subjectId=${encodeURIComponent(target.subjectId)}`)
      query.push('scope=subject')
    }

    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled() && this.sheet.onlyWrong) query.push('selectionKind=WRONG')

    if (wrongIds.length) {
      query.push(`ids=${encodeURIComponent(wrongIds.join(','))}`)
      query.push(`title=${encodeURIComponent(target.title || target.name || '错题重练')}`)
    }

    query.push(`mode=${encodeURIComponent(routeMode)}`)

    if (this.sheet.timed && routeMode !== 'view') {
      query.push(`duration=${encodeURIComponent(this.sheet.duration)}`)
    }

    query.push(`seed=${Date.now()}`)

    const count = wrongIds.length || target.questionCount || 0

    return {
      data: {
        configSheetVisible: false
      },
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/practice/index?${query.join('&')}`,
          title: routeMode === 'test' ? '正在生成试卷' : (routeMode === 'view' ? '正在打开题目' : '正在开始练习'),
          description: this.sheet.timed && routeMode !== 'view'
            ? `${count} 题 / ${this.sheet.duration} 分钟`
            : `${count} 题 · ${target.title || target.name || '全部题目'}`
        }
      }
    }
  }

  getShareMessage(subjectId) {
    const subject = this.repository.getSubjectDetail(subjectId)

    return {
      title: subject ? `QandA · ${subject.name}` : 'QandA 题库',
      // 题库是 tabBar 页面，分享路径不能携带参数，进入后落在默认科目
      path: '/page/bank-detail/index'
    }
  }
}

module.exports = {
  BankDetailViewModel,
  DEFAULT_DURATION_MINUTES,
  MODE_OPTIONS,
  ORDER_OPTIONS
}
