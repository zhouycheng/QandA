const { buildAnswerRecords } = require('../utils/practice-progress.js')
const { normalizePreferences } = require('../utils/preferences.js')
const {
  QUESTION_STATE,
  SESSION_STATUS,
  SYNC_STATUS,
  createSessionId,
  deriveQuestionStates
} = require('./practice-session-state.js')

const DEFAULT_PRACTICE_TITLE = '题库练习'
const DEFAULT_TEST_DURATION_MINUTES = 10
const PRACTICE_MODES = {
  ORDER: 'order',
  PRACTICE: 'practice',
  VIEW: 'view',
  TEST: 'test'
}

/** 结果复盘的筛选项（PRD 4.7） */
const RESULT_FILTERS = {
  ALL: 'all',
  CORRECT: 'correct',
  WRONG: 'wrong',
  UNANSWERED: 'unanswered'
}

const RESULT_FILTER_TEXT = {
  all: '全部',
  correct: '正确',
  wrong: '错误',
  unanswered: '未答'
}

function normalizeMode(value) {
  if (
    value === PRACTICE_MODES.VIEW ||
    value === PRACTICE_MODES.TEST ||
    value === PRACTICE_MODES.ORDER
  ) {
    return value
  }

  return PRACTICE_MODES.PRACTICE
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(Number(totalSeconds) || 0, 0)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  const secondText = seconds < 10 ? `0${seconds}` : `${seconds}`

  return `${minutes}:${secondText}`
}

function getInitialPracticeViewData() {
  const durationSeconds = DEFAULT_TEST_DURATION_MINUTES * 60

  return {
    mode: PRACTICE_MODES.PRACTICE,
    // 初始即给一份默认偏好：页面首帧就要读 preferences.showOverviewEntry / fontSize，
    // 缺了会让答题卡入口闪一下、字号也来不及生效
    preferences: normalizePreferences(null),
    // 会话状态（PRD 9）：页面用它判断"是否可恢复""是否待重传"
    sessionId: '',
    sessionStatus: SESSION_STATUS.IN_PROGRESS,
    syncStatus: SYNC_STATUS.LOCAL_ONLY,
    // 交卷失败时的提示文案；为空表示同步正常，结果区不显示重试条
    submitError: '',
    // 结果复盘：筛选与搜索（PRD 4.7）
    resultFilter: RESULT_FILTERS.ALL,
    resultKeyword: '',
    filteredResultItems: [],
    resultFilterCounts: {
      all: 0,
      correct: 0,
      wrong: 0,
      unanswered: 0
    },
    resultFilterEmptyText: '暂无题目',
    isViewMode: false,
    isTestMode: false,
    subjectId: '',
    bankId: '',
    practiceTitle: DEFAULT_PRACTICE_TITLE,
    practicePath: '/page/practice/index',
    questions: [],
    total: 0,
    currentIndex: 0,
    currentNumber: 0,
    currentQuestion: null,
    selectedKeys: [],
    answers: [],
    hasAnswered: false,
    shouldRevealAnswer: false,
    // 与 shouldRevealAnswer 分开：对错标记与正确答案始终显示，
    // 解析是否自动展开由用户在「学习偏好」里决定
    shouldShowExplanation: false,
    isCurrentAnswerCorrect: false,
    currentCorrectAnswerText: '',
    currentExplanation: '',
    progressPercent: 0,
    primaryActionText: '下一题',
    isLastQuestion: false,
    isCompleted: false,
    favoriteQuestionIds: [],
    isCurrentQuestionFavorite: false,
    wrongQuestionIds: [],
    wrongCount: 0,
    hasWrongQuestions: false,
    showSubmitModal: false,
    showQuestionOverview: false,
    unansweredCount: 0,
    overviewItems: [],
    durationSeconds,
    timerSeconds: durationSeconds,
    timerText: formatTimer(durationSeconds),
    correctCount: 0,
    score: 0,
    bestScore: 0,
    resultItems: []
  }
}

