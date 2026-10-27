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

    if (!this.hasLoadedOnce) {
      this.hasLoadedOnce = true
      this.applyViewModelResult(this.viewModel.load(pendingSubjectId || this.data.subjectId))
      return
    }

    // 从答题页返回或跨 tab 切换时刷新进度统计。
    // 「最近在刷」是一个视图状态，刷新时不能把它顶回普通科目（否则列表会在
    // 用户没做任何操作的情况下跳走），所以交给 refresh 按当前状态决定。
    if (pendingSubjectId) {
      this.applyViewModelResult(this.viewModel.switchSubject(pendingSubjectId))
      return
    }

    this.applyViewModelResult(this.viewModel.refresh(this.data))
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
   * 答题配置抽屉底部的「开始答题」原本会被底栏压着，自定义 tabBar 是独立图层，
   * 页面内弹层躲不开，只能让它先让位。
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

  handleRecentTap() {
    this.applyViewModelResult(this.viewModel.enterRecent())
  },

  handleSubjectSwitch(e) {
    const subjectId = e.currentTarget.dataset.subjectId

    if (!subjectId) {
      return
    }

    // 已经在看这个科目、且不是「最近在刷」状态时不需要重建
    if (subjectId === this.data.subjectId && this.data.railMode === 'subject') {
      return
    }

    this.applyViewModelResult(this.viewModel.switchSubject(subjectId))
  },

  handleImportTap() {
    wx.navigateTo({
      url: '/page/import-bank/index'
    })
  },

  /**
   * 搜索是纯本地过滤，逐字触发。回写的 searchKeyword 是去掉首尾空格后的值，
   * 直接 setData 会在用户敲空格时把光标拽回行尾，所以只回写结果、不动输入框。
   */
  handleSearchInput(e) {
    const result = this.viewModel.updateSearch(e.detail.value)

    if (!result || !result.data) {
      return
    }

    const data = Object.assign({}, result.data)
    delete data.searchKeyword
    this.setData(data)
  },

  handleSearchConfirm(e) {
    this.handleSearchInput(e)

    if (typeof wx.hideKeyboard === 'function') {
      wx.hideKeyboard({})
    }
  },

  handleSearchClear() {
    this.setData({ searchKeyword: '' })
    this.applyViewModelResult(this.viewModel.clearSearch())
  },

  handleFilterToggle() {
    this.applyViewModelResult(this.viewModel.toggleFilter())
  },

  /** 章节行点击 → 打开这一章的答题配置 */
  handleBankOpen(e) {
    const bank = e.detail && e.detail.bank
    const subjectId = this.data.subjectId

    if (!bank || !bank.bankId) {
      return
    }

    this.applyViewModelResult(this.viewModel.openBankConfig(subjectId, bank.bankId))
  },

  /** 搜索结果可能属于别的科目，科目 id 从行数据取，不能用手上的 data.subjectId */
  handleSearchResultTap(e) {
    const dataset = e.currentTarget.dataset

    if (!dataset || !dataset.bankId) {
      return
    }

    this.applyViewModelResult(this.viewModel.openBankConfig(dataset.subjectId, dataset.bankId))
  },

  /** 统计卡 = 整科练习的入口（设计稿没有独立按钮，卡片右上角标了「整科」） */
  handleStatTap() {
    this.applyViewModelResult(this.viewModel.openSubjectConfig(this.data.subjectId))
  },

  handleSheetMode(e) {
    this.applyViewModelResult(this.viewModel.setSheetMode(e.currentTarget.dataset.value))
  },

  handleSheetOrder(e) {
    if (this.data.sheetOrderDisabled) {
      wx.showToast({
        title: '背题模式固定按顺序',
        icon: 'none'
      })
      return
    }

    this.applyViewModelResult(this.viewModel.setSheetOrder(e.currentTarget.dataset.value))
  },

  handleSheetTimed(e) {
    this.applyViewModelResult(this.viewModel.setSheetTimed(e.detail.value))
  },

  handleSheetDuration(e) {
    const value = e.currentTarget.dataset.value
    const result = this.viewModel.selectDuration(value)

    if (result) {
      this.applyViewModelResult(result)
    }
  },

  handleSheetOnlyWrong(e) {
    this.applyViewModelResult(this.viewModel.setSheetOnlyWrong(e.detail.value))
  },

  handleSheetClose() {
    this.applyViewModelResult(this.viewModel.closeConfig())
  },

  handleConfigConfirm() {
    this.applyViewModelResult(this.viewModel.confirmConfig(this.data))
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)

      // 抽屉的显示由 ViewModel 决定（打开/取消/确认三条路径都会下发），
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
