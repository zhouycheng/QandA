const { AuthFormViewModel } = require('./auth-form-viewmodel.js')
const { validateLogin } = require('../utils/auth-form.js')

/**
 * 登录页视图模型（设计稿 763:567）。
 *
 * 一条主路径 + 一条备选：
 *   邮箱 + 密码  → repository.loginWithEmail（后端未接入时降级为本地身份）
 *   微信登录     → repository.login（wx.login 拿 code，同样可降级）
 *
 * 页面只负责把输入传进来、把 command 执行掉，判断都在这里。
 */
class LoginViewModel extends AuthFormViewModel {
  _validate() {
    return validateLogin(this.fields)
  }

  _submit() {
    return this.repository.loginWithEmail(this.storage, {
      email: this.fields.email,
      password: this.fields.password
    })
  }

  buildSuccessCommand(result) {
    return {
      type: 'back',
      title: result && result.degraded ? '已用本地身份登录' : '登录成功'
    }
  }

  /**
   * 微信登录：与邮箱通道并存（设计稿里它是「或」下面的备选按钮）。
   * wx.login 必然异步，所以这里固定返回 Promise。
   */
  wechatLogin() {
    if (this.submitting) {
      return Promise.resolve({ data: this.buildData() })
    }

    this.submitting = true

    return this.repository
      .login(this.storage)
      .then((outcome) => this.afterSubmit(outcome), () => this.afterSubmit({ ok: false, reason: '登录接口异常' }))
  }

  logout() {
    this.repository.logout(this.storage)
    this.degradedNote = ''

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已退出登录'
      }
    }
  }
}

module.exports = {
  LoginViewModel
}