class PracticeSession {
  constructor(options) {
    const normalizedOptions = options || {}
    const quiz = normalizedOptions.quiz || null
    const mode = normalizeMode(normalizedOptions.mode)
    const isViewMode = mode === PRACTICE_MODES.VIEW
    const isTestMode = mode === PRACTICE_MODES.TEST
    const durationMinutes = parsePositiveInteger(normalizedOptions.durationMinutes, DEFAULT_TEST_DURATION_MINUTES)
    const durationSeconds = durationMinutes * 60
    const preferences = normalizePreferences(normalizedOptions.preferences)
    const restored = normalizedOptions.restored || null
    const now = typeof normalizedOptions.now === 'number' ? normalizedOptions.now : Date.now()

    this.storageKey = normalizedOptions.storageKey || ''
    this.preferences = preferences
    // 持久态与视图态分开：questionIds / questionOrder 这类字段页面不需要，
    // 不该跟着每次 setData 一起下发
    this.meta = {
      sessionId: (restored && restored.sessionId) || createSessionId(now, normalizedOptions.random),
      subjectId: quiz ? quiz.subjectId : '',
      questionBankId: quiz ? quiz.bankId : '',
      config: normalizedOptions.config || {},
      questionIds: (restored && restored.questionIds) || null,
      questionOrder: (restored && restored.questionOrder) || null,
      createdAt: (restored && restored.createdAt) || now,
      updatedAt: now
    }
    this.state = Object.assign(getInitialPracticeViewData(), {
      mode,
      isViewMode,
      isTestMode,
      sessionId: this.meta.sessionId,
      sessionStatus: (restored && restored.status) || SESSION_STATUS.IN_PROGRESS,
      syncStatus: (restored && restored.syncStatus) || SYNC_STATUS.LOCAL_ONLY,
      // 背题模式直接给答案与解析，不受偏好影响
      shouldRevealAnswer: isViewMode,
      shouldShowExplanation: isViewMode,
      preferences,
      subjectId: quiz ? quiz.subjectId : '',
      bankId: quiz ? quiz.bankId : '',
      practiceTitle: quiz ? quiz.title : DEFAULT_PRACTICE_TITLE,
      practicePath: normalizedOptions.practicePath || (quiz ? quiz.sharePath : '/page/practice/index'),
      questions: quiz ? quiz.questions : [],
      total: quiz ? quiz.questions.length : 0,
      durationSeconds,
      timerSeconds: durationSeconds,
      timerText: formatTimer(durationSeconds),
      bestScore: Number(normalizedOptions.bestScore) || 0,
      favoriteQuestionIds: Array.isArray(normalizedOptions.favoriteQuestionIds)
        ? normalizedOptions.favoriteQuestionIds.slice()
        : []
    })
    this.resetStudyClock()
  }

  /**
   * 学习时长时钟：记录本次练习的实际在场时长。
   * 页面切到后台时 pauseStudy 暂停、回到前台 resumeStudy 继续，避免挂机把时长算虚；
   * 交卷时由 finish() 结算并交给 ViewModel 落盘。
   */
  resetStudyClock() {
    this.startedAt = Date.now()
    this.pausedAt = 0
    this.accumulatedMs = 0
  }

  /**
   * 生成「题目集合 + 出题顺序」索引。
   *
   * questionIds 按 id 排序（与出题顺序无关，因此题库小幅增删也不会错位），
   * questionOrder 是它的下标排列，二者组合即可完整还原展示顺序：
   *   questionOrder.map((i) => questionIds[i])
   * 这样存储里只需要放 id 字符串，不用把 234 道题整个写进 storage。
   */
  buildQuestionIndex() {
    if (this.meta.questionIds && this.meta.questionOrder) {
      return this.meta
    }

    const displayIds = this.state.questions.map((question) => question.id)
    const questionIds = displayIds.slice().sort()
    const position = {}

    questionIds.forEach((id, index) => {
      position[id] = index
    })

    this.meta.questionIds = questionIds
    this.meta.questionOrder = displayIds.map((id) => position[id])

    return this.meta
  }

