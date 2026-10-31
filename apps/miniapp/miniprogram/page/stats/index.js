const navigation = require('../../utils/navigation.js')
const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { StatsViewModel } = require('../../viewmodels/stats-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
/**
 * 复盘页（路由仍是 page/stats/index，tabBar 文案叫「复盘」）。
 * 只读汇总，不产生任何写副作用。
 */
Page(withPageLifecycle({
  customHeader: true,
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
    // 底栏是四个 tab 共用的一条实例：别的页开着弹层切过来时可能还是隐藏态，这里兜底恢复
    this.applyViewModelResult(this.viewModel.load())
    this.applyViewModelResult(this.viewModel.refreshRemote())
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


  /** 切换区间：只重算三个数字与趋势图，热力图和身份不重算 */
  handleRangeTap(e) {
    if (!this.viewModel || this.data.requiresLogin) {
      return
    }

    this.applyViewModelResult(this.viewModel.setRange(e.currentTarget.dataset.value))
    this.applyViewModelResult(this.viewModel.refreshRemote())
  },

  /**
   * 错题本 / 收藏本：各是一个独立页面，带 type 参数进去。
   * 复盘页是 tab 页，navigateTo 会让底栏留在下面 —— 那两个页面不是 tab，这样才符合层级。
   */
  handleEntryTap(e) {
    if (this.data.requiresLogin) return this.handleLoginTap()
    const url = e.currentTarget.dataset.url

    if (!url) {
      return
    }

    navigation.navigateTo({ url })
  },

  handleLoginTap() { navigation.navigateTo({ url: '/page/login/index' }) },

  // 下拉刷新：重新汇总一遍本地数据
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    return this.applyViewModelResult(this.viewModel.refreshRemote({ force: true })).finally(() => wx.stopPullDownRefresh())
  },

  handleRetryLoad() { return this.applyViewModelResult(this.viewModel.refreshRemote({ force: true })) },

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

    if (result.command && result.command.type === 'toast') {
      wx.showToast({
        title: result.command.title || '操作完成',
        icon: 'none'
      })
    }
  }
}))
