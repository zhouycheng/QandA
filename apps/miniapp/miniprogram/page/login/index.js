const { LoginViewModel } = require('../../viewmodels/login-viewmodel.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { wrapTaps } = require('../../utils/tap-trace.js')

// hideLoading 之后立刻 showToast 会被吞掉，留一帧再弹
const TOAST_DELAY = 120

Page(wrapTaps({
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
   * 主按钮：未登录走登录，已登录走退出。
   * 合成一个入口是为了避免页面上同时出现「登录」和「退出」两个按钮——
   * 用户会先纠结该点哪个。
   */
  handlePrimaryTap() {
    if (this.data.loggedIn) {
      this.confirmLogout()
      return
    }

    this.runLogin()
  },

  runLogin() {
    wx.showLoading({
      title: '登录中',
      mask: true
    })

    this.viewModel.login().then((result) => {
      wx.hideLoading()

      setTimeout(() => {
        this.applyViewModelResult(result)
      }, TOAST_DELAY)
    })
  },

  confirmLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后本机学习数据仍会保留，只是不再关联身份。确定退出吗？',
      confirmText: '退出',
      confirmColor: '#f04438',
      success: (res) => {
        if (res.confirm) {
          this.applyViewModelResult(this.viewModel.logout())
        }
      }
    })
  },

  /**
   * 头像：微信 2022 年那次调整后，getUserProfile / getUserInfo 已废弃，
   * 唯一合规入口是 <button open-type="chooseAvatar">。
   */
  handleChooseAvatar(e) {
    const tempUrl = e.detail && e.detail.avatarUrl

    if (!tempUrl) {
      return
    }

    this.persistAvatar(tempUrl)
  },

  /**
   * chooseAvatar 返回的是**临时**路径，下次冷启动就失效，
   * 必须拷进 wx.env.USER_DATA_PATH 才能长期显示。
   * 拷不进去（模拟器 / 权限问题）就退回临时路径，至少本次会话能看见。
   */
  persistAvatar(tempUrl) {
    const userDir = wx.env && wx.env.USER_DATA_PATH
    const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null

    if (!userDir || !fs) {
      this.applyViewModelResult(this.viewModel.setAvatar(tempUrl))
      return
    }

    let saved = ''

    try {
      saved = fs.saveFileSync(tempUrl, `${userDir}/qanda-avatar.png`)
    } catch (error) {
      saved = ''
    }

    this.applyViewModelResult(this.viewModel.setAvatar(saved || tempUrl))
  },

  /** 昵称同样只在失焦时保存：bindinput 每敲一个字写一次 storage 没必要 */
  handleNicknameBlur(e) {
    this.applyViewModelResult(this.viewModel.setNickname(e.detail.value))
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
      wx.navigateTo({
        url: result.command.url
      })
    }
  }
}, 'login'))
