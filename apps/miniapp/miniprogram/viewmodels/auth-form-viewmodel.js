const practiceRepository = require('../repositories/practice-repository.js')
const { isValidEmail, trimText } = require('../utils/auth-form.js')

/**
 * 认证表单的公共基类。
 *
 * 登录 / 注册 / 找回密码三张画板（763:567 / 772:1036 / 772:1076）结构一样：
 * 一组输入框 + 一个主按钮 + 一处返回入口。差别只有「校验哪几个字段」
 * 和「提交后去哪」，所以把字段状态、错误定位、提交收口都放在这里，
 * 子类只实现 `_validate()` 与 `_submit(payload)`。
 *
 * 约定：
 * - **错误一律 toast**：设计稿没有错误文案的位置，加一行红字会把版式撑歪。
 *   同时给对应输入框挂 `errorField`，用户能一眼看出是哪一栏。
 * - **降级不算失败**：后端没接入时仍然进登录态，只是给一条说明。
 */

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getInitialFormData() {
  return {
    email: '',
    code: '',
    password: '',
    confirm: '',
    agreed: false,
    errorField: '',
    submitting: false,
    canSubmit: false,
    degradedNote: ''
  }
}

function pickField(name, value) {
  return typeof value === 'string' ? value : ''
}

class AuthFormViewModel {
  constructor(options) {
    const normalized = options || {}

    this.repository = normalized.repository || practiceRepository
    this.storage = normalized.storage || createNullStorage()
    this.fields = {
      email: '',
      code: '',
      password: '',
      confirm: '',
      agreed: false
    }
    this.errorField = ''
    this.degradedNote = ''
    this.submitting = false
    this.sendingCode = false
  }

  static getInitialData() {
    return getInitialFormData()
  }

  /** 子类覆盖：返回 { ok, field, message } */
  _validate() {
    return { ok: true, field: '', message: '' }
  }

  /** 子类覆盖：返回 Promise<result> */
  _submit() {
    return Promise.resolve({ data: this.buildData() })
  }

  buildData() {
    return Object.assign(getInitialFormData(), {
      email: this.fields.email,
      code: this.fields.code,
      password: this.fields.password,
      confirm: this.fields.confirm,
      agreed: this.fields.agreed,
      errorField: this.errorField,
      submitting: this.submitting,
      canSubmit: this.canSubmit(),
      degradedNote: this.degradedNote
    })
  }

  /**
   * 按钮是否可点。
   * 没填完整就不点亮，避免用户点了只收到一串校验提示；
   * 协议不在这里卡，否则用户填完才发现按钮是灰的却不知道为什么。
   */
  canSubmit() {
    return !!trimText(this.fields.email) && !this.submitting
  }

  load() {
    return {
      data: this.buildData()
    }
  }

  /**
   * 改字段。
   * 改哪一栏就清哪一栏的红边 —— 留着红边会让用户以为还没改对。
   */
  setField(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.fields, name)) {
      return { data: this.buildData() }
    }

    this.fields[name] = name === 'agreed' ? !!value : pickField(name, value)

    if (this.errorField === name) {
      this.errorField = ''
    }

    return {
      data: this.buildData()
    }
  }

  toggleAgreed() {
    this.fields.agreed = !this.fields.agreed

    if (this.fields.agreed && this.errorField === 'agreed') {
      this.errorField = ''
    }

    return {
      data: this.buildData()
    }
  }

  /**
   * 发送邮箱验证码（注册 / 找回密码共用）。
   *
   * 邮箱没填或格式不对就**不发**：真发出去了用户也收不到，
   * 只会以为验证码系统坏了。这里的 errorField 让输入框挂红边。
   */
  sendCode(purpose) {
    if (this.sendingCode) {
      return Promise.resolve({ data: this.buildData() })
    }

    if (!isValidEmail(this.fields.email)) {
      this.errorField = 'email'

      return Promise.resolve({
        data: this.buildData(),
        command: {
          type: 'toast',
          title: trimText(this.fields.email) ? '邮箱格式不正确' : '请先填写邮箱'
        }
      })
    }

    this.sendingCode = true

    return this.repository
      .sendAuthCode(this.storage, {
        email: this.fields.email,
        purpose: purpose === 'reset' ? 'reset' : 'register'
      })
      .then(
        (outcome) => {
          this.sendingCode = false

          // 后端明确拒绝（邮箱不存在 / 发送过于频繁）：不能给倒计时，
          // 否则按钮会被锁住 60 秒，用户以为发成功了却在等一条永远不来的短信
          if (outcome && outcome.ok === false) {
            return {
              data: this.buildData(),
              command: {
                type: 'toast',
                title: outcome.reason || '验证码发送失败，请稍后重试'
              }
            }
          }

          return {
            data: this.buildData(),
            command: {
              type: 'cooldown',
              seconds: Number(outcome && outcome.cooldown) > 0 ? Number(outcome.cooldown) : 60,
              title: outcome && outcome.degraded ? outcome.reason : '验证码已发送'
            }
          }
        },
        () => {
          this.sendingCode = false

          return {
            data: this.buildData(),
            command: {
              type: 'toast',
              title: '验证码发送失败，请稍后重试'
            }
          }
        }
      )
  }

  /** 提交：先校验，再交给子类 */
  submit() {
    if (this.submitting) {
      return Promise.resolve({ data: this.buildData() })
    }

    const check = this._validate()

    if (!check.ok) {
      this.errorField = check.field || ''

      return Promise.resolve({
        data: this.buildData(),
        command: {
          type: 'toast',
          title: check.message || '请检查填写内容'
        }
      })
    }

    this.errorField = ''
    this.submitting = true

    // _submit 同步抛错（例如仓储层被替换成有 Bug 的实现）不能让 submitting 卡在 true，
    // 否则按钮从此永久点不动，只能杀进程重进
    let pending = null

    try {
      pending = this._submit()
    } catch (error) {
      pending = Promise.reject(error)
    }

    return Promise.resolve(pending)
      .catch(() => ({
        ok: false,
        unavailable: false,
        reason: '网络异常，请稍后重试'
      }))
      .then((outcome) => this.afterSubmit(outcome))
  }

  afterSubmit(outcome) {
    const result = outcome || {}
    this.submitting = false

    if (result.ok === false) {
      return {
        data: this.buildData(),
        command: {
          type: 'toast',
          title: result.reason || '操作失败，请稍后重试'
        }
      }
    }

    // 降级说明只在本次降级时出现；换成真登录成功必须清掉，
    // 否则界面上会挂着「已用本地身份」而实际走的是真后端。
    // 优先用 note（人话），reason 是网关原话，只适合排查不适合展示
    this.degradedNote = result.degraded
      ? (result.note || result.reason || '后端未接入，已用本地身份继续')
      : ''

    return {
      data: this.buildData(),
      command: this.buildSuccessCommand(result)
    }
  }

  /** 子类覆盖：成功后的去向 */
  buildSuccessCommand() {
    return {
      type: 'toast',
      title: '操作成功'
    }
  }
}

module.exports = {
  AuthFormViewModel,
  createNullStorage,
  getInitialFormData
}
