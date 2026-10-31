const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { ExamCountdownViewModel } = require('../../viewmodels/exam-countdown-viewmodel.js')
Page(withPageLifecycle({
  data: ExamCountdownViewModel.getInitialData(),
  onLoad() { this.viewModel = new ExamCountdownViewModel({ storage: createWxStorageAdapter() }) },
  onShow() { this.applyViewModelResult(this.viewModel.load()) },
  handleExamNameBlur(e) { this.applyViewModelResult(this.viewModel.setExamName(e.detail.value)) },
  handleExamDateChange(e) { this.applyViewModelResult(this.viewModel.setExamDate(e.detail.value)) },
  handleClearExam() { wx.showModal({ title: '清除考试倒计时', content: '清除当前考试名称与日期。', success: result => { if (result.confirm) this.applyViewModelResult(this.viewModel.clearExam()) } }) },
  applyViewModelResult(result) {
    if (!result) return
    if (result.data) this.setData(result.data)
    if (result.command) wx.showToast({ title: result.command.title, icon: 'none' })
  }
}))
