const practiceRepository = require('../repositories/practice-repository.js')
const progressRepository = require('../repositories/progress-repository.js')
const {
  DEFAULT_TEST_DURATION_MINUTES,
  PRACTICE_MODES,
  PracticeSession,
  getInitialPracticeViewData,
  normalizeMode,
  parsePositiveInteger
} = require('../models/practice-session.js')
const { SESSION_STATUS, SYNC_STATUS } = require('../models/practice-session-state.js')

function decodeOptionValue(value) {
  return value ? decodeURIComponent(value) : ''
}

function createNullStorage() {
  return {
    get() {
      return 0
    },

    set() {},

    remove() {}
  }
}

class PracticeViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.session = null
    // 落盘去重用：游标不变就不重复写 storage（多选题连点会触发大量无意义写入）
    this.persistCursor = null
  }

  static getInitialData() {
    return getInitialPracticeViewData()
  }

  /**
   * 载入练习。两条路径：
   * - 恢复：URL 带 sessionId，或带 resume=1，且仓储里确实有一份未提交的会话；
   * - 新建：其余情况。
   *
   * 恢复时题目本体不来自 storage（存的是 id），而是用落盘的 config 重新取卷，
   * 再用 questionIds + questionOrder 还原题序——这样题库更新后也不会读到脏题。
   */
  load(options) {
    const normalizedOptions = options || {}
    const saved = this.readSavedSession(normalizedOptions)
    const effectiveOptions = saved ? this.optionsFromConfig(saved.config) : normalizedOptions
    const mode = normalizeMode(decodeOptionValue(effectiveOptions.mode))
    const quiz = this.getQuizFromOptions(effectiveOptions, mode)
    const isViewMode = mode === PRACTICE_MODES.VIEW
    const durationMinutes = parsePositiveInteger(
      decodeOptionValue(effectiveOptions.duration),
      DEFAULT_TEST_DURATION_MINUTES
    )
    const usableQuiz = quiz || this.repository.getFirstBankQuiz()

    if (saved && usableQuiz) {
      usableQuiz.questions = this.reorderQuestions(
        usableQuiz.questions,
        saved.questionIds,
        saved.questionOrder
      )
    }

    const storageKey = usableQuiz && !isViewMode ? this.getStorageKey(usableQuiz, mode, durationMinutes) : ''
    const bestScore = storageKey ? Number(this.storage.get(storageKey)) || 0 : 0

    this.session = new PracticeSession({
      quiz: usableQuiz,
      mode,
      durationMinutes,
      storageKey,
      bestScore,
      restored: saved,
      config: this.buildSessionConfig(normalizedOptions, mode, durationMinutes),
      // 学习偏好决定解析是否自动展开、答对是否自动翻页、错题是否自动入库
      preferences: this.repository.getPreferences(this.storage),
      favoriteQuestionIds: this.repository.getFavoriteIds(this.repository.getFavorites(this.storage)),
      practicePath: this.getSharePathFromOptions(effectiveOptions, usableQuiz)
    })

    const resetResult = this.session.reset()
    const restoredResult = saved ? this.session.restore(saved) : null
    const baseResult = restoredResult || resetResult

    // 恢复进来的会话立刻再落一次盘：题序可能因题库变动被重排过
    if (saved) {
      this.persistSession(true)
    }

    return {
      data: this.session.getViewData(),
      startTimer: !!baseResult.startTimer,
      stopTimer: true
    }
  }

  /** 读取可恢复的会话。取不到或已提交一律返回 null，走新建路径 */
  readSavedSession(options) {
    const getSaved = this.repository.getResumableSession

    if (typeof getSaved !== 'function') {
      return null
    }

    const rawId = decodeOptionValue(options && options.sessionId)
    const wantsResume = rawId || decodeOptionValue(options && options.resume) === '1'
    const saved = wantsResume ? getSaved(this.storage) : null

    if (!saved) {
      return null
    }

    // 指定了 sessionId 却和仓储里那份对不上，说明是过期链接，不能恢复
    if (rawId && saved.sessionId !== rawId) {
      return null
    }

    return saved
  }

  /** 落盘 config → 取卷参数。config 是恢复一场练习的唯一凭据 */
  optionsFromConfig(config) {
    const normalized = config || {}

    return {
      mode: normalized.mode || '',
      scope: normalized.scope || '',
      subjectId: normalized.subjectId || '',
      bankId: normalized.bankId || '',
      count: normalized.count || '',
      seed: normalized.seed || '',
      duration: normalized.durationMinutes || '',
      ids: normalized.ids || '',
      title: normalized.title || ''
    }
  }

  buildSessionConfig(options, mode, durationMinutes) {
    const routeKeys = ['mode', 'scope', 'subjectId', 'bankId', 'count', 'seed', 'ids', 'title']
    const config = {}
    const normalizedOptions = options || {}

    routeKeys.forEach((key) => {
      const value = decodeOptionValue(normalizedOptions[key])

      if (value) {
        config[key] = value
      }
    })

    config.mode = mode

    if (durationMinutes) {
      config.durationMinutes = durationMinutes
    }

    return config
  }

  /**
   * 按落盘的 questionIds + questionOrder 还原展示顺序。
   * 反查不到的题（题库改动）会被跳过，剩余题目追加到末尾，
   * 保证结果一定是当前卷的一个完整排列——题数不会凭空变化。
   */
  reorderQuestions(questions, questionIds, questionOrder) {
    const safeQuestions = Array.isArray(questions) ? questions : []
    const idToQuestion = {}

    safeQuestions.forEach((question) => {
      if (question && question.id) {
        idToQuestion[question.id] = question
      }
    })

    const ordered = []
    const used = {}

    ;(questionOrder || []).forEach((position) => {
      const id = (questionIds || [])[Number(position)]

      if (!id || used[id]) {
        return
      }

      const question = idToQuestion[id]

      if (!question) {
        return
      }

      ordered.push(question)
      used[id] = true
    })

    safeQuestions.forEach((question) => {
      if (question && question.id && !used[question.id]) {
        ordered.push(question)
        used[question.id] = true
      }
    })

    return ordered
  }

  reset() {
    if (!this.session) {
      return null
    }

    const result = this.session.reset()

    // 「再练一次」是一轮新练习，立即覆盖掉上一份会话
    this.persistSession(true)

    return result
  }

  getShareMessage() {
    if (!this.session) {
      return {
        title: 'QandA 练习',
        path: '/page/practice/index'
      }
    }

    return this.session.getShareMessage()
  }

  /**
   * 「重练错题」：把错题 id 存为自定义练习卷，交给答题页按 scope=custom 载入。
   */
  setResultFilter(filter) {
    if (!this.session) {
      return null
    }

    return this.session.setResultFilter(filter)
  }

  setResultKeyword(keyword) {
    if (!this.session) {
      return null
    }

    return this.session.setResultKeyword(keyword)
  }

  /** 打开题目详情：带上 sessionId，详情页才能同时显示「你的答案」 */
  createQuestionDetailCommand(questionId) {
    if (!questionId) {
      return null
    }

    const sessionId = this.session ? this.session.meta.sessionId : ''
    const query = [`id=${encodeURIComponent(questionId)}`]

    if (sessionId) {
      query.push(`sessionId=${encodeURIComponent(sessionId)}`)
    }

    return {
      command: {
        type: 'navigate',
        url: `/page/question-detail/index?${query.join('&')}`
      }
    }
  }

  createRedoWrongCommand(questionIds) {
    const ids = (questionIds || []).filter(Boolean)

    if (!ids.length) {
      return null
    }

    this.repository.saveCustomQuiz(this.storage, ids, '错题重练')

    return {
      command: {
        type: 'navigate',
        url: `/page/practice/index?scope=custom&mode=practice&seed=${Date.now()}`
      }
    }
  }

  updateTimer(timerSeconds) {
    if (!this.session) {
      return null
    }

    return this.session.updateTimer(timerSeconds)
  }

  autoSubmit() {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.autoSubmit())
  }

  selectOption(selectedIndex) {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.selectOption(selectedIndex))
  }

  toggleFavoriteQuestion() {
    if (!this.session) {
      return null
    }

    const result = this.session.toggleFavoriteQuestion()

    if (result && result.saveFavorite) {
      const payload = result.saveFavorite

      if (payload.value) {
        this.repository.addQuestionFavorite(this.storage, payload.id)
      } else {
        this.repository.removeQuestionFavorite(this.storage, payload.id)
      }
    }

    return result
  }

  goNext() {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.goNext())
  }

  goPrev() {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.goPrev())
  }

  submit() {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.submit())
  }

  forceSubmit() {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.forceSubmit())
  }

  closeSubmitModal() {
    if (!this.session) {
      return null
    }

    return this.session.closeSubmitModal()
  }

  openQuestionOverview() {
    if (!this.session) {
      return null
    }

    return this.session.openQuestionOverview()
  }

  closeQuestionOverview() {
    if (!this.session) {
      return null
    }

    return this.session.closeQuestionOverview()
  }

  jumpToQuestion(index) {
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.jumpToQuestion(index))
  }

  getQuizFromOptions(options, mode) {
    const subjectId = decodeOptionValue(options && options.subjectId)
    const bankId = decodeOptionValue(options && options.bankId)
    const scope = decodeOptionValue(options && options.scope)

    if (scope === 'subject') {
      // 顺序练习与背题模式保持题库原顺序，随机练习与模拟测试打散
      const shuffle = mode === PRACTICE_MODES.PRACTICE || mode === PRACTICE_MODES.TEST

      return this.repository.getSubjectDrawQuiz(
        subjectId,
        decodeOptionValue(options && options.count),
        decodeOptionValue(options && options.seed),
        { shuffle }
      ) || this.repository.getFirstBankQuiz()
    }

    // 错题重练 / 收藏练习：题目 id 列表来自本地存储或 URL
    if (scope === 'custom' || decodeOptionValue(options && options.ids)) {
      return this.getCustomQuizFromOptions(options)
    }

    const seed = decodeOptionValue(options && options.seed)
    // 顺序练习与背题模式保持原顺序，随机练习与模拟测试打散
    const shouldShuffle = mode === PRACTICE_MODES.PRACTICE || mode === PRACTICE_MODES.TEST
    const bankOptions = shouldShuffle ? {
      shuffle: true,
      seed: seed || Date.now()
    } : null

    return this.repository.getBankQuiz(subjectId, bankId, bankOptions) ||
      this.repository.getFirstBankQuiz()
  }

  /**
   * 自定义练习卷：优先取 URL 上的 ids，其次取本地存储中的最近一份。
   */
  getCustomQuizFromOptions(options) {
    const rawIds = decodeOptionValue(options && options.ids)
    let customQuiz = this.repository.getCustomQuiz(this.storage)

    if (rawIds) {
      customQuiz = this.repository.saveCustomQuiz(
        this.storage,
        rawIds.split(',').filter(Boolean),
        decodeOptionValue(options && options.title)
      )
    }

    if (!customQuiz.ids.length) {
      return null
    }

    return this.repository.getQuizByIds(customQuiz.ids, customQuiz.title)
  }

  getStorageKey(quiz, mode, durationMinutes) {
    if (!quiz || !quiz.storageKey) {
      return ''
    }

    if (mode === PRACTICE_MODES.TEST) {
      return `${quiz.storageKey}:test:${durationMinutes}`
    }

    return quiz.storageKey
  }

  getSharePathFromOptions(options, quiz) {
    const routeKeys = ['mode', 'scope', 'subjectId', 'bankId', 'count', 'seed', 'duration']
    const query = routeKeys.reduce((items, key) => {
      if (options && options[key]) {
        items.push(`${key}=${encodeURIComponent(decodeOptionValue(options[key]))}`)
      }

      return items
    }, [])

    if (query.length) {
      return `/page/practice/index?${query.join('&')}`
    }

    return quiz ? quiz.sharePath : '/page/practice/index'
  }

  /**
   * 会话落盘。背题模式不产生会话；游标未变则跳过写入。
   *
   * 游标取「当前位置 + 已答数 + 业务状态 + 同步状态」四项：
   * 多选题反复勾选时 selectedKeys 在变但答案没提交，游标不动，因此不会每次点都写 storage。
   */
  persistSession(force) {
    if (!this.session || typeof this.repository.saveSession !== 'function') {
      return
    }

    if (this.session.state.isViewMode) {
      return
    }

    const state = this.session.getPersistedState()
    const cursor = [
      state.currentIndex,
      state.answers.filter(Boolean).length,
      state.status,
      state.syncStatus
    ].join(':')

    if (!force && cursor === this.persistCursor) {
      return
    }

    this.persistCursor = cursor
    this.repository.saveSession(this.storage, state)
  }

  /** 页面退出（onHide / onUnload）时强制落盘，防止最后一步操作丢 */
  saveSessionNow() {
    this.persistSession(true)
  }

  /**
   * 交卷后走一次网关提交。
   *
   * 失败**不清 Session**：本地结果已经算出来了，只是没同步上去，
   * 此时把状态标成 SYNC_PENDING 并给出重试入口（PRD 4.6）。
   *
   * 返回 Promise：Gateway 是 Mock ⇄ HTTP 的统一边界，真实 HTTP 必然异步，
   * 这里统一成 Promise，联调时调用方一行都不用改（PRD 12）。
   * 同步网关（Mock 的 latencyMs=0）只是被包了一层微任务，用户无感知。
   */
  resolveSubmitOutcome(result) {
    const submit = this.repository.submitSession
    const outcome = typeof submit === 'function'
      ? submit(this.storage, {
        sessionId: this.session.meta.sessionId,
        answers: this.session.state.answers,
        score: this.session.state.score,
        questionIds: this.session.state.questions.map((question) => question.id),
        elapsedTime: this.session.getElapsedSeconds()
      })
      : { ok: true, syncStatus: SYNC_STATUS.SYNCED, reason: '' }

    // 本地 Mock 走同步快路径；真实 HTTP / 慢网络是 Promise，走 then 分支
    if (outcome && typeof outcome.then === 'function') {
      return outcome.then((resolved) => this.applySubmitOutcome(result, resolved))
    }

    return this.applySubmitOutcome(result, outcome)
  }

  /** 提交结果落库：状态、落盘、副作用都在这一处，同步与异步两条路径共用 */
  applySubmitOutcome(result, outcome) {
    const safe = outcome || {}
    const statusResult = this.session.updateSyncStatus(safe.syncStatus || SYNC_STATUS.SYNCED)
    const merged = Object.assign({}, result, {
      data: statusResult.data,
      submitOk: safe.ok !== false,
      submitError: safe.ok === false ? safe.reason || '提交失败，请重试' : ''
    })

    this.persistSession(true)

    return this.withSideEffects(merged)
  }

  /**
   * 重试提交。
   * 先把场景切回 normal 再提交——MVP 没有真实网络，
   * 「重试成功」只能这样模拟，等价于网络恢复后重发一次。
   */
  retrySubmit() {
    if (!this.session || typeof this.repository.retrySubmit !== 'function') {
      return null
    }

    if (typeof this.repository.setMockScenario === 'function') {
      this.repository.setMockScenario(this.storage, 'normal')
    }

    const outcome = this.repository.retrySubmit(this.storage, {
      sessionId: this.session.meta.sessionId,
      answers: this.session.state.answers,
      score: this.session.state.score,
      questionIds: this.session.state.questions.map((question) => question.id),
      elapsedTime: this.session.getElapsedSeconds()
    })

    if (outcome && typeof outcome.then === 'function') {
      return outcome.then((resolved) => this.applyRetryOutcome(resolved))
    }

    return this.applyRetryOutcome(outcome)
  }

  applyRetryOutcome(outcome) {
    const safe = outcome || {}
    const statusResult = this.session.updateSyncStatus(safe.syncStatus || SYNC_STATUS.SYNCED)

    this.persistSession(true)

    return Object.assign({}, statusResult, {
      submitOk: safe.ok !== false,
      submitError: safe.ok === false ? safe.reason || '提交失败，请重试' : ''
    })
  }

  withPersistence(result) {
    // 交卷这一步会走网关，返回 Promise；其余步骤仍是同步结果
    if (result && result.data && result.data.isCompleted) {
      return this.resolveSubmitOutcome(result)
    }

    this.persistSession()

    return this.withSideEffects(result)
  }

  withSideEffects(result) {
    if (result && result.saveBestScore) {
      this.storage.set(result.saveBestScore.key, result.saveBestScore.value)
    }

    if (result && result.saveScopeProgress) {
      const payload = result.saveScopeProgress

      this.repository.saveScopeProgress(
        this.storage,
        payload.scopeKey,
        payload.records,
        payload.total
      )
    }

    if (result && result.saveWrongResults) {
      this.repository.saveWrongResults(this.storage, result.saveWrongResults.records)
    }

    if (result && result.saveStudyTime) {
      this.repository.addStudyTime(this.storage, result.saveStudyTime.seconds)
    }

    if (result && result.saveDailyLog) {
      this.repository.addDailyLog(this.storage, result.saveDailyLog)
    }

    return result
  }

  /** 页面切到后台：暂停学习时长计时 */
  pauseStudy() {
    if (!this.session) {
      return null
    }

    return this.session.pauseStudy()
  }

  /** 页面回到前台：恢复学习时长计时 */
  resumeStudy() {
    if (!this.session) {
      return null
    }

    return this.session.resumeStudy()
  }
}

module.exports = {
  PracticeViewModel
}