  /** 交给仓储落盘的结构。questionStates 由 answers 派生，避免两处维护 */
  getPersistedState() {
    this.buildQuestionIndex()

    return {
      sessionId: this.meta.sessionId,
      subjectId: this.meta.subjectId,
      questionBankId: this.meta.questionBankId,
      config: this.meta.config,
      questionIds: this.meta.questionIds,
      questionOrder: this.meta.questionOrder,
      currentIndex: this.state.currentIndex,
      answers: this.state.answers,
      questionStates: deriveQuestionStates(this.state.answers, this.state.questions.length),
      elapsedTime: this.getElapsedSeconds(),
      status: this.state.sessionStatus,
      syncStatus: this.state.syncStatus,
      createdAt: this.meta.createdAt,
      updatedAt: Date.now()
    }
  }

  /**
   * 从落盘数据恢复：答案、当前位置、答题状态、计时。
   *
   * 题库若被改过（题目增删），saved.answers 长度与当前卷不一致，
   * 这里按当前卷长度截断，多出来的丢弃——宁可少恢复一题，也不能下标错位。
   */
  restore(saved) {
    const total = this.state.questions.length

    if (!saved || !total) {
      return null
    }

    const answers = (saved.answers || []).slice(0, total)

    while (answers.length < total) {
      answers.push(null)
    }

    const currentIndex = Math.min(Math.max(Number(saved.currentIndex) || 0, 0), total - 1)

    this.state.answers = answers
    this.state.unansweredCount = this.getUnansweredIndexes(answers).length
    // 计时接着算：已累计时间直接写进时钟，本轮在场时间从现在开始叠加
    const elapsedSeconds = Math.max(Number(saved.elapsedTime) || 0, 0)
    this.accumulatedMs = elapsedSeconds * 1000
    this.startedAt = Date.now()
    this.pausedAt = 0

    // 模拟测试的倒计时也要接着走，否则恢复一场 10 分钟的测试会白得一个满时间
    if (this.state.isTestMode) {
      this.state.timerSeconds = Math.max(this.state.durationSeconds - elapsedSeconds, 0)
      this.state.timerText = formatTimer(this.state.timerSeconds)
    }

    return this.showQuestionAtIndex(currentIndex)
  }

  updateSessionStatus(status) {
    return this.updateState({
      sessionStatus: status
    })
  }

  /** 结果筛选。只切分类，不动关键词 */
  setResultFilter(filter) {
    const normalizedFilter = RESULT_FILTER_TEXT[filter] ? filter : RESULT_FILTERS.ALL

    return this.updateState(this.buildResultReviewPatch({
      resultFilter: normalizedFilter
    }))
  }

  /** 结果搜索：题干 + 选项 + 你的答案 + 正确答案 一起匹配 */
  setResultKeyword(keyword) {
    return this.updateState(this.buildResultReviewPatch({
      resultKeyword: String(keyword === undefined || keyword === null ? '' : keyword)
    }))
  }

  buildResultReviewPatch(patch) {
    const nextState = Object.assign({}, this.state, patch)
    const source = Array.isArray(this.state.resultItems) ? this.state.resultItems : []
    const filtered = filterResultItems(source, nextState.resultFilter, nextState.resultKeyword)

    return Object.assign({}, patch, {
      filteredResultItems: filtered,
      resultFilterCounts: countResultItems(source),
      resultFilterEmptyText: this.buildResultEmptyText(nextState.resultFilter, nextState.resultKeyword)
    })
  }

  buildResultEmptyText(filter, keyword) {
    const trimmedKeyword = String(keyword || '').trim()

    if (trimmedKeyword) {
      return `没有匹配「${trimmedKeyword}」的题目`
    }

    if (filter === RESULT_FILTERS.CORRECT) {
      return '还没有答对的题目'
    }

    if (filter === RESULT_FILTERS.WRONG) {
      return '没有答错的题目，全部正确'
    }

    if (filter === RESULT_FILTERS.UNANSWERED) {
      return '所有题目都已作答'
    }

    return '暂无题目'
  }

  updateSyncStatus(status) {
    return this.updateState({
      syncStatus: status
    })
  }

  pauseStudy() {
    if (this.pausedAt) {
      return null
    }

    this.accumulatedMs += Date.now() - this.startedAt
    this.pausedAt = Date.now()

    return null
  }

  resumeStudy() {
    if (!this.pausedAt) {
      return null
    }

    this.startedAt = Date.now()
    this.pausedAt = 0

    return null
  }

