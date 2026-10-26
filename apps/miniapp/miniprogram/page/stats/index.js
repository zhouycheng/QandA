const { StatsViewModel } = require('../../viewmodels/stats-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: StatsViewModel.getInitialData(),

  onLoad() {
    this.viewModel = new StatsViewModel({
      storage: createWxStorageAdapter()
    })
  },

  // tab 页每次切回来都重新汇总，保证练习后的数据即时可见
  onShow() {
    if (!this.viewModel) {
      return
    }

    this.syncTabBar()
    this.applyViewModelResult(this.viewModel.load())
  },

  /** 自定义 tabBar 不会自动跟随页面切换，选中态要由页面主动同步 */
  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setSelected === 'function') {
      tabBar.setSelected('page/stats/index')
    }
  },

  // 下拉刷新：重新汇总一遍本地数据
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    this.applyViewModelResult(this.viewModel.load())
    this.finishPullDownRefresh()
  },

  /**
   * 立刻 stop 会让「正在刷新」一闪而过，反而显得敷衍。
   * 留 400ms 让用户看清反馈再收回，手感才完整。
   */
  finishPullDownRefresh() {
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 400)
  },

  handleOpenWrongBook(e) {
    const tab = e.currentTarget.dataset.tab === 'favorite' ? 'favorite' : 'wrong'

    wx.navigateTo({
      url: `/page/wrong-book/index?tab=${tab}`
    })
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
        icon: 'none'
      })
    }
  }
}, 'stats'))
