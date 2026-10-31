const navigation = require('../../utils/navigation.js')
const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { BankDetailViewModel } = require('../../viewmodels/bank-detail-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')

Page(withPageLifecycle({
  customHeader: true,
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

    // 题库是 tabBar 页面，拿不到 URL 参数：首页点科目时把 subjectId
    // 暂存在全局数据里，这里取走；取不到就沿用上次浏览的科目。
    const app = getApp()
    const pendingSubjectId = app && app.consumePendingSubjectId
      ? app.consumePendingSubjectId()
      : ''

    this.applyViewModelResult(this.viewModel.refreshRemote(pendingSubjectId || this.data.subjectId).then(result => {
      this.applyViewModelResult(result)
      return this.viewModel.restorePendingPractice()
    }))

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

  noop() {},

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
    this.applyViewModelResult(this.viewModel.refreshRemote(subjectId))
  },

  handleBanksMore() { return this.applyViewModelResult(this.viewModel.loadMoreBanks()) },
  handleSubjectsMore() { return this.applyViewModelResult(this.viewModel.loadMoreSubjects()) },
  handleRetryLoad() { return this.applyViewModelResult(this.viewModel.refreshRemote(this.data.subjectId, { force: true })) },
  onPullDownRefresh() { return this.handleRetryLoad().finally(() => wx.stopPullDownRefresh()) },
  onUnload() { clearTimeout(this.searchTimer) },

  handleImportTap() {
    wx.showToast({ title: '题库由平台统一维护', icon: 'none' })
  },

  /**
   * 输入原文由页面保存，搜索结果按请求关键词更新，保持光标位置。
   */
  handleSearchInput(e) {
    if (this.viewModel.repository.isRemoteEnabled && this.viewModel.repository.isRemoteEnabled()) {
      clearTimeout(this.searchTimer)
      const keyword = e.detail.value
      this.viewModel.remoteSearchText = keyword.trim()
      this.setData({ searchKeyword: keyword, searchLoading: !!keyword.trim(), searchActive: !!keyword.trim() })
      this.searchTimer = setTimeout(() => {
        Promise.resolve(this.viewModel.updateSearch(keyword)).then(result => this.applyViewModelResult(result))
          .catch(error => { if (this.viewModel.remoteSearchText === keyword.trim()) this.setData({ searchEmptyText: error.message }) })
          .finally(() => { if (this.viewModel.remoteSearchText === keyword.trim()) this.setData({ searchLoading: false }) })
      }, 250)
      return
    }
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
    clearTimeout(this.searchTimer)
    this.setData({ searchKeyword: '' })
    this.applyViewModelResult(this.viewModel.clearSearch())
  },

  handleSearchMore() {
    if (this.data.searchLoading || !this.data.searchHasMore) return
    this.setData({ searchLoading: true })
    return this.applyViewModelResult(this.viewModel.updateSearch(this.viewModel.remoteSearchText, (this.viewModel.remoteSearchPage || 1) + 1))
      .finally(() => this.setData({ searchLoading: false }))
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
    if (!banks.length && command.hasMore) return this.applyViewModelResult(this.viewModel.loadBankChoices(command.subjectId, command.remotePage + 1))
    if (!banks.length) return wx.showToast({ title: '当前没有可练习题库', icon: 'none' })
    const start = offset || 0
    const page = banks.slice(start, start + 5)
    const more = banks.length > 5 || command.hasMore || command.remotePage > 1
    wx.showActionSheet({
      itemList: page.map((bank) => bank.name).concat(more ? ['更多题库'] : []),
      success: (result) => {
        if (result.tapIndex === page.length) {
          if (start + 5 < banks.length) return this.chooseBank(command, start + 5)
          if (command.remotePage) return this.applyViewModelResult(this.viewModel.loadBankChoices(command.subjectId, command.hasMore ? command.remotePage + 1 : 1))
          return this.chooseBank(command, 0)
        }
        const bank = page[result.tapIndex]
        if (bank) this.applyViewModelResult(this.viewModel.openBankConfig(command.subjectId, bank.id))
      }
    })
  },

  handleViewModelCommand(command) {
    if (command.type === 'chooseBank') return this.chooseBank(command, 0)

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
    return navigation.navigateTo({ url: detail.url })
  }
}))