  getElapsedSeconds() {
    const elapsedMs = this.accumulatedMs + (this.pausedAt ? 0 : Date.now() - this.startedAt)

    return Math.max(Math.round(elapsedMs / 1000), 0)
  }

  getViewData() {
    return Object.assign({}, this.state)
  }

  getShareMessage() {
    return {
      title: this.state.practiceTitle || 'QandA 练习',
      path: this.state.practicePath || '/page/practice/index'
    }
  }

  reset() {
    const questions = this.state.questions
    const firstQuestion = questions[0] || null
    const isViewMode = this.state.isViewMode

    // 重练是新的一轮，计时从零开始
    this.resetStudyClock()

    const patch = {
      currentIndex: 0,
      currentNumber: firstQuestion ? 1 : 0,
      currentQuestion: this.getQuestionView(firstQuestion, [], false),
      selectedKeys: [],
      answers: [],
      hasAnswered: false,
      shouldRevealAnswer: isViewMode,
      shouldShowExplanation: isViewMode,
      isCurrentAnswerCorrect: isViewMode,
      currentCorrectAnswerText: isViewMode ? this.getCorrectAnswerText(firstQuestion) : '',
      currentExplanation: isViewMode ? this.getExplanation(firstQuestion) : '',
      progressPercent: this.getProgressPercent(0),
      primaryActionText: this.getPrimaryActionText(0, false, []),
      isLastQuestion: questions.length <= 1,
      isCompleted: false,
      // 收藏是跨会话的持久数据，重练时保留
      favoriteQuestionIds: this.state.favoriteQuestionIds.slice(),
      isCurrentQuestionFavorite: firstQuestion
        ? this.state.favoriteQuestionIds.indexOf(firstQuestion.id) >= 0
        : false,
      showSubmitModal: false,
      showQuestionOverview: false,
      unansweredCount: isViewMode ? 0 : questions.length,
      overviewItems: this.getOverviewItems([], 0),
      timerSeconds: this.state.durationSeconds,
      timerText: formatTimer(this.state.durationSeconds),
      correctCount: 0,
      score: 0,
      wrongQuestionIds: [],
      wrongCount: 0,
      hasWrongQuestions: false,
      resultItems: [],
      resultFilter: RESULT_FILTERS.ALL,
      resultKeyword: '',
      filteredResultItems: [],
      resultFilterCounts: {
        all: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0
      },
      resultFilterEmptyText: '暂无题目'
    }

    return this.updateState(patch, {
      startTimer: this.shouldStartTimerAfterPatch(patch),
      stopTimer: true
    })
  }

  updateTimer(timerSeconds) {
    const safeSeconds = Math.max(Number(timerSeconds) || 0, 0)

    return this.updateState({
      timerSeconds: safeSeconds,
      timerText: formatTimer(safeSeconds)
    })
  }

  autoSubmit() {
    if (this.state.isCompleted) {
      return {
        stopTimer: true
      }
    }

    this.state.timerSeconds = 0
    this.state.timerText = formatTimer(0)

    if (this.shouldConfirmCurrentAnswer()) {
      this.commitCurrentAnswerInternal(this.state.selectedKeys)
    }

    return this.finish()
  }

  selectOption(selectedIndex) {
    if (this.state.isCompleted || this.state.hasAnswered || this.state.isViewMode) {
      return null
    }

    const question = this.getCurrentBaseQuestion()

    if (!question || Number.isNaN(selectedIndex) || !question.options[selectedIndex]) {
      return null
    }

    const selectedKey = question.options[selectedIndex].key

    if (question.isMultiple) {
      const selectedKeys = this.toggleSelectedKey(this.state.selectedKeys, selectedKey)

      return this.updateState({
        selectedKeys,
        currentQuestion: this.getQuestionView(question, selectedKeys, false),
        primaryActionText: this.getPrimaryActionText(this.state.currentIndex, false, selectedKeys)
      })
    }

    const result = this.commitCurrentAnswer([selectedKey])

    // 「答对自动进入下一题」只在单选题、练习模式、且不是最后一题时生效：
    // 多选题勾选后仍需用户确认，模拟测试需要能回头检查，最后一题要留给结果页
    if (
      result &&
      this.preferences.autoNextWhenCorrect &&
      this.state.isCurrentAnswerCorrect &&
      !this.state.isLastQuestion &&
      !this.state.isTestMode
    ) {
      result.autoAdvance = true
    }

    return result
  }

