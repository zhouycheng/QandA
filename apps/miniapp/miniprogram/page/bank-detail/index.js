const { BankDetailViewModel } = require('../../viewmodels/bank-detail-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

const ROUTE_LOADING_DELAY = 240

Page(wrapTaps({
  data: BankDetailViewModel.getInitialData(),

  isOpeningPractice: false,

  hasLoadedOnce: false,

  onLoad() {
    this.viewModel = new BankDetailViewModel({
      storage: createWxStorageAdapter()
    })
  },

  onShow() {
    this.isOpeningPractice = false

    // 题库是 tabBar 页面，拿不到 URL 参数：首页点科目时把 subjectId
    // 暂存在全局数据里，这里取走；取不到就沿用上次浏览的科目。
    const app = getApp()
    const pendingSubjectId = app && app.consumePendingSubjectId
      ? app.consumePendingSubjectId()
      : ''
    const subjectId = pendingSubjectId || this.data.subjectId

    if (!this.hasLoadedOnce) {
      this.hasLoadedOnce = true
      this.applyViewModelResult(this.viewModel.load(subjectId))
      return
    }

    // 从答题页返回或跨 tab 切换时刷新进度统计
    if (subjectId) {
      this.applyViewModelResult(this.viewModel.switchSubject(subjectId))
    }
  },

  onShareAppMessage() {
    return this.viewModel.getShareMessage(this.data.subjectId)
  },

  handleSubjectSwitch(e) {
    const subjectId = e.currentTarget.dataset.subjectId

    if (!subjectId || subjectId === this.data.subjectId) {
      return
    }

    this.applyViewModelResult(this.viewModel.switchSubject(subjectId))
  },

  handleImportTap() {
    wx.navigateTo({
      url: '/page/import-bank/index'
    })
  },

  handleModeSelect(e) {
    this.applyViewModelResult(this.viewModel.selectMode(e.currentTarget.dataset.mode))
  },

  handleBankOpen(e) {
    const bank = e.detail && e.detail.bank
    this.applyViewModelResult(this.viewModel.openBank(bank))
  },

  handleStartTap() {
    this.applyViewModelResult(this.viewModel.startPractice(this.data))
  },

  handleTestTap() {
    this.applyViewModelResult(this.viewModel.openTestConfig())
  },

  handleCountSelect(e) {
    const value = e.currentTarget.dataset.value
    this.applyViewModelResult(this.viewModel.selectCount(value))
  },

  handleDurationSelect(e) {
    const value = e.currentTarget.dataset.value
    this.applyViewModelResult(this.viewModel.selectDuration(value))
  },

  handleConfigConfirm() {
    this.applyViewModelResult(this.viewModel.confirmConfig(this.data))
  },

  handleSheetClose() {
    this.applyViewModelResult(this.viewModel.closeConfig())
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }

    if (result.command) {
      this.handleViewModelCommand(result.command)
    }
  },

  handleViewModelCommand(command) {
    // 题库是 tabBar 页面，没有可返回的上一页，出错时只用 toast 提示
    if (command.type === 'toast') {
      wx.showToast({
        title: command.title || '操作失败',
        icon: 'none'
      })
      return
    }

    if (command.type === 'openRouteWithLoading') {
      this.openRouteWithLoading(command.payload)
    }
  },

  openRouteWithLoading(payload) {
    const detail = payload || {}
    this.isOpeningPractice = true
    this.setData({
      routeLoadingVisible: true,
      routeLoadingTitle: detail.title || '正在打开',
      routeLoadingDescription: detail.description || ''
    })

    setTimeout(() => {
      wx.navigateTo({
        url: detail.url,
        complete: () => {
          this.setData({
            routeLoadingVisible: false
          })
        }
      })
    }, ROUTE_LOADING_DELAY)
  }
}, 'bank-detail'))
