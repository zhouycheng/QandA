const { SettingsViewModel } = require('../../viewmodels/settings-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const SECTION_IDS = {
  practice: 'section-practice',
  layout: 'choice-answerLayout',
  exam: 'section-exam',
  data: 'section-data',
  about: 'section-about'
}

// Playground 是开发工具，入口藏在「连点版本号 5 次」后面，避免线上界面出现冗余按钮
const VERSION_UNLOCK_TAPS = 5
const VERSION_TAP_WINDOW = 1500

Page({
  data: Object.assign(SettingsViewModel.getInitialData(), {
    // 版本号由页面从全局配置读取，ViewModel 不参与，避免被初始值覆盖
    version: '',
    // 从「我的」页带着 focus 进来时，直接滚到对应分组
    scrollTarget: '',
    // 日期选择器不允许选过去
    todayDateKey: ''
  }),

  onLoad(options) {
    this.viewModel = new SettingsViewModel({
      storage: createWxStorageAdapter()
    })

    const app = getApp()
    const version = app && app.globalData ? app.globalData.version : ''
    const focus = options && options.focus

    this.setData({
      version,
      scrollTarget: SECTION_IDS[focus] || '',
      todayDateKey: this.viewModel.getTodayDateKey()
    })

    this.applyViewModelResult(this.viewModel.load())
  },

  /**
   * 从登录页返回时要刷新登录态。
   * 设置页没有这一条的话，登录完回到这里，状态标签还停在「未登录」。
   */
  onShow() {
    if (this.viewModel) {
      this.applyViewModelResult(this.viewModel.load())
    }
  },

  handleSwitchChange(e) {
    const key = e.currentTarget.dataset.key
    this.applyViewModelResult(this.viewModel.toggleSwitch(key, e.detail.value))
  },

  handleChoiceTap(e) {
    const dataset = e.currentTarget.dataset
    this.applyViewModelResult(this.viewModel.selectChoice(dataset.key, dataset.value))
  },

  handleResetPreferences() {
    wx.showModal({
      title: '恢复默认设置',
      content: '将把学习偏好恢复为初始状态，已选的字号与音色会重置。确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.resetPreferences())
        }
      }
    })
  },

  handleClearRecords() {
    wx.showModal({
      title: '清空学习数据',
      content: '将清空本机的做题进度、错题本、收藏、学习时长与历史最佳成绩，且无法恢复。学习偏好与登录状态会保留。确定继续吗？',
      confirmText: '清空',
      confirmColor: '#f04438',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.clearRecords())
        }
      }
    })
  },

  /** 考试名称放 bindblur：放 bindinput 会每敲一个字写一次 storage */
  handleExamNameBlur(e) {
    this.applyViewModelResult(this.viewModel.setExamName(e.detail.value))
  },

  handleExamDateChange(e) {
    this.applyViewModelResult(this.viewModel.setExamDate(e.detail.value))
  },

  handleClearExam() {
    wx.showModal({
      title: '清除考试倒计时',
      content: '首页将不再显示倒计时，可以随时重新设置。',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.clearExam())
        }
      }
    })
  },

  /** 连点版本号：够 5 次就解锁 Playground。间隔超过 1.5s 重新计数，防误触 */
  handleVersionTap() {
    clearTimeout(this.versionTapTimer)
    this.versionTapTimer = setTimeout(() => {
      this.versionTaps = 0
    }, VERSION_TAP_WINDOW)

    this.versionTaps = (this.versionTaps || 0) + 1

    if (this.versionTaps >= VERSION_UNLOCK_TAPS) {
      this.versionTaps = 0
      clearTimeout(this.versionTapTimer)
      this.applyViewModelResult(this.viewModel.unlockPlayground())
    }
  },

  handlePlaygroundTap() {
    this.applyViewModelResult(this.viewModel.openPlayground())
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }

    if (result.command && result.command.type === 'toast') {
      wx.showToast({
        title: result.command.title || '操作完成',
        icon: 'none',
        duration: 1800
      })
    }

    if (result.command && result.command.type === 'navigate' && result.command.url) {
      wx.navigateTo({
        url: result.command.url
      })
    }
  }
})
