const { WrongBookViewModel } = require('../../viewmodels/wrong-book-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: WrongBookViewModel.getInitialData(),

  onLoad(options) {
    this.viewModel = new WrongBookViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load(options))
  },

  onShow() {
    if (!this.viewModel) {
      return
    }

    this.applyViewModelResult(this.viewModel.refresh({}))
  },

  // 下拉刷新：保持当前 tab 与筛选，只重读数据
  onPullDownRefresh() {
    if (!this.viewModel) {
      wx.stopPullDownRefresh()
      return
    }

    this.applyViewModelResult(this.viewModel.refresh({}))
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 400)
  },

  onTabChange(e) {
    const tabKey = e.currentTarget.dataset.tab
    this.applyViewModelResult(this.viewModel.switchTab(tabKey))
  },

  onFilterChange(e) {
    const filterKey = e.currentTarget.dataset.filter
    this.applyViewModelResult(this.viewModel.switchFilter(filterKey))
  },

  onRemove(e) {
    const questionId = e.currentTarget.dataset.id
    this.applyViewModelResult(this.viewModel.removeItem(questionId))
  },

  onToggleFavorite(e) {
    const questionId = e.currentTarget.dataset.id
    this.applyViewModelResult(this.viewModel.toggleFavorite(questionId))
  },

  handlePractice() {
    this.applyViewModelResult(this.viewModel.createPracticeCommand())
  },

  handleClear() {
    const isWrongTab = this.data.activeTab === 'wrong'

    wx.showModal({
      title: isWrongTab ? '移除错题' : '清空收藏',
      content: isWrongTab ? '将移除当前列表中的错题记录，确定继续吗？' : '将清空全部收藏，确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.clearCurrent())
        }
      }
    })
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    const runEffects = () => {
      this.applyViewModelEffects(result)
    }

    if (result.data) {
      this.setData(result.data, () => {
        this.syncNavigationTitle(result.data.activeTab)
        runEffects()
      })
      return
    }

    runEffects()
  },

  syncNavigationTitle(activeTab) {
    if (!activeTab) {
      return
    }

    wx.setNavigationBarTitle({
      title: activeTab === 'favorite' ? '我的收藏' : '错题本'
    })
  },

  applyViewModelEffects(result) {
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
}, 'wrong-book'))
