const { QuestionDetailViewModel } = require('../../viewmodels/question-detail-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: QuestionDetailViewModel.getInitialData(),

  onLoad(options) {
    this.viewModel = new QuestionDetailViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load(options))
  },

  handleToggleFavorite() {
    this.applyViewModelResult(this.viewModel.toggleFavorite(this.data.questionId))
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }
  }
}, 'question-detail'))