  toggleFavoriteQuestion() {
    const question = this.getCurrentBaseQuestion()

    if (!question) {
      return null
    }

    const favoriteQuestionIds = this.state.favoriteQuestionIds.slice()
    const favoriteIndex = favoriteQuestionIds.indexOf(question.id)
    const isCurrentQuestionFavorite = favoriteIndex === -1

    if (isCurrentQuestionFavorite) {
      favoriteQuestionIds.push(question.id)
    } else {
      favoriteQuestionIds.splice(favoriteIndex, 1)
    }

    const result = this.updateState({
      favoriteQuestionIds,
      isCurrentQuestionFavorite
    })

    result.value = isCurrentQuestionFavorite
    // 由 ViewModel 落盘，session 不直接依赖 storage
    result.saveFavorite = {
      id: question.id,
      value: isCurrentQuestionFavorite
    }

    return result
  }

  goNext() {
    if (!this.state.questions.length) {
      return null
    }

    if (this.shouldConfirmCurrentAnswer()) {
      return this.commitCurrentAnswer(this.state.selectedKeys)
    }

    if (this.state.isLastQuestion) {
      return this.state.isViewMode ? this.returnCommand() : this.submit()
    }

    return this.showQuestionAtIndex(this.state.currentIndex + 1)
  }

  goPrev() {
    if (this.state.currentIndex === 0) {
      return null
    }

    return this.showQuestionAtIndex(this.state.currentIndex - 1)
  }

  submit() {
    if (this.state.isViewMode) {
      return this.returnCommand()
    }

    const unansweredIndexes = this.getUnansweredIndexes(this.state.answers)

    if (unansweredIndexes.length > 0) {
      return this.updateState({
        showSubmitModal: true,
        unansweredCount: unansweredIndexes.length,
        overviewItems: this.getOverviewItems(this.state.answers, this.state.currentIndex)
      })
    }

    return this.finish()
  }

  closeSubmitModal() {
    return this.updateState({
      showSubmitModal: false
    })
  }

  openQuestionOverview() {
    return this.updateState({
      showSubmitModal: false,
      showQuestionOverview: true,
      overviewItems: this.getOverviewItems(this.state.answers, this.state.currentIndex)
    })
  }

  closeQuestionOverview() {
    return this.updateState({
      showQuestionOverview: false
    })
  }

  jumpToQuestion(index) {
    const nextIndex = Number(index)

    if (Number.isNaN(nextIndex) || nextIndex < 0 || nextIndex >= this.state.questions.length) {
      return null
    }

    return this.showQuestionAtIndex(nextIndex, {
      showQuestionOverview: false
    })
  }

  forceSubmit() {
    if (this.shouldConfirmCurrentAnswer()) {
      this.commitCurrentAnswerInternal(this.state.selectedKeys)
    }

    this.state.showSubmitModal = false
    this.state.showQuestionOverview = false
    return this.finish()
  }

