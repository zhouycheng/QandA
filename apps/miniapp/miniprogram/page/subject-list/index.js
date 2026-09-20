const { SubjectListViewModel } = require('../../viewmodels/subject-list-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

const ROUTE_LOADING_DELAY = 240

Page(wrapTaps({
  data: Object.assign(SubjectListViewModel.getInitialData(), {
    // 纯 UI 状态，不需要进 ViewModel
    tipSheetVisible: false
  }),

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

    // 从答题页返回时重新读取进度，保证统计实时
    if (this.hasLoadedOnce && this.viewModel) {
      this.refresh()
    }

    this.hasLoadedOnce = true
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

  handleRouteLoadingHide() {
    this.applyViewModelResult(this.viewModel.closeRouteLoading())
  },

  /** 点击公告条：展开完整说明，而不是直接跳走 */
  handleTipOpen() {
    const tip = this.data.home && this.data.home.tip

    if (!tip) {
      return
    }

    this.setData({
      tipSheetVisible: true
    })
  },

  handleTipSheetClose() {
    this.setData({
      tipSheetVisible: false
    })
  },

  /** 弹层里的行动按钮：按文案层给出的 action 决定去向 */
  handleTipAction() {
    const tip = this.data.home && this.data.home.tip

    this.setData({
      tipSheetVisible: false
    })

    if (tip) {
      this.applyViewModelResult(this.viewModel.openTipAction(tip.action))
    }
  },

  /** 学习数据卡右上角「详情」→ 统计 */
  handleOpenStats() {
    this.applyViewModelResult(this.viewModel.openStats())
  },

  /** 学习数据卡「去刷题」→ 题库（保留题库页当前科目） */
  handleGoBank() {
    this.applyViewModelResult(this.viewModel.openBank())
  },

  /** 指标格：错题格进错题本，其余进统计页 */
  handleMetricTap(e) {
    const target = e.currentTarget.dataset.target

    if (target === 'wrong') {
      this.applyViewModelResult(this.viewModel.openWrongBook())
      return
    }

    this.applyViewModelResult(this.viewModel.openStats())
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
    this.setData({
      routeLoadingVisible: true,
      routeLoadingTitle: detail.title || '正在打开',
      routeLoadingDescription: detail.description || ''
    })

    setTimeout(() => {
      wx.navigateTo({
        url: detail.url,
        complete: () => {
          this.setData({
            routeLoadingVisible: false
          })
        }
      })
    }, ROUTE_LOADING_DELAY)
  }
}, 'subject-list'))
