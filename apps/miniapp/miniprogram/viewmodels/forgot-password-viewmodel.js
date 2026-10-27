const { AuthFormViewModel } = require('./auth-form-viewmodel.js')
const { validateReset } = require('../utils/auth-form.js')

/**
 * 找回密码视图模型（设计稿 772:1076）。
 *
 * 与注册页几乎同构，两处差别：
 * 1. 没有「同意协议」勾选（设计稿里这栏不存在）；
 * 2. 成功后**不自动登录** —— 设计稿原文「重置成功后，请使用新密码登录」，
 *    所以跳回登录页而不是直接进站。
 */
class ForgotPasswordViewModel extends AuthFormViewModel {
  _validate() {
    return validateReset(this.fields)
  }

  _submit() {
    return this.repository.resetPassword(this.storage, {
      email: this.fields.email,
      code: this.fields.code,
      password: this.fields.password
    })
  }

  buildSuccessCommand(result) {
    return {
      type: 'navigate',
      url: '/page/login/index',
      mode: 'redirect',
      title: result && result.degraded ? '密码未实际修改（后端未接入）' : '密码已重置，请使用新密码登录'
    }
  }
}

module.exports = {
  ForgotPasswordViewModel
}