  finish() {
    const questions = this.state.questions

    if (!questions.length) {
      return null
    }

    // 交卷只能落盘一次：重复调用（例如交卷弹窗与超时自动交卷同时触发）
    // 会把同一份结果重复累加进错题本与进度表。
    const alreadyCompleted = this.state.isCompleted
    const answers = this.state.answers
    const correctCount = answers.filter((item) => item && item.isCorrect).length
    const score = Math.round((correctCount / questions.length) * 100)
    const bestScore = Math.max(score, this.state.bestScore)
    const resultItems = questions.map((question, index) => {
      // 先取原始值再兜底：直接写 answers[index] || {} 会让未作答也变成 truthy，
      // 于是"没做"被误判成"已答"（且计为答错）
      const rawAnswer = answers[index]
      const answer = rawAnswer || {}
      // answered 必须显式区分：未作答的 isCorrect 也是 false，
      // 只靠 isCorrect 筛选会把"没做"和"做错"混成一类
      const answered = !!rawAnswer

      return {
        id: question.id,
        number: index + 1,
        typeText: question.typeText,
        stem: question.stem,
        selectedText: this.getAnswerText(question, answer.selectedKeys) || '未作答',
        correctText: this.getAnswerText(question, question.answerKeys),
        answered,
        isCorrect: answered && !!answer.isCorrect,
        explanation: this.getExplanation(question),
        // 搜索用：题干 + 全部选项文本预先拼好，避免在 WXML 里做字符串运算
        searchText: `${question.stem} ${(question.options || []).map((option) => option.text).join(' ')}`,
        options: (question.options || []).map((option) => ({
          key: option.key,
          label: option.label,
          text: option.text,
          isCorrectOption: question.answerKeys.indexOf(option.key) >= 0,
          isSelected: (answer.selectedKeys || []).indexOf(option.key) >= 0
        }))
      }
    })

    const wrongQuestionIds = resultItems
      .filter((item) => !item.isCorrect)
      .map((item) => item.id)
    const shouldRecord = !alreadyCompleted
    const answerRecords = buildAnswerRecords(questions, answers)
    // 只取一次：多次采样会让「学习时长」与「每日日志」对不上
    const elapsedSeconds = this.getElapsedSeconds()
    const answeredCount = answerRecords.filter((record) => record.answered).length

    return this.updateState({
      answers: answers.slice(),
      isCompleted: true,
      // 交卷即进入 SUBMITTED；同步状态由 ViewModel 决定（成功 SYNCED / 失败 SYNC_PENDING）
      sessionStatus: SESSION_STATUS.SUBMITTED,
      showSubmitModal: false,
      showQuestionOverview: false,
      correctCount,
      score,
      bestScore,
      wrongQuestionIds,
      wrongCount: wrongQuestionIds.length,
      hasWrongQuestions: wrongQuestionIds.length > 0,
      resultItems,
      // 交卷后复盘区从"全部"开始，不清空上一轮的搜索词
      resultFilter: RESULT_FILTERS.ALL,
      filteredResultItems: resultItems,
      resultFilterCounts: countResultItems(resultItems),
      resultFilterEmptyText: resultItems.length ? '暂无题目' : '暂无题目'
    }, {
      stopTimer: true,
      saveBestScore: alreadyCompleted || !this.storageKey ? null : {
        key: this.storageKey,
        value: bestScore
      },
      saveScopeProgress: alreadyCompleted ? null : this.buildScopeProgressPayload(questions, answers),
      // 错题本：背题模式不记录（翻一遍答案不是做题），未作答按答错计入；
      // 用户也可以在「学习偏好」里关掉自动收集
      saveWrongResults:
        !shouldRecord || this.state.isViewMode || !this.preferences.autoAddWrongBook
          ? null
          : {
            records: answerRecords
          },
      // 学习时长：背题模式也在学，同样计入；重复交卷不重复结算
      saveStudyTime: !shouldRecord ? null : {
        seconds: elapsedSeconds
      },
      // 每日日志：给统计页的趋势图提供时间序列。
      // 背题模式不计题量（翻答案不算练题），但时长照记。
      saveDailyLog: !shouldRecord ? null : {
        answered: this.state.isViewMode ? 0 : answeredCount,
        correct: this.state.isViewMode ? 0 : correctCount,
        seconds: elapsedSeconds
      }
    })
  }

  /**
   * 交卷后写入逐题对错记录，用于首页/科目页的「已做 / 正确率」统计。
   * 抽题练习的 scopeKey 落在科目上，题目 id 天然与题库去重。
   */
  buildScopeProgressPayload(questions, answers) {
    if (this.state.isViewMode) {
      return null
    }

    const scopeKey = this.state.bankId || this.state.subjectId

    if (!scopeKey) {
      return null
    }

    return {
      scopeKey,
      records: buildAnswerRecords(questions, answers),
      total: questions.length
    }
  }

