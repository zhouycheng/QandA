const { WrongBookViewModel } = require('../../viewmodels/wrong-book-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

/**
 * 错题本 / 收藏本（设计稿两张画板）。
 * 路由仍是 page/wrong-book/index，靠 `?type=wrong|favorite` 区分两种模式 ——
 * 复盘页的两张入口卡分别带着这两个参数进来。
 */
Page(wrapTaps({
  data: WrongBookViewModel.getInitialData(),

  onLoad(options) {
    this.viewModel = new WrongBookViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load(options))
  },

  // 从题目详情返回时重新读一遍：可能刚取消过收藏
  onShow() {
    if (!this.viewModel) {
      return
    }

    this.applyViewModelResult(this.viewModel.refresh({}))
  },

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

  handleManageTap() {
    this.applyViewModelResult(this.viewModel.toggleManage())
  },

  handleSubjectMenuTap() {
    this.applyViewModelResult(this.viewModel.toggleSubjectMenu())
  },

  handleSubjectPick(e) {
    this.applyViewModelResult(this.viewModel.setSubject(e.currentTarget.dataset.id))
  },

  // 排序只有两种口径，点一下就能换，不值得做成下拉
  handleSortTap() {
    this.applyViewModelResult(this.viewModel.toggleSort())
  },

  handleChipTap(e) {
    this.applyViewModelResult(this.viewModel.setChip(e.currentTarget.dataset.key))
  },

  handlePrevPage() {
    this.applyViewModelResult(this.viewModel.goPrevPage())
  },

  handleNextPage() {
    this.applyViewModelResult(this.viewModel.goNextPage())
  },

  handleItemTap(e) {
    const questionId = e.currentTarget.dataset.id

    if (!questionId) {
      return
    }

    wx.navigateTo({
      url: `/page/question-detail/index?id=${encodeURIComponent(questionId)}`
    })
  },

  handleRemoveTap(e) {
    const questionId = e.currentTarget.dataset.id
    const isWrong = this.data.type === 'wrong'

    wx.showModal({
      title: isWrong ? '移出错题本' : '取消收藏',
      content: isWrong ? '移出后这道题不再出现在错题本里，确定继续吗？' : '确定取消收藏这道题吗？',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.removeItem(questionId))
        }
      }
    })
  },

  // 管理态下主按钮是「清空」，非管理态是「开始练习」
  handleFooterTap() {
    if (!this.data.manage) {
      this.applyViewModelResult(this.viewModel.createPracticeCommand())
      return
    }

    const isWrong = this.data.type === 'wrong'

    wx.showModal({
      title: isWrong ? '清空错题本' : '清空收藏',
      content: isWrong
        ? `将移除全部 ${this.data.totalCount} 道错题记录，确定继续吗？`
        : `将清空全部 ${this.data.totalCount} 道收藏，确定继续吗？`,
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.clearAll())
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

    this.applyViewModelEffects(result)
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
      wx.navigateTo({ url: result.command.url })
    }
  }
}, 'wrong-book'))
