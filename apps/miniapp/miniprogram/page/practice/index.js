const { PracticeViewModel } = require('../../viewmodels/practice-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

const HOME_PAGE_URL = '/page/subject-list/index'

// 答对自动翻页的停留时间：需要留出看清「回答正确」与选项变绿的时间，
// 太短会让人来不及确认自己点对了
const AUTO_ADVANCE_DELAY = 800

// 超过这个时长还没返回才弹「提交中」：正常提交是微任务级返回，立刻弹只会闪一下
const SUBMIT_LOADING_DELAY = 250

Page(wrapTaps({
  data: PracticeViewModel.getInitialData(),

  onLoad(options) {
    this.viewModel = new PracticeViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load(options))
  },

  onShow() {
    // 回到前台：继续累计学习时长
    if (this.viewModel) {
      this.viewModel.resumeStudy()
    }
  },

  onHide() {
    if (!this.viewModel) {
      return
    }

    // 切到后台：暂停累计，避免挂机把学习时长算虚
    this.viewModel.pauseStudy()
    // 主动退出也要落盘：用户可能从这里直接切走，之后再也不回来
    this.viewModel.saveSessionNow()
  },

  onUnload() {
    // 异常退出（杀进程 / 系统回收）不总会走 onHide，这里是最后一道保险
    if (this.viewModel) {
      this.viewModel.saveSessionNow()
    }

    this.stopTestTimer()
    this.clearAutoAdvance()
  },

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
    this.testEndsAt = Date.now() + this.data.durationSeconds * 1000
    this.countdownTimer = setInterval(() => {
      const timerSeconds = Math.max(Math.ceil((this.testEndsAt - Date.now()) / 1000), 0)
      this.applyViewModelResult(this.viewModel.updateTimer(timerSeconds))

      if (timerSeconds <= 0) {
        this.applyViewModelResult(this.viewModel.autoSubmit())
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
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.submit())
  },

  forceSubmit() {
    this.clearAutoAdvance()
    this.applyViewModelResult(this.viewModel.forceSubmit())
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

  toggleFavorite() {
    const result = this.viewModel.toggleFavoriteQuestion()
    this.applyViewModelResult(result)

    if (result && typeof result.value === 'boolean') {
      wx.showToast({
        title: result.value ? '已收藏本题' : '已取消收藏',
        icon: 'none',
        duration: 1200
      })
    }
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
        wx.switchTab({
          url: HOME_PAGE_URL
        })
      }
    })
  },

  returnHome() {
    wx.switchTab({
      url: HOME_PAGE_URL
    })
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    // 交卷走 Gateway，结果是个 Promise（慢网络场景会真的等两秒）。
    // 等待期间必须给反馈，否则会被判定成「点了没反应」；
    // 但正常提交是微任务级返回，立刻弹 loading 只会闪一下——延迟 250ms 再显示。
    if (typeof result.then === 'function') {
      const loadingTimer = setTimeout(() => {
        wx.showLoading({
          title: '提交中',
          mask: true
        })
      }, SUBMIT_LOADING_DELAY)

      result.then((resolved) => {
        clearTimeout(loadingTimer)
        wx.hideLoading()
        this.applyViewModelResult(resolved)
      })

      return
    }

    const runEffects = () => {
      this.applyViewModelEffects(result)
    }

    if (result.data) {
      this.setData(result.data, runEffects)
      return
    }

    runEffects()
  },

  retrySubmit() {
    this.applyViewModelResult(this.viewModel.retrySubmit())
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
    if (command.type === 'returnBankDetail') {
      this.returnBankDetail()
    }

    if (command.type === 'navigate' && command.url) {
      wx.navigateTo({
        url: command.url,
        fail: () => {
          wx.switchTab({
            url: HOME_PAGE_URL
          })
        }
      })
    }
  }
}, 'practice'))
