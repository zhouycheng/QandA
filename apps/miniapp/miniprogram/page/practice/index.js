const navigation = require('../../utils/navigation.js')
const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { PracticeViewModel } = require('../../viewmodels/practice-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const HOME_PAGE_URL = '/page/subject-list/index'

// 答对自动翻页的停留时间：需要留出看清「回答正确」与选项变绿的时间，
// 太短会让人来不及确认自己点对了
const AUTO_ADVANCE_DELAY = 800

Page(withPageLifecycle({
  data: Object.assign(PracticeViewModel.getInitialData(), {
    // 长解析默认收起（设计稿「剩下的收起来了」）。纯界面状态，不进 ViewModel：
    // 换题时由 applyViewModelResult 归零，和答题逻辑没有关系
    explanationOpen: false
  }),

  onLoad(options) {
    this.viewModel = new PracticeViewModel({
      storage: createWxStorageAdapter()
    })
    this.routeOptions = options || {}
    this.applyViewModelResult(this.viewModel.load(options), 'loadingPractice')
    this.startSyncWatch()
  },

  onShow() {
    this.pageVisible = true
    if (this.viewModel && this.viewModel.online) this.viewModel.online.activeId = this.viewModel.waitingId || (this.viewModel.session && this.viewModel.session.meta.sessionId) || ''
    // 回到前台：交接中的练习先确认写入权。
    if (this.viewModel && this.viewModel.online && this.viewModel.session) {
      const online = this.viewModel.online
      const id = this.viewModel.session.meta.sessionId
      try {
        const snapshot = online.get(id)
        if ((snapshot && snapshot.releaseCommand) || online.releasing[`${online.userId}:${id}`]) {
          this.viewModel.editingLocked = true
          this.setData({ editingLocked: true })
        }
      } catch (error) { /* 账号状态由 checkWriter 处理 */ }
    }
    if (this.viewModel) {
      this.applyViewModelResult(this.viewModel.resumeStudy())
      this.startSyncWatch()
      this.viewModel.checkWriter().then(result => this.applyViewModelResult(result)).catch(error => this.showSaveError(error))
    }
  },

  onHide() {
    this.pageVisible = false
    if (this.viewModel && this.viewModel.online) this.viewModel.online.activeId = ''
    if (this.syncWatch) clearTimeout(this.syncWatch)
    if (!this.viewModel) {
      return
    }

    // 切到后台：暂停累计，避免挂机把学习时长算虚
    this.viewModel.pauseStudy()
    // 主动退出也要落盘：用户可能从这里直接切走，之后再也不回来
    this.saveAndFlush()
  },

  onUnload() {
    this.pageVisible = false
    if (this.viewModel && this.viewModel.online) this.viewModel.online.activeId = ''
    // 异常退出（杀进程 / 系统回收）不总会走 onHide，这里是最后一道保险
    if (this.viewModel) {
      this.saveAndFlush()
      const online = this.viewModel.online
      const session = this.viewModel.session
      if (online && session && !session.state.isCompleted) online.release(session.meta.sessionId).catch(error => this.showSaveError(error))
    }

    this.stopTestTimer()
    this.clearAutoAdvance()
    if (this.syncWatch) clearTimeout(this.syncWatch)
  },

  saveAndFlush() {
    try {
      Promise.resolve(this.viewModel.saveSessionNow()).catch(error => this.showSaveError(error))
    } catch (error) { this.showSaveError(error) }
  },

  showSaveError(error) {
    wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
  },

  startSyncWatch() {
    if (this.syncWatch) clearTimeout(this.syncWatch)
    this.syncWatch = setTimeout(async () => {
      if (!this.viewModel) return
      try {
        const result = await this.viewModel.checkWriter()
        this.applyViewModelResult(result)
        if (this.data.waitingForSync) {
          const wait = this.viewModel.online && this.viewModel.online.getWaiting(this.viewModel.waitingId)
          this.setData({ waitingSeconds: Math.max(0, Math.floor((Date.now() - (wait && wait.startedAt || Date.now())) / 1000)) })
        }
      } catch (error) { this.showSaveError(error) }
      if (this.pageVisible !== false) this.startSyncWatch()
    }, 15000 + Math.floor(Math.random() * 3000))
  },

  startNewPractice() {
    this.stopTestTimer()
    this.clearAutoAdvance()
    const app = getApp()
    const route = this.viewModel && this.viewModel.routeOptions || this.routeOptions || {}
    if (app && app.setPendingSubjectId && route.subjectId) app.setPendingSubjectId(route.subjectId)
    navigation.switchTab({ url: '/page/bank-detail/index' })
  },

  waitInBackground() { this.returnBankDetail() },

  inputAnswerText(e) { this.applyViewModelResult(this.viewModel.setAnswerText(e.detail.value)) },
  assessShortAnswer(e) { this.applyViewModelResult(this.viewModel.assessShortAnswer(e.currentTarget.dataset.value)) },

  assessResult(e) { this.applyViewModelResult(this.viewModel.assessResult(e.currentTarget.dataset.id, e.currentTarget.dataset.value)) },

  onShareAppMessage() {
    return this.viewModel.getShareMessage()
  },

  /** 答对自动翻页的定时器：用户手动操作时必须取消，否则会连翻两题 */
  clearAutoAdvance() {
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer)
      this.autoAdvanceTimer = null
    }
  },

  scheduleAutoAdvance() {
    this.clearAutoAdvance()
    this.autoAdvanceTimer = setTimeout(() => {
      this.autoAdvanceTimer = null
      this.goNext()
    }, AUTO_ADVANCE_DELAY)
  },

  startTestTimer() {
    if (!this.data.isTestMode || this.data.isCompleted || !this.data.questions.length) {
      return
    }

    this.stopTestTimer()
    this.testEndsAt = Date.now() + this.data.timerSeconds * 1000
    this.countdownTimer = setInterval(() => {
      if (this.data.editingLocked) return
      const timerSeconds = Math.max(Math.ceil((this.testEndsAt - Date.now()) / 1000), 0)
      this.applyViewModelResult(this.viewModel.updateTimer(timerSeconds))

      if (timerSeconds <= 0) {
        this.applyViewModelResult(this.viewModel.autoSubmit(), 'submitting')
      }
    }, 1000)
  },

  stopTestTimer() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  },

  selectOption(e) {
    if (this.data.editingLocked || this.data.waitingForSync) return
    const selectedIndex = Number(e.currentTarget.dataset.index)
    const result = this.viewModel.selectOption(selectedIndex)
    const preferences = this.data.preferences || {}

    // 震动反馈由学习偏好控制；机型或系统关闭震动时静默失败
    if (result && preferences.vibrateOnAnswer) {
      wx.vibrateShort({
        type: 'light',
        fail: () => {}
      })
    }

    // 先清掉可能残留的自动翻页，再看本次作答是否触发新的
    this.clearAutoAdvance()
    this.applyViewModelResult(result)

    if (result && result.autoAdvance) {
      this.scheduleAutoAdvance()
    }
  },

  goNext() {
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.goNext())
  },

  goPrev() {
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.goPrev())
  },

  submitPractice() {
    if (this.data.submitting) return
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.submit(), 'submitting')
  },

  forceSubmit() {
    if (this.data.submitting) return
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.forceSubmit(), 'submitting')
  },

  closeSubmitModal() {
    this.applyViewModelResult(this.viewModel.closeSubmitModal())
  },

  openOverview() {
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.openQuestionOverview())
  },

  closeOverview() {
    this.applyViewModelResult(this.viewModel.closeQuestionOverview())
  },

  jumpToQuestion(e) {
    const detailIndex = e.detail && e.detail.index
    const datasetIndex = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index
    const nextIndex = detailIndex !== undefined ? detailIndex : datasetIndex

    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.jumpToQuestion(nextIndex))
  },

  /** 答题卡里的「确认结束」：先收起弹层，再走正常交卷（未答完会弹二次确认） */
  handleOverviewSubmit() {
    if (!this.viewModel) {
      return
    }

    this.applyViewModelResult(this.viewModel.closeQuestionOverview())
    this.submitPractice()
  },

  /** 长解析的展开 / 收起 */
  toggleExplanation() {
    this.setData({
      explanationOpen: !this.data.explanationOpen
    })
  },

  toggleFavorite() {
    if (this.data.favoriteSaving) return
    const result = this.viewModel.toggleFavoriteQuestion()
    return this.applyViewModelResult(result, 'favoriteSaving')
  },

  /** 标记 / 取消标记当前题：和收藏一样给一句 toast，否则用户不知道点没点上 */
  toggleMark() {
    const result = this.viewModel.toggleMarkQuestion()
    this.applyViewModelResult(result)

    if (result && typeof result.value === 'boolean') {
      wx.showToast({
        title: result.value ? '已标记本题' : '已取消标记',
        icon: 'none',
        duration: 1200
      })
    }
  },

  /** 答题卡里的「看标记」：直接跳到第一个标记题，没有就提示 */
  jumpToFirstMarked() {
    const items = this.data.overviewItems || []
    const firstMarked = items.filter((item) => item.isMarked)[0]

    if (!firstMarked) {
      wx.showToast({
        title: '还没有标记的题目',
        icon: 'none',
        duration: 1200
      })
      return
    }

    this.applyViewModelResult(this.viewModel.closeQuestionOverview())
    this.jumpToQuestion({ detail: { index: firstMarked.index } })
  },

  restartPractice() {
    this.stopTestTimer()
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.reset())
  },

  redoWrongQuestions() {
    this.applyViewModelResult(this.viewModel.createRedoWrongCommand(this.data.wrongQuestionIds))
  },

  returnBankDetail() {
    wx.navigateBack({
      fail: () => {
        navigation.switchTab({
          url: HOME_PAGE_URL
        })
      }
    })
  },

  returnHome() {
    navigation.switchTab({
      url: HOME_PAGE_URL
    })
  },

  applyViewModelResult(result, busyKey) {
    if (!result) {
      return
    }

    if (typeof result.then === 'function') {
      if (busyKey) this.setData({ [busyKey]: true })
      return result.then(resolved => this.applyViewModelResult(resolved)).catch(error => {
        this.showSaveError(error)
        if (!this.viewModel.session) this.setData({ loadError: error.message || '练习加载失败，请重试' })
      }).finally(() => { if (busyKey && !this._pageUnloaded) this.setData({ [busyKey]: false }) })
    }

    const runEffects = () => {
      this.applyViewModelEffects(result)
    }

    if (result.data) {
      if (this.pageVisible !== false && this.viewModel && this.viewModel.online) this.viewModel.online.activeId = this.viewModel.waitingId || (this.viewModel.session && this.viewModel.session.meta.sessionId) || ''
      const patch = Object.assign({}, result.data)

      // 换题就把解析收回去：否则上一题展开的长解析会带到下一题
      if (patch.currentIndex !== undefined && patch.currentIndex !== this.lastQuestionIndex) {
        this.lastQuestionIndex = patch.currentIndex
        patch.explanationOpen = false
      }

      this.setData(patch, runEffects)
      return
    }

    runEffects()
  },

  retrySubmit() {
    if (this.data.submitting) return
    return this.applyViewModelResult(this.viewModel.retrySubmit(), 'submitting')
  },

  handleResultFilter(e) {
    const filter = e.currentTarget.dataset.filter
    this.applyViewModelResult(this.viewModel.setResultFilter(filter))
  },

  handleResultSearch(e) {
    const keyword = e.detail && e.detail.value !== undefined ? e.detail.value : ''
    this.applyViewModelResult(this.viewModel.setResultKeyword(keyword))
  },

  handleOpenQuestionDetail(e) {
    const questionId = e.currentTarget.dataset.id
    this.applyViewModelResult(this.viewModel.createQuestionDetailCommand(questionId))
  },

  applyViewModelEffects(result) {
    if (result.stopTimer) {
      this.stopTestTimer()
    }

    // 交卷同步失败：保留本地结果，只挂一条可重试的提示，不清 Session
    if (result.submitOk === false) {
      this.setData({
        submitError: result.submitError || '提交失败，请重试'
      })
      wx.showToast({
        title: result.submitError || '提交失败',
        icon: 'none'
      })
    }

    if (result.submitOk === true && this.data.submitError) {
      this.setData({
        submitError: ''
      })
    }

    if (result.command) {
      this.handleViewModelCommand(result.command)
    }

    if (result.startTimer) {
      this.startTestTimer()
    }
  },

  handleViewModelCommand(command) {
    if (command.type === 'toast') wx.showToast({ title: command.title, icon: 'none' })
    if (command.type === 'trialLogin') {
      wx.showModal({ title: '登录后继续练习', content: '本机的两次试答已使用。登录后返回题库配置，再开始正式练习。', confirmText: '去登录', cancelText: '继续浏览', success: result => {
        if (result.confirm) {
          try { createWxStorageAdapter().set('qandaPendingPractice', this.viewModel.routeOptions) }
          catch (error) { this.showSaveError(error); return }
          navigation.switchTab({ url: '/page/bank-detail/index', success: () => navigation.navigateTo({ url: '/page/login/index' }) })
        }
      } })
    }
    if (command.type === 'returnBankDetail') {
      this.returnBankDetail()
    }

    if (command.type === 'navigate' && command.url) {
      navigation.navigateTo({
        url: command.url,
        fail: () => {
          navigation.switchTab({
            url: HOME_PAGE_URL
          })
        }
      })
    }
  }
}))
