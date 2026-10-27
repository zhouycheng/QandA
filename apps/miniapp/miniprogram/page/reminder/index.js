const { ReminderViewModel } = require('../../viewmodels/reminder-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

Page(wrapTaps({
  data: ReminderViewModel.getInitialData(),

  onLoad() {
    this.viewModel = new ReminderViewModel({
      storage: createWxStorageAdapter()
    })

    this.applyViewModelResult(this.viewModel.load())
  },

  /** 从登录页返回（未登录被引导登录后再进来）时刷新脱敏邮箱 */
  onShow() {
    if (this.viewModel && !this.data.addSheetVisible) {
      this.applyViewModelResult(this.viewModel.load())
    }
  },

  handleSwitchChange(e) {
    const key = e.currentTarget.dataset.key

    this.applyViewModelResult(this.viewModel.toggleSwitch(key, e.detail.value))
  },

  handleTimeChange(e) {
    this.applyViewModelResult(this.viewModel.pickTime(e.detail.value))
  },

  handleFrequencyChange(e) {
    this.applyViewModelResult(this.viewModel.pickFrequencyIndex(e.detail.value))
  },

  handleAdvanceTap(e) {
    this.applyViewModelResult(this.viewModel.toggleAdvance(e.currentTarget.dataset.value))
  },

  /** 考试条目：点一下给「删除」动作。设计稿没有留删除位，用动作面板不破坏版式 */
  handleExamTap(e) {
    const dataset = e.currentTarget.dataset
    const id = dataset.id
    const name = dataset.name || '这个考试'

    wx.showActionSheet({
      itemList: [`删除「${name}」`],
      itemColor: '#f04438',
      success: (res) => {
        if (res.tapIndex === 0) {
          this.applyViewModelResult(this.viewModel.removeExam(id))
        }
      }
    })
  },

  handleAddExamTap() {
    this.applyViewModelResult(this.viewModel.openAddSheet())
  },

  handleAddSheetClose() {
    this.applyViewModelResult(this.viewModel.closeAddSheet())
  },

  /** 名称放 bindblur：放 bindinput 会每敲一个字存一次，也会打断中文联想 */
  handleExamNameBlur(e) {
    this.viewModel.setExamDraftName(e.detail.value)
  },

  handleExamDateChange(e) {
    this.applyViewModelResult(this.viewModel.setExamDraftDate(e.detail.value))
  },

  handleAddExamConfirm() {
    this.applyViewModelResult(this.viewModel.confirmAddExam())
  },

  handleSaveTap() {
    const result = this.viewModel.save()

    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }

    wx.showToast({
      title: (result.command && result.command.title) || '设置已保存',
      icon: 'none',
      duration: 1200
    })

    setTimeout(() => {
      wx.navigateBack()
    }, 600)
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }

    if (!result.command) {
      return
    }

    if (result.command.type === 'toast') {
      wx.showToast({
        title: result.command.title || '操作完成',
        icon: 'none',
        duration: 1800
      })
    }
  }
}, 'reminder'))
