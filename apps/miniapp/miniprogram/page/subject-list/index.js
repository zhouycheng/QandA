const { SubjectListViewModel } = require('../../viewmodels/subject-list-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const ROUTE_LOADING_DELAY = 240

Page({
  data: SubjectListViewModel.getInitialData(),

  isNavigating: false,

  hasLoadedOnce: false,

  onLoad() {
    this.viewModel = new SubjectListViewModel({
      storage: createWxStorageAdapter()
    })
    this.refresh()
  },

  onShow() {
    this.isNavigating = false
    this.syncTabBar()
    // 兜底：万一上次是「弹层没关就跳走」，回来时底栏必须还在
    this.setTabBarHidden(false)

    // 从答题页返回时重新读取进度，保证统计实时
    if (this.hasLoadedOnce && this.viewModel) {
      this.refresh()
    }

    this.hasLoadedOnce = true
  },

  /**
   * 自定义 tabBar 不会自动跟随页面切换，必须由页面 onShow 主动同步选中态。
   * 不写这段的话：从首页跳到题库，底栏仍然高亮「首页」。
   */
  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setSelected === 'function') {
      tabBar.setSelected('page/subject-list/index')
    }
  },

  /**
   * 弹层打开时收起底栏。
   * 自定义 tabBar 是独立图层，页面里的 fixed 弹层永远在它下面，
   * 不收起就会出现「公告正文和按钮被底栏压住」。
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
    return this.viewModel.getShareMessage()
  },

  // 下拉刷新
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    this.refresh()
    // 留 400ms 让「正在刷新」被看到再收回，避免指示器一闪而过
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 400)
  },

  refresh() {
    this.applyViewModelResult(this.viewModel.load())
  },

  handleContinueTap() {
    const lastPractice = this.data.lastPractice

    if (!lastPractice) {
      return
    }

    this.applyViewModelResult(this.viewModel.openPractice(lastPractice.url, lastPractice.title))
  },

  // ---------- 倒计时卡 ----------

  /**
   * 已设置 → 直接进设置页修改；未设置 → 同样进设置页，由 ?focus=exam 自动聚焦分组。
   * 两种情况都走同一个入口，不因为状态不同而分成「看详情」和「去设置」两条路。
   */
  handleExamTap() {
    this.applyViewModelResult(this.viewModel.openExamSettings())
  },

  // ---------- 我的学习空间 ----------

  handleEntryTap(e) {
    const key = e.currentTarget.dataset.key

    if (!key) {
      return
    }

    this.applyViewModelResult(this.viewModel.openEntry(key))
  },

  // ---------- 搜索 ----------

  handleOpenSearch() {
    if (this.data.searchVisible) {
      return
    }

    this.applyViewModelResult(this.viewModel.openSearch())
  },

  /**
   * 输入即搜。放到 bindinput 而不是 bindconfirm：
   * 题库只有 200 多题，每次击键全表扫描也就几毫秒，
   * 但体验上「边打边看到结果」比「打完再按回车」好得多。
   * （对比：题库导入页的 textarea 必须放 bindblur，那里解析的是整张表。）
   */
  handleSearchInput(e) {
    this.applyViewModelResult(this.viewModel.searchQuestions(e.detail.value))
  },

  handleSearchConfirm(e) {
    this.applyViewModelResult(this.viewModel.searchQuestions(e.detail.value))
  },

  handleSearchClose() {
    this.applyViewModelResult(this.viewModel.closeSearch())
  },

  handleSearchResultTap(e) {
    const questionId = e.currentTarget.dataset.id

    if (!questionId) {
      return
    }

    // 先进面板再跳转：面板是 fixed 定位，跳页后仍留在这个 tab 的 DOM 里
    this.applyViewModelResult(this.viewModel.closeSearch())
    this.applyViewModelResult(this.viewModel.openSearchResult(questionId))
  },

  // ---------- 公告（小喇叭） ----------

  handleAnnouncementTap() {
    this.setTabBarHidden(true)
    this.applyViewModelResult(this.viewModel.openAnnouncement())
  },

  handleAnnouncementClose() {
    this.setTabBarHidden(false)
    this.applyViewModelResult(this.viewModel.closeAnnouncement())
  },

  /** 公告里的行动按钮：按文案层给的 action 决定去向 */
  handleAnnouncementAction() {
    const tip = this.data.home && this.data.home.tip

    this.setTabBarHidden(false)
    this.applyViewModelResult(this.viewModel.closeAnnouncement())

    if (tip) {
      this.applyViewModelResult(this.viewModel.openTipAction(tip.action))
    }
  },

  handleRouteLoadingHide() {
    this.applyViewModelResult(this.viewModel.closeRouteLoading())
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
    if (command.type === 'toast') {
      wx.showToast({
        title: command.title || '操作失败',
        icon: 'none'
      })
      return
    }

    if (command.type === 'openRouteWithLoading') {
      this.openRouteWithLoading(command.payload)
      return
    }

    if (command.type === 'switchTab') {
      wx.switchTab({
        url: command.url,
        fail: () => {
          wx.showToast({
            title: '页面暂不可用',
            icon: 'none'
          })
        }
      })
    }
  },

  openRouteWithLoading(payload) {
    const detail = payload || {}
    this.isNavigating = true
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
})
