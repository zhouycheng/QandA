const { ForgotPasswordViewModel } = require('../../viewmodels/forgot-password-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')
const cooldown = require('../../utils/cooldown.js')

const TOAST_DELAY = 120

// cooldown 字段的初始值由 cooldown 模块给出，与注册页同一套处理
Page(wrapTaps({
  data: Object.assign(ForgotPasswordViewModel.getInitialData(), cooldown.getInitialCooldownData()),

  onLoad() {
    this.viewModel = new ForgotPasswordViewModel({
      storage: createWxStorageAdapter()
    })

    this.applyViewModelResult(this.viewModel.load())
  },

  /** 从后台回来时接着倒数（onHide 只停定时器，结束时刻还在） */
  onShow() {
    cooldown.resume(this)
  },

  onUnload() {
    cooldown.stop(this)
    this.cooldownEndAt = 0
  },

  onHide() {
    cooldown.stop(this)
  },

  handleEmailInput(e) {
    this.syncForm(this.viewModel.setField('email', e.detail.value))
  },

  handleCodeInput(e) {
    this.syncForm(this.viewModel.setField('code', e.detail.value))
  },

  handlePasswordInput(e) {
    this.syncForm(this.viewModel.setField('password', e.detail.value))
  },

  handleConfirmInput(e) {
    this.syncForm(this.viewModel.setField('confirm', e.detail.value))
  },

  handleSendCode() {
    if (this.data.cooldown > 0) {
      return
    }

    this.viewModel.sendCode('reset').then((result) => {
      this.applyViewModelResult(result)
    })
  },

  handleSubmitTap() {
    // 用实例锁而不是 data.submitting：setData 异步生效，连点两下锁不住
    if (this.busy) {
      return
    }

    this.busy = true
    wx.showLoading({
      title: '提交中',
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
      pending = this.viewModel.submit()
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

  handleBackLogin() {
    this.goLogin()
  },

  syncForm(result) {
    if (!result || !result.data) {
      return
    }

    this.setData({
      errorField: result.data.errorField,
      canSubmit: result.data.canSubmit,
      submitting: result.data.submitting
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

    if (command.type === 'cooldown') {
      // 开始时刻由控制器记成绝对结束时间，退后台回来还能接上
      cooldown.begin(this, command.seconds)

      wx.showToast({
        title: command.title || '验证码已发送',
        icon: 'none',
        duration: 2000
      })
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

    if (command.type === 'navigate' && command.url) {
      // 重置成功后回登录页，且不要留下「找回密码」这一层
      wx.redirectTo({
        url: command.url,
        fail: () => wx.reLaunch({ url: command.url })
      })

      if (command.title) {
        wx.showToast({
          title: command.title,
          icon: 'none',
          duration: 2000
        })
      }
    }
  },

  goLogin() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: '/page/login/index',
          fail: () => wx.reLaunch({ url: '/page/login/index' })
        })
      }
    })
  }
}, 'forgotPassword'))
