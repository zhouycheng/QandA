const { PlaygroundViewModel } = require('../../viewmodels/playground-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: PlaygroundViewModel.getInitialData(),

  onLoad() {
    this.viewModel = new PlaygroundViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load())
  },

  /** 从练习页返回时刷新一次：场景名与开关可能已被别处改过 */
  onShow() {
    if (this.viewModel) {
      this.applyViewModelResult(this.viewModel.load())
    }
  },

  handleToggle(e) {
    this.applyViewModelResult(this.viewModel.toggleEnabled(e.detail.value))
  },

  handleScenarioTap(e) {
    const key = e.currentTarget.dataset.key
    this.applyViewModelResult(this.viewModel.applyScenario(key))
  },

  handleResetGateway() {
    this.applyViewModelResult(this.viewModel.resetGateway())
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
        icon: 'none',
        duration: 1600
      })
    }

    if (result.command && result.command.type === 'navigate' && result.command.url) {
      wx.navigateTo({
        url: result.command.url
      })
    }
  }
}, 'playground'))