  showQuestionAtIndex(index, extraData) {
    const question = this.state.questions[index]
    const savedAnswer = this.state.answers[index] || null
    const selectedKeys = savedAnswer ? savedAnswer.selectedKeys : []
    const hasAnswered = !!savedAnswer
    // 模拟测试模式下不即时反馈，交卷后才统一公布答案
    const shouldRevealAnswer = this.state.isViewMode || (hasAnswered && !this.state.isTestMode)
    // 对错与正确答案照常给出，解析是否展开服从用户偏好（背题模式始终展开）
    const shouldShowExplanation =
      shouldRevealAnswer && (this.state.isViewMode || this.preferences.autoShowExplanation)

    return this.updateState(Object.assign({
      currentIndex: index,
      currentNumber: index + 1,
      currentQuestion: this.getQuestionView(question, selectedKeys, shouldRevealAnswer),
      selectedKeys,
      hasAnswered,
      shouldRevealAnswer,
      shouldShowExplanation,
      isCurrentAnswerCorrect: this.state.isViewMode || (savedAnswer ? !!savedAnswer.isCorrect : false),
      currentCorrectAnswerText: shouldRevealAnswer ? this.getCorrectAnswerText(question) : '',
      currentExplanation: shouldRevealAnswer ? this.getExplanation(question) : '',
      progressPercent: this.getProgressPercent(index),
      primaryActionText: this.getPrimaryActionText(index, hasAnswered, selectedKeys),
      isLastQuestion: index >= this.state.questions.length - 1,
      isCurrentQuestionFavorite: question ? this.state.favoriteQuestionIds.indexOf(question.id) >= 0 : false
    }, extraData || {}))
  }

  commitCurrentAnswer(selectedKeys) {
    const question = this.getCurrentBaseQuestion()

    if (!question || !selectedKeys.length) {
      return null
    }

    this.commitCurrentAnswerInternal(selectedKeys)
    return this.showQuestionAtIndex(this.state.currentIndex)
  }

  commitCurrentAnswerInternal(selectedKeys) {
    const question = this.getCurrentBaseQuestion()

    if (!question) {
      return
    }

    const normalizedKeys = selectedKeys.slice().sort()
    const answerKeys = question.answerKeys.slice().sort()
    const isCorrect =
      normalizedKeys.length === answerKeys.length &&
      normalizedKeys.every((key, index) => key === answerKeys[index])

    this.state.answers[this.state.currentIndex] = {
      questionId: question.id,
      selectedKeys: normalizedKeys,
      isCorrect
    }
    this.state.hasAnswered = true
    this.state.shouldRevealAnswer = !this.state.isTestMode
    this.state.shouldShowExplanation = !this.state.isTestMode && this.preferences.autoShowExplanation
    this.state.isCurrentAnswerCorrect = isCorrect
    this.state.currentCorrectAnswerText = this.getCorrectAnswerText(question)
    this.state.currentExplanation = this.getExplanation(question)
    this.state.currentQuestion = this.getQuestionView(question, normalizedKeys, !this.state.isTestMode)
    this.state.unansweredCount = this.getUnansweredIndexes(this.state.answers).length
    this.state.primaryActionText = this.getPrimaryActionText(this.state.currentIndex, true, normalizedKeys)
  }

  shouldConfirmCurrentAnswer() {
    const question = this.getCurrentBaseQuestion()

    return !!question && question.isMultiple && !this.state.hasAnswered && this.state.selectedKeys.length > 0
  }

  updateState(patch, effects) {
    this.state = Object.assign({}, this.state, patch)

    const result = Object.assign({
      data: this.getViewData()
    }, effects || {})

    return result
  }

  getCurrentBaseQuestion() {
    return this.state.questions[this.state.currentIndex] || null
  }

  getQuestionView(question, selectedKeys, revealAnswer) {
    if (!question) {
      return null
    }

    return Object.assign({}, question, {
      options: question.options.map((option) => ({
        key: option.key,
        label: option.label,
        text: option.text,
        selected: selectedKeys.indexOf(option.key) >= 0,
        isCorrectOption: revealAnswer ? question.answerKeys.indexOf(option.key) >= 0 : false,
        isWrongOption:
          revealAnswer && question.answerKeys.indexOf(option.key) < 0 && selectedKeys.indexOf(option.key) >= 0
      }))
    })
  }

  getOverviewItems(answers, currentIndex) {
    return this.state.questions.map((question, index) => ({
      number: index + 1,
      index,
      answered: !!answers[index],
      isCorrect: answers[index] ? !!answers[index].isCorrect : false,
      selectedKeys: answers[index] ? answers[index].selectedKeys : [],
      isCurrent: index === currentIndex,
      isFavorite: this.state.favoriteQuestionIds.indexOf(question.id) >= 0
    }))
  }

