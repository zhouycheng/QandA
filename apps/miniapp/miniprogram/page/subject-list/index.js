const { SubjectListViewModel } = require('../../viewmodels/subject-list-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { getInitialHomeHeaderData } = require('../../utils/home-header.js')
const ROUTE_LOADING_DELAY = 240

Page({
  data: Object.assign(SubjectListViewModel.getInitialData(), getInitialHomeHeaderData()),

  isNavigating: false,

  hasLoadedOnce: false,

  onLoad() {
    this.updateHeaderLayout()
    this.viewModel = new SubjectListViewModel({
      storage: createWxStorageAdapter()
    })
    this.refresh()
  },

  onResize() {
    this.updateHeaderLayout()
  },

  updateHeaderLayout() {
    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : null
    const menuButton = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null
    this.setData(getInitialHomeHeaderData(windowInfo, menuButton))
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
    this.applyViewModelResult(this.viewModel.refreshRemote())
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
    this.runSearch(e.detail.value, 300)
  },

  handleSearchConfirm(e) {
    this.runSearch(e.detail.value, 0)
  },

  runSearch(keyword, delay) {
    if (!this.viewModel.repository.isRemoteEnabled || !this.viewModel.repository.isRemoteEnabled()) return this.applyViewModelResult(this.viewModel.searchQuestions(keyword))
    if (this.searchTimer) clearTimeout(this.searchTimer)
    const revision = (this.searchRevision || 0) + 1
    this.searchRevision = revision
    const execute = () => {
      this.setData({ searchLoading: true })
      Promise.resolve(this.viewModel.searchQuestions(keyword)).then((result) => {
        if (this.searchRevision === revision) this.applyViewModelResult(result)
      }).catch((error) => {
        if (this.searchRevision === revision) wx.showToast({ title: error.message, icon: 'none' })
      }).finally(() => { if (this.searchRevision === revision) this.setData({ searchLoading: false }) })
    }
    if (delay) this.searchTimer = setTimeout(execute, delay)
    else execute()
  },

  handleSearchMore() {
    if (this.data.searchLoading) return
    this.setData({ searchLoading: true })
    const revision = this.searchRevision
    Promise.resolve(this.viewModel.loadMoreSearch()).then((result) => {
      if (this.searchRevision === revision) this.applyViewModelResult(result)
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' })).finally(() => { if (this.searchRevision === revision) this.setData({ searchLoading: false }) })
  },

  handleSearchClose() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchRevision = (this.searchRevision || 0) + 1
    this.setData({ searchLoading: false })
    this.applyViewModelResult(this.viewModel.closeSearch())
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchRevision = (this.searchRevision || 0) + 1
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

  handleRouteLoadingHide() {
    this.applyViewModelResult(this.viewModel.closeRouteLoading())
  },

  applyViewModelResult(result) {
    if (result && typeof result.then === 'function') {
      return result.then((value) => this.applyViewModelResult(value)).catch((error) => wx.showToast({ title: error.message || '请求失败', icon: 'none' }))
    }
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

  chooseBank(command, offset) {
    const banks = command.banks || []
    if (!banks.length) return wx.showToast({ title: '当前没有可练习题库', icon: 'none' })
    const start = offset || 0
    const page = banks.slice(start, start + 5)
    const more = banks.length > 5
    wx.showActionSheet({
      itemList: page.map((bank) => bank.name).concat(more ? ['更多题库'] : []),
      success: (result) => {
        if (result.tapIndex === page.length) return this.chooseBank(command, start + 5 < banks.length ? start + 5 : 0)
        const bank = page[result.tapIndex]
        if (bank) this.applyViewModelResult(this.viewModel.openMock(bank.id))
      }
    })
  },

  choosePractice(command, offset) {
    const start = offset || 0
    const page = command.choices.slice(start, start + 5)
    const hasNavigation = command.choices.length > 5
    wx.showActionSheet({
      itemList: page.map(item => item.label).concat(hasNavigation ? [start + 5 < command.choices.length ? '更多练习' : '返回第一组'] : []),
      success: result => {
        if (result.tapIndex === page.length) return this.choosePractice(command, start + 5 < command.choices.length ? start + 5 : 0)
        const selected = page[result.tapIndex]
        if (selected) this.applyViewModelResult(this.viewModel.openPractice(`/page/practice/index?sessionId=${encodeURIComponent(selected.id)}`, selected.label))
      }
    })
  },

  handleViewModelCommand(command) {
    if (command.type === 'choosePractice') return this.choosePractice(command, 0)
    if (command.type === 'chooseBank') return this.chooseBank(command, 0)

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
