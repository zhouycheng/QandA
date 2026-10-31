const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { SettingsViewModel } = require('../../viewmodels/settings-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
Page(withPageLifecycle({
  data: SettingsViewModel.getInitialData(),
  onLoad() { this.viewModel = new SettingsViewModel({ storage: createWxStorageAdapter() }) },
  onShow() { this.applyViewModelResult(this.viewModel.load()) },
  handleSwitchChange(e) { this.applyViewModelResult(this.viewModel.toggleSwitch(e.currentTarget.dataset.key, e.detail.value)) },
  handleChoiceTap(e) { this.applyViewModelResult(this.viewModel.selectChoice(e.currentTarget.dataset.key, e.currentTarget.dataset.value)) },
  handleResetPreferences() {
    wx.showModal({ title: '恢复默认答题偏好', content: '恢复本页的开关与字号设置。', success: result => { if (result.confirm) this.applyViewModelResult(this.viewModel.resetPreferences()) } })
  },
  applyViewModelResult(result) {
    if (!result) return
    if (result.data) this.setData(result.data)
    if (result.command) wx.showToast({ title: result.command.title, icon: 'none' })
  }
}))
