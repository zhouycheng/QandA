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
    this.syncTabBar()
    // 兜底：上次若是「弹层没关就跳走」，回来时底栏必须还在
    this.setTabBarHidden(false)

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

  /**
   * 自定义 tabBar 的选中态要由页面主动同步，否则跨 tab 切换后高亮还停在旧页。
   */
  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setSelected === 'function') {
      tabBar.setSelected('page/bank-detail/index')
    }
  },

  /**
   * 弹层打开时收起底栏。
   * 抽题设置面板（bottom-sheet）底部的「开始测试」按钮原本被底栏压着，
   * 自定义 tabBar 是独立图层，页面内弹层躲不开，只能让它先让位。
   */
  setTabBarHidden(hidden) {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setHidden === 'function') {
      tabBar.setHidden(hidden)
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

  // 错题本与收藏原先挂在「我的」页，现归到题库页左栏（与科目同一区域）
  handleWrongBookTap() {
    wx.navigateTo({
      url: '/page/wrong-book/index?tab=wrong'
    })
  },

  handleFavoriteTap() {
    wx.navigateTo({
      url: '/page/wrong-book/index?tab=favorite'
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

      // 抽题设置面板的显示由 ViewModel 决定（打开/取消/确认三条路径都会下发），
      // 这里跟着它的值同步底栏显隐，不用在每个处理函数里各写一遍。
      if (result.data.configSheetVisible !== undefined) {
        this.setTabBarHidden(!!result.data.configSheetVisible)
      }
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
    // 加载遮罩也是 fixed 浮层，同样会被底栏压在下面，一并收起
    this.setTabBarHidden(true)
    this.setData({
      routeLoadingVisible: true,
      routeLoadingTitle: detail.title || '正在打开',
      routeLoadingDescription: detail.description || ''
    })

    setTimeout(() => {
      wx.navigateTo({
        url: detail.url,
        complete: () => {
          this.setTabBarHidden(false)
          this.setData({
            routeLoadingVisible: false
          })
        }
      })
    }, ROUTE_LOADING_DELAY)
  }
}, 'bank-detail'))
