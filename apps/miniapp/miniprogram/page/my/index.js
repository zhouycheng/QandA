const navigation = require('../../utils/navigation.js')
const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { MyViewModel } = require('../../viewmodels/my-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
Page(withPageLifecycle({
  customHeader: true,
  data: MyViewModel.getInitialData(),

  onLoad() {
    const app = getApp()
    const version = app && app.globalData ? app.globalData.version : ''

    this.viewModel = new MyViewModel({
      storage: createWxStorageAdapter()
    })

    // 版本号来自全局配置，ViewModel 不依赖 getApp()，由页面注入
    this.viewModel.setVersion(version)
  },

  onShow() {
    if (!this.viewModel) {
      return
    }

    this.syncTabBar()
    this.applyViewModelResult(this.viewModel.load())
    this.applyViewModelResult(this.viewModel.refreshRemote())
  },

  onUnload() {
  },

  /** 自定义 tabBar 不会自动跟随页面切换，选中态要由页面主动同步 */
  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setSelected === 'function') {
      tabBar.setSelected('page/my/index')
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    return this.applyViewModelResult(this.viewModel.refreshRemote({ force: true })).finally(() => wx.stopPullDownRefresh())
  },

  /** 资料头：未登录去登录页，已登录进账号管理 */
  handleProfileTap() {
    this.applyViewModelResult(this.viewModel.tapRow('profile'))
  },

  handleAccountTap() {
    this.applyViewModelResult(this.viewModel.tapRow('account'))
  },

  handleRowTap(e) {
    const key = e.currentTarget.dataset.key
    this.applyViewModelResult(this.viewModel.tapRow(key))
  },

  confirmLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后本机的做题进度、错题与收藏都会保留，下次登录还能接着做。',
      confirmText: '退出',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.logout())
        }
      }
    })
  },

  handleSheetClose() {
    this.applyViewModelResult(this.viewModel.closeSheet())
  },

  handleVersionTap() {
    const now = Date.now()
    this.versionTaps = now - (this.versionTappedAt || 0) < 1500 ? (this.versionTaps || 0) + 1 : 1
    this.versionTappedAt = now
    if (this.versionTaps === 5) { this.versionTaps = 0; this.applyViewModelResult(this.viewModel.unlockPlayground()) }
  },

  handlePlaygroundTap() {
    this.applyViewModelResult(this.viewModel.openPlayground())
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

    if (!result.command) {
      return
    }

    if (result.command.type === 'toast') {
      wx.showToast({
        title: result.command.title || '操作完成',
        icon: 'none'
      })
      return
    }

    if (result.command.type === 'navigate' && result.command.url) {
      navigation.navigateTo({
        url: result.command.url
      })
    }
  }
}))
