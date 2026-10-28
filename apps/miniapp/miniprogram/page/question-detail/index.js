const { QuestionDetailViewModel } = require('../../viewmodels/question-detail-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
Page({
  data: QuestionDetailViewModel.getInitialData(),

  onLoad(options) {
    this.viewModel = new QuestionDetailViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load(options))
    this.applyViewModelResult(this.viewModel.refreshRemote(options))
  },

  handleToggleFavorite() {
    this.applyViewModelResult(this.viewModel.toggleFavorite(this.data.questionId))
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
  }
})
