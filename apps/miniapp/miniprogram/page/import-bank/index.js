const { ImportBankViewModel } = require('../../viewmodels/import-bank-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

// 超过这个体积的文件先提示，读进来也没法解析（真要导大题库请用开发者脚本）
const MAX_FILE_BYTES = 2 * 1024 * 1024

Page(wrapTaps({
  data: ImportBankViewModel.getInitialData(),

  onLoad() {
    this.viewModel = new ImportBankViewModel({
      storage: createWxStorageAdapter()
    })
    this.applyViewModelResult(this.viewModel.load())
  },

  onShow() {
    if (this.viewModel) {
      this.applyViewModelResult(this.viewModel.load())
    }
  },

  handleModeTap(e) {
    this.applyViewModelResult(this.viewModel.selectInputMode(e.currentTarget.dataset.mode))
  },

  handleNameInput(e) {
    this.applyViewModelResult(this.viewModel.setBankName(e.detail.value))
  },

  /**
   * 文本解析放在失焦时做。
   * 放在 bindinput 里会变成「每敲一个字解析全表」——大表格直接把输入框卡住。
   * 导入按钮内部会再解析一次，所以不失焦直接点导入也不会漏。
   */
  handleTextBlur(e) {
    this.applyViewModelResult(this.viewModel.applyText(e.detail.value, ''))
  },

  handleClearText() {
    this.applyViewModelResult(this.viewModel.clearText())
  },

  handleCopyTemplate() {
    wx.setClipboardData({
      data: this.data.templateHint,
      success: () => {
        wx.showToast({ title: '表头已复制', icon: 'none', duration: 1600 })
      }
    })
  },

  /**
   * 选文件入口。wx.chooseMessageFile 只能从**微信聊天记录**里选，
   * 所以引导文案必须写清楚「先把文件发到任意一个聊天窗口」，
   * 否则用户点开是空的，只会以为功能坏了。
   */
  handlePickFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt', 'json'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]

        if (!file) {
          wx.showToast({ title: '没有选中文件', icon: 'none' })
          return
        }

        this.readFile(file)
      },
      fail: (error) => {
        const message = error && error.errMsg ? error.errMsg : ''

        // 用户主动取消不算错误，别弹 toast
        if (message.indexOf('cancel') >= 0) {
          return
        }

        wx.showToast({
          title: '选文件失败，可改用粘贴表格',
          icon: 'none',
          duration: 2000
        })
      }
    })
  },

  readFile(file) {
    const fs = wx.getFileSystemManager()

    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      wx.showToast({
        title: '文件太大，请用开发者脚本导入',
        icon: 'none',
        duration: 2000
      })
      return
    }

    try {
      const content = fs.readFileSync(file.path, 'utf8')

      this.applyViewModelResult(this.viewModel.applyText(content, file.name || ''))
    } catch (error) {
      wx.showToast({
        title: '读取失败，可改用粘贴表格',
        icon: 'none',
        duration: 2000
      })
    }
  },

  handleImport() {
    this.applyViewModelResult(this.viewModel.importBank(this.data))
  },

  handleRemoveBank(e) {
    const bankId = e.currentTarget.dataset.bankId

    wx.showModal({
      title: '删除题库',
      content: '删除后本机题目一并清除，无法恢复。',
      confirmColor: '#f04438',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.applyViewModelResult(this.viewModel.removeBank(bankId))
      }
    })
  },

  handleOpenBank(e) {
    this.applyViewModelResult(this.viewModel.openBank(e.currentTarget.dataset.bankId))
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
        duration: 1800
      })
    }

    if (result.command && result.command.type === 'navigate' && result.command.url) {
      wx.navigateTo({ url: result.command.url })
    }
  }
}, 'import-bank'))
