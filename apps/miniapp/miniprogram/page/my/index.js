const { MyViewModel } = require('../../viewmodels/my-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
Page({
  data: MyViewModel.getInitialData(),

  onLoad() {
    const app = getApp()
    const version = app && app.globalData ? app.globalData.version : ''

    this.viewModel = new MyViewModel({
      storage: createWxStorageAdapter()
    })

    // 版本号来自全局配置，ViewModel 不依赖 getApp()，由页面注入
    this.viewModel.setVersion(version)
    this.applyViewModelResult(this.viewModel.load())
    this.applyViewModelResult(this.viewModel.refreshRemote())
  },

  onShow() {
    if (!this.viewModel) {
      return
    }

    this.syncTabBar()
    // 弹层没关就跳走会让底栏永久消失，回页面必须兜底恢复
    this.setTabBarHidden(false)
    this.applyViewModelResult(this.viewModel.load())
    this.applyViewModelResult(this.viewModel.refreshRemote())
  },

  onUnload() {
    this.setTabBarHidden(false)
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

  /** 自定义 tabBar 永远盖在页面之上，弹层要让它先躲开 */
  setTabBarHidden(hidden) {
    if (typeof this.getTabBar !== 'function') {
      return
    }

    const tabBar = this.getTabBar()

    if (tabBar && typeof tabBar.setHidden === 'function') {
      tabBar.setHidden(hidden)
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    this.applyViewModelResult(this.viewModel.load())
    this.applyViewModelResult(this.viewModel.refreshRemote())
    // 留一小会儿让「正在刷新」被看到，避免指示器一闪而过
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 400)
  },

  /** 资料头：未登录去登录页，已登录进账号管理 */
  handleProfileTap() {
    this.applyViewModelResult(this.viewModel.tapRow('profile'))
  },

  handleAccountTap() {
    this.applyViewModelResult(this.viewModel.tapRow('account'))
  },

  /**
   * 列表行。
   * 退出登录要二次确认——它是不可逆的身份操作，误触后要重新走登录流程。
   */
  handleRowTap(e) {
    const key = e.currentTarget.dataset.key

    if (key === 'logout') {
      this.confirmLogout()
      return
    }

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
      // setData 之后 this.data 已同步，弹层开着就把底栏藏起来
      this.setTabBarHidden(!!this.data.sheet)
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
      wx.navigateTo({
        url: result.command.url
      })
    }
  }
})