  getUnansweredIndexes(answers) {
    return this.state.questions.reduce((items, question, index) => {
      if (!answers[index]) {
        items.push(index)
      }

      return items
    }, [])
  }

  getProgressPercent(index) {
    if (!this.state.questions.length) {
      return 0
    }

    return Math.round(((index + 1) / this.state.questions.length) * 100)
  }

  /**
   * 主按钮文案。底部只保留「上一题 / 下一题」两个按钮，因此文案固定为翻页语义：
   * - 单选题未作答也可直接跳到下一题（该题按未作答计入错题）；
   * - 多选题已勾选但未确认时，按钮暂变为「确认答案」，这是必要动作提示，不是冗余选项；
   * - 最后一题变为「交卷」（背题模式为「返回题库」）。
   */
  getPrimaryActionText(index, hasAnswered, selectedKeys) {
    const isLast = index >= this.state.questions.length - 1

    if (this.state.isViewMode) {
      return isLast ? '返回题库' : '下一题'
    }

    if (!hasAnswered) {
      const question = this.state.questions[index]

      if (question && question.isMultiple && selectedKeys.length) {
        return '确认答案'
      }
    }

    return isLast ? '交卷' : '下一题'
  }

  shouldStartTimerAfterPatch(patch) {
    return this.state.isTestMode && !patch.isCompleted
  }

  toggleSelectedKey(selectedKeys, key) {
    const nextKeys = selectedKeys.slice()
    const keyIndex = nextKeys.indexOf(key)

    if (keyIndex >= 0) {
      nextKeys.splice(keyIndex, 1)
    } else {
      nextKeys.push(key)
      nextKeys.sort()
    }

    return nextKeys
  }

  getAnswerText(question, keys) {
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

  getCorrectAnswerText(question) {
    if (!question) {
      return ''
    }

    return `正确答案 ${question.answerKeys.join('')}`
  }

  getExplanation(question) {
    return question && question.explanation ? question.explanation : '本题暂无解析。'
  }

  returnCommand() {
    return {
      command: {
        type: 'returnBankDetail'
      }
    }
  }
}

/**
 * 结果筛选 + 搜索。纯函数，便于直接断言。
 * 未作答必须靠 answered 区分，不能只看 isCorrect（未答的 isCorrect 也是 false）。
 */
function filterResultItems(items, filter, keyword) {
  const source = Array.isArray(items) ? items : []
  const normalizedFilter = RESULT_FILTER_TEXT[filter] ? filter : RESULT_FILTERS.ALL
  const needle = String(keyword === undefined || keyword === null ? '' : keyword).trim().toLowerCase()

  return source.filter((item) => {
    if (!item) {
      return false
    }

    if (normalizedFilter === RESULT_FILTERS.CORRECT && !(item.answered && item.isCorrect)) {
      return false
    }

    if (normalizedFilter === RESULT_FILTERS.WRONG && !(item.answered && !item.isCorrect)) {
      return false
    }

    if (normalizedFilter === RESULT_FILTERS.UNANSWERED && item.answered) {
      return false
    }

    if (!needle) {
      return true
    }

    const haystack = [
      item.stem,
      item.searchText,
      item.selectedText,
      item.correctText,
      item.explanation
    ].filter(Boolean).join(' ').toLowerCase()

    return haystack.indexOf(needle) >= 0
  })
}

function countResultItems(items) {
  const source = Array.isArray(items) ? items : []
  const answeredItems = source.filter((item) => item && item.answered)

  return {
    all: source.length,
    correct: answeredItems.filter((item) => item.isCorrect).length,
    wrong: answeredItems.filter((item) => !item.isCorrect).length,
    unanswered: source.filter((item) => item && !item.answered).length
  }
}

module.exports = {
  DEFAULT_PRACTICE_TITLE,
  DEFAULT_TEST_DURATION_MINUTES,
  PRACTICE_MODES,
  PracticeSession,
  RESULT_FILTER_TEXT,
  RESULT_FILTERS,
  countResultItems,
  filterResultItems,
  formatTimer,
  getInitialPracticeViewData,
  normalizeMode,
  parsePositiveInteger
}
