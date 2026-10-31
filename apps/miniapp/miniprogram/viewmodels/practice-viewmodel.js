const practiceRepository = require('../repositories/practice-repository.js')
const progressRepository = require('../repositories/progress-repository.js')
const onlinePractice = require('../repositories/online-practice.js')
const trials = require('../repositories/trial-practice.js')
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

  async loadOnline(options) {
    this.trial = false
    this.online = onlinePractice.current()
    this.ownerId = this.online.identity().userId
    this.routeOptions = options || {}
    const snapshot = await this.online.prepare(this.routeOptions)
    this.routeOptions = Object.assign({}, this.routeOptions, snapshot.route || {})
    if (snapshot.waiting) {
      this.waitingId = snapshot.id
      return { data: { waitingForSync: true, waitingSeconds: 0 } }
    }
    this.waitingId = ''
    this.online.activeId = snapshot.id
    const quiz = this.online.quiz(snapshot)
    const restored = this.online.restored(snapshot)
    this.session = new PracticeSession({ quiz, restored, mode: snapshot.feedback === 'AFTER_FINISH' ? 'test' : (options.mode || 'practice'),
      config: snapshot.route, durationMinutes: Number(snapshot.route.duration) || DEFAULT_TEST_DURATION_MINUTES, preferences: this.repository.getPreferences(this.storage),
      favoriteQuestionIds: snapshot.favoriteQuestionIds || [] })
    this.session.reset()
    this.session.restore(restored)
    this.editingLocked = false
    if (restored.status === SESSION_STATUS.SUBMITTED) {
      this.session.finish()
      if (snapshot.result) this.applyOfficialResult(snapshot.result)
      else if (snapshot.status !== 'SUBMITTED') {
        const outcome = await this.resolveSubmitOutcome({ data: this.session.getViewData() })
        return Object.assign({}, outcome, {
          data: Object.assign(this.session.getViewData(), { waitingForSync: false, editingLocked: false, loadError: '' }),
          startTimer: false,
          stopTimer: true
        })
      }
    }
    return { data: Object.assign(this.session.getViewData(), { waitingForSync: false, editingLocked: false, loadError: '' }), startTimer: this.session.state.isTestMode }
  }

  async checkWriter() {
    if (!this.online) return null
    if (this.repository.getAuth(this.storage).userId !== this.ownerId) {
      this.editingLocked = true
      this.session = null
      return { data: PracticeViewModel.getInitialData(), command: { type: 'navigate', url: '/page/login/index' } }
    }
    if (this.session && this.session.state.isCompleted) return null
    const id = this.waitingId || (this.session && this.session.meta.sessionId)
    if (!id) return null
    const writer = await this.online.poll(id)
    if (!writer) return null
    if (this.waitingId) {
      if (writer.state === 'ACTIVE' && writer.writerToken) return this.loadOnline(Object.assign({}, this.routeOptions, { sessionId: id }))
      return null
    }
    if (writer.pendingDeviceId) {
      this.editingLocked = true
      this.persistSession(true)
      if (await this.online.release(id)) return { data: { editingLocked: true }, command: { type: 'returnBankDetail' } }
      return { data: { editingLocked: true, submitError: '正在同步并交接练习，请保持联网' } }
    }
    if (writer.state === 'RELEASED') return this.loadOnline(Object.assign({}, this.routeOptions, { sessionId: id }))
    if (!writer.writerToken) {
      this.editingLocked = true
      return { data: { editingLocked: true, submitError: '此练习已在其他设备继续' } }
    }
    return null
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
    if (onlinePractice.current()) {
      const route = options || {}
      const savedTrial = route.sessionId && trials.get(this.storage, route.sessionId)
      return savedTrial || !this.repository.getAuth(this.storage).loggedIn ? this.loadTrial(route) : this.loadOnline(route)
    }
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

  async loadTrial(options) {
    this.online = null
    this.trial = true
    this.routeOptions = options
    let snapshot
    try { snapshot = await trials.prepare(this.storage, options) } catch (error) {
      if (error.code === 'TRIAL_LIMIT') return { data: { loadError: error.message }, command: { type: 'trialLogin' } }
      throw error
    }
    this.routeOptions = snapshot.route
    const restored = trials.restored(snapshot)
    this.session = new PracticeSession({ quiz: trials.quiz(snapshot), restored, config: snapshot.route, mode: snapshot.route.mode || 'practice', durationMinutes: Number(snapshot.route.duration) || DEFAULT_TEST_DURATION_MINUTES, preferences: this.repository.getPreferences(this.storage) })
    this.session.reset()
    this.session.restore(restored)
    if (restored.status === SESSION_STATUS.SUBMITTED) this.session.finish()
    this.session.updateSyncStatus(SYNC_STATUS.LOCAL_ONLY)
    this.session.state.trialNotice = `游客试答 · 记录保存在本机 · 剩余 ${trials.remaining(this.storage)} 次`
    return { data: Object.assign(this.session.getViewData(), { loadError: '' }), startTimer: this.session.state.isTestMode && !this.session.state.isCompleted }
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

    if (this.online || this.trial) return this.load(Object.assign({}, this.routeOptions, { sessionId: '', resume: '' }))
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

    if (this.online || this.trial) return { command: { type: 'navigate', url: `/page/practice/index?bankId=${encodeURIComponent(this.routeOptions.bankId)}&mode=practice&ids=${encodeURIComponent(ids.join(','))}` } }

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
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.autoSubmit())
  }

  selectOption(selectedIndex) {
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.selectOption(selectedIndex))
  }

  setAnswerText(text) {
    if (!this.session || this.editingLocked) return null
    const result = this.session.setAnswerText(text)
    try { this.persistSession(true) } catch (error) { return Object.assign({}, result, { submitOk: false, submitError: error.message }) }
    return result
  }

  assessShortAnswer(value) {
    if (!this.session || this.editingLocked) return null
    const result = this.session.assessShortAnswer(value)
    try { this.persistSession(true) } catch (error) { return Object.assign({}, result, { submitOk: false, submitError: error.message }) }
    return result
  }

  async assessResult(questionId, value) {
    if (this.trial && this.session && this.session.state.isCompleted) {
      if (!['CORRECT', 'WRONG'].includes(value)) return null
      const index = this.session.state.questions.findIndex(question => question.id === questionId && question.isShortAnswer)
      const answer = this.session.state.answers[index]
      if (!answer) return null
      answer.selfAssessment = value
      answer.isCorrect = value === 'CORRECT'
      this.session.finish()
      this.persistSession(true)
      return { data: this.session.getViewData() }
    }
    if (!this.online || !this.session || !this.session.state.isCompleted) return null
    const snapshot = this.online.get(this.session.meta.sessionId)
    const item = snapshot.items.find(row => row.question.id === questionId)
    if (!item || item.question.type !== 'SHORT_ANSWER') return null
    const result = await this.online.assess(snapshot.id, item.itemId, value)
    require('../repositories/remote-data-repository.js').invalidateLearning()
    this.applyOfficialResult(result)
    return this.session.setResultFilter(this.session.state.resultFilter)
  }

  toggleFavoriteQuestion() {
    if (this.trial) return { command: { type: 'toast', title: '登录后可在正式练习中收藏题目' } }
    if (!this.session) {
      return null
    }

    const result = this.session.toggleFavoriteQuestion()

    if (result && result.saveFavorite) {
      const payload = result.saveFavorite
      const saved = payload.value ? this.repository.addQuestionFavorite(this.storage, payload.id) : this.repository.removeQuestionFavorite(this.storage, payload.id)
      if (saved && saved.then) return saved.then(() => {
        if (this.online) {
          const snapshot = this.online.get(this.session.meta.sessionId)
          snapshot.favoriteQuestionIds = this.session.state.favoriteQuestionIds.slice()
          this.online.put(snapshot.id, snapshot)
        }
        return { data: this.session.getViewData(), value: payload.value }
      }, error => {
        const ids = this.session.state.favoriteQuestionIds.filter(id => id !== payload.id)
        if (!payload.value) ids.push(payload.id)
        const current = this.session.getCurrentBaseQuestion()
        this.session.updateState({ favoriteQuestionIds: ids, isCurrentQuestionFavorite: !!current && ids.indexOf(current.id) >= 0 })
        throw error
      })
    }

    return result
  }

  /** 标记 / 取消标记：纯会话内状态，随 session 落盘，不额外写其它 storage */
  toggleMarkQuestion() {
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.toggleMarkQuestion())
  }

  goNext() {
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.goNext())
  }

  goPrev() {
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.goPrev())
  }

  submit() {
    if (this.editingLocked) return null
    if (!this.session) {
      return null
    }

    return this.withPersistence(this.session.submit())
  }

  forceSubmit() {
    if (this.editingLocked) return null
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
    if (this.editingLocked) return null
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

    if (this.trial) { trials.save(this.storage, this.session); return }
    if (this.session.state.isViewMode) {
      return
    }

    if (this.online) {
      const snapshot = this.online.get(this.session.meta.sessionId)
      if (snapshot && snapshot.status === 'SUBMITTED') return
      this.online.save(this.session)
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
    if (this.online && this.session) {
      this.online.activeId = ''
      if (this.session.state.isCompleted) return Promise.resolve()
      return this.online.flush(this.session.meta.sessionId)
    }
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
  applyOfficialResult(official) {
    const state = this.session.state
    const resultFilter = state.resultFilter
    const items = new Map(official.items.map(item => [item.question.id, item]))
    state.answers = state.questions.map((question, index) => {
      const item = items.get(question.id)
      if (!item) return state.answers[index] || null
      if (!item.answer) return null
      return {
        questionId: question.id,
        selectedKeys: item.answer.optionKeys || (item.answer.value === null || item.answer.value === undefined ? [] : [String(item.answer.value)]),
        text: item.answer.text || '',
        confirmed: item.confirmed,
        selfAssessment: item.selfAssessment || null,
        isCorrect: item.question.type === 'SHORT_ANSWER' ? item.selfAssessment === 'CORRECT' : item.outcome === 'CORRECT'
      }
    })
    state.unansweredCount = this.session.getUnansweredIndexes(state.answers).length
    this.session.finish()
    this.session.state.correctCount = official.objective.correct
    this.session.state.score = official.objective.count ? Math.round(official.objective.accuracy * 100) : 0
    this.session.setResultFilter(resultFilter)
  }

  resolveSubmitOutcome(result) {
    if (this.trial) return this.applySubmitOutcome(result, { ok: true, syncStatus: SYNC_STATUS.LOCAL_ONLY })
    if (this.online) {
      return this.online.finish(this.session).then((official) => {
        require('../repositories/remote-data-repository.js').invalidateLearning()
        this.applyOfficialResult(official)
        return this.applySubmitOutcome(result, { ok: true, syncStatus: SYNC_STATUS.SYNCED })
      }).catch(error => this.applySubmitOutcome(result, { ok: false, syncStatus: SYNC_STATUS.SYNC_PENDING, reason: error.message }))
    }
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
    if (this.trial && this.session) return this.resolveSubmitOutcome({ data: this.session.getViewData() })
    if (this.online && this.session) return this.resolveSubmitOutcome({ data: this.session.getViewData() })
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
    if (this.editingLocked) return { data: { editingLocked: true } }
    // 交卷这一步会走网关，返回 Promise；其余步骤仍是同步结果
    if (result && result.data && result.data.isCompleted) {
      return this.resolveSubmitOutcome(result)
    }

    try { this.persistSession() } catch (error) {
      return Object.assign({}, result, { submitOk: false, submitError: error.message })
    }
    return this.withSideEffects(result)
  }

  withSideEffects(result) {
    if (this.online || this.trial) return result
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

    const preferences = this.repository.getPreferences(this.storage)
    this.session.preferences = preferences
    this.session.state.preferences = preferences
    this.session.state.layoutRanks = require('../utils/practice-layout.js').ranks(preferences.moduleOrder)
    if (this.online && this.session) this.online.activeId = this.session.meta.sessionId
    this.session.resumeStudy()
    return { data: this.session.getViewData() }
  }
}

module.exports = {
  PracticeViewModel
}
