const { LoginViewModel } = require('../../viewmodels/login-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
// hideLoading 之后立刻 showToast 会被吞掉，留一帧再弹
const TOAST_DELAY = 120

Page({
  data: LoginViewModel.getInitialData(),

  onLoad() {
    this.viewModel = new LoginViewModel({
      storage: createWxStorageAdapter()
    })

    this.applyViewModelResult(this.viewModel.load())
  },

  onShow() {
    if (this.viewModel) {
      this.applyViewModelResult(this.viewModel.load())
    }
  },

  /**
   * 输入只回写 errorField 等状态，**不回写 value**。
   * 把 value 也 setData 回去会让受控输入在真机上出现光标跳到末尾的问题。
   */
  syncForm(result) {
    if (!result || !result.data) {
      return
    }

    this.setData({
      errorField: result.data.errorField,
      canSubmit: result.data.canSubmit,
      submitting: result.data.submitting,
      agreed: result.data.agreed
    })
  },

  handleEmailInput(e) {
    this.syncForm(this.viewModel.setField('email', e.detail.value))
  },

  handlePasswordInput(e) {
    this.syncForm(this.viewModel.setField('password', e.detail.value))
  },

  handleToggleAgreed() {
    this.syncForm(this.viewModel.toggleAgreed())
  },

  handleLoginTap() {
    this.runAuth(() => this.viewModel.submit(), '登录中')
  },

  handleWechatTap() {
    this.runAuth(() => this.viewModel.wechatLogin(), '登录中')
  },

  /**
   * 统一跑一次认证请求。
   *
   * 用实例上的 busy 锁而不是 `data.submitting`：setData 是异步生效的，
   * 连点两下时 data 里还是旧值，锁不住 —— 会叠两个 loading，
   * 先结束的那个把另一个的 loading 一起 hide 掉，界面看着像闪了一下。
   * 另外 factory 同步抛错时必须有兜底，否则 loading 永远不消失。
   */
  runAuth(factory, title) {
    if (this.busy) {
      return
    }

    this.busy = true
    wx.showLoading({
      title,
      mask: true
    })

    const done = (result) => {
      this.busy = false
      wx.hideLoading()

      setTimeout(() => {
        this.applyViewModelResult(result)
      }, TOAST_DELAY)
    }

    let pending = null

    try {
      pending = factory()
    } catch (error) {
      pending = Promise.reject(error)
    }

    Promise.resolve(pending).then(done, () => {
      done({
        data: this.viewModel.buildData(),
        command: {
          type: 'toast',
          title: '网络异常，请稍后重试'
        }
      })
    })
  },

  handleForgotTap() {
    wx.navigateTo({
      url: '/page/forgot-password/index'
    })
  },

  handleRegisterTap() {
    wx.navigateTo({
      url: '/page/register/index'
    })
  },

  applyViewModelResult(result) {
    if (!result) {
      return
    }

    if (result.data) {
      this.setData(result.data)
    }

    const command = result.command

    if (!command) {
      return
    }

    if (command.type === 'toast') {
      wx.showToast({
        title: command.title || '操作完成',
        icon: 'none',
        duration: 1800
      })
      return
    }

    if (command.type === 'back') {
      this.finishBack(command.title)
      return
    }

    if (command.type === 'navigate' && command.url) {
      const go = command.mode === 'redirect' ? wx.redirectTo : wx.navigateTo

      go({
        url: command.url,
        fail: () => wx.reLaunch({ url: command.url })
      })

      if (command.title) {
        wx.showToast({
          title: command.title,
          icon: 'none',
          duration: 1800
        })
      }
    }
  },

  /**
   * 登录成功后回到来处。
   * 直接进登录页（没有上一页）时 navigateBack 会失败，退回首页兜底，
   * 否则用户点完登录会停在原地，看起来像没生效。
   */
  finishBack(title) {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/page/subject-list/index'
        })
      }
    })

    if (title) {
      wx.showToast({
        title,
        icon: 'none',
        duration: 1800
      })
    }
  }
})
