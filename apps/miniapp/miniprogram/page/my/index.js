const { MyViewModel } = require('../../viewmodels/my-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: Object.assign(MyViewModel.getInitialData(), {
    // 版本号由页面维护，ViewModel 不参与，避免被初始值覆盖
    version: ''
  }),

  onLoad() {
    this.viewModel = new MyViewModel({
      storage: createWxStorageAdapter()
    })

    // 版本号来自全局配置，不放在 ViewModel 里以免依赖 getApp()
    const app = getApp()
    const version = app && app.globalData ? app.globalData.version : ''

    if (version) {
      this.setData({ version })
    }

    this.applyViewModelResult(this.viewModel.load())
  },

  onShow() {
    if (!this.viewModel) {
      return
    }

    this.applyViewModelResult(this.viewModel.load())
  },

  // 下拉刷新
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    this.applyViewModelResult(this.viewModel.load())
    // 留一小会儿让「正在刷新」被看到，避免指示器一闪而过
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

  /** 学习偏好 / 账户与安全 / 关于 都在设置页，用 focus 指定滚动到的分组 */
  handleOpenSettings(e) {
    const focus = e.currentTarget.dataset.focus || ''

    wx.navigateTo({
      url: focus ? `/page/settings/index?focus=${focus}` : '/page/settings/index'
    })
  },

  handleClearRecords() {
    wx.showModal({
      title: '清空学习数据',
      content: '将清空本机的做题进度、错题本、收藏、学习时长与历史最佳成绩，且无法恢复。学习偏好不属于学习数据，会保留。确定继续吗？',
      confirmText: '清空',
      confirmColor: '#f04438',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.clearRecords())
        }
      }
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
}, 'my'))
