const practiceRepository = require('../repositories/practice-repository.js')
const { describeAuth, getProviderLabel } = require('../utils/auth-session.js')
const { maskEmail } = require('../utils/auth-form.js')

const LOGIN_URL = '/page/login/index'
const FORGOT_URL = '/page/forgot-password/index'

/**
 * 账号管理（设计稿 Figma 781:2123）。
 *
 * 页面只负责改「资料」（头像 / 昵称 / 学院），改完点保存才落盘：
 * 输入过程中每敲一个字就写 storage 会在真机上卡顿，而且中途退出会留下半截数据。
 *
 * 邮箱 / 微信 / 密码三项是账号级操作，端上没有对应能力时**明确告知**，
 * 不静默无反应——这是本项目一贯的处理方式。
 */

const ACCOUNT_MESSAGES = {
  email: '后端账号接口未接入，暂时不能更换绑定邮箱；可先用「找回密码」验证邮箱可用',
  wechatBound: '当前已是微信登录身份，无需重复绑定',
  wechatGuest: '微信绑定需要后端账号接口，暂未接入'
}

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {}
  }
}

function createEmptyProfile() {
  return {
    avatarUrl: '',
    nickname: '',
    college: '',
    emailMasked: '',
    providerLabel: '',
    passwordStatus: '未设置',
    wechatStatus: '未绑定'
  }
}

function getInitialAccountViewData() {
  return {
    loggedIn: false,
    profile: createEmptyProfile(),
    draft: {
      avatarUrl: '',
      nickname: '',
      college: ''
    },
    // 有没有未保存的改动：没有改动时保存按钮置灰
    dirty: false,
    saving: false
  }
}

class AccountViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    // 输入框刻意不受控：只在内存里攒改动，不回写 value，否则真机光标会跳到末尾
    this.pending = null
  }

  static getInitialData() {
    return getInitialAccountViewData()
  }

  load() {
    const profile = this.readProfile()
    const draft = {
      avatarUrl: profile.avatarUrl,
      nickname: profile.nickname,
      college: profile.college
    }

    this.pending = Object.assign({}, draft)

    return {
      data: {
        loggedIn: this.readAuth().view.loggedIn,
        profile,
        draft,
        dirty: false,
        saving: false
      }
    }
  }

  readAuth() {
    try {
      const raw = this.repository.getAuth(this.storage)

      return {
        view: describeAuth(raw),
        // 编辑框要的是「用户真正填过的昵称」，不是带兜底的 displayName
        nickname: raw && typeof raw.nickname === 'string' ? raw.nickname : ''
      }
    } catch (error) {
      return { view: describeAuth(null), nickname: '' }
    }
  }

  readProfile() {
    const state = this.readAuth()
    const view = state.view

    if (!view.loggedIn) {
      return createEmptyProfile()
    }

    return {
      avatarUrl: view.avatarUrl,
      nickname: state.nickname,
      college: view.college || '',
      emailMasked: maskEmail(view.email),
      providerLabel: getProviderLabel(view.provider) || view.accountTag,
      // 邮箱登录 = 有密码；微信 / 本地身份没有密码可改
      passwordStatus: view.provider === 'email' ? '已设置' : '未设置',
      wechatStatus: view.provider === 'wechat' ? '已绑定' : '未绑定'
    }
  }

  /** 输入：只记改动，不回写 value（回写会让光标跳到末尾） */
  setField(key, value) {
    if (['avatarUrl', 'nickname', 'college'].indexOf(key) < 0) {
      return null
    }

    const text = typeof value === 'string' ? value : ''

    this.pending = Object.assign({}, this.pending || {}, { [key]: text })

    const current = this.readProfile()
    const dirty =
      (this.pending.nickname || '') !== (current.nickname || '') ||
      (this.pending.college || '') !== (current.college || '') ||
      (this.pending.avatarUrl || '') !== (current.avatarUrl || '')

    return {
      data: {
        dirty
      }
    }
  }

  /** 保存资料：未登录先去登录，避免「改完没保存」还以为存上了 */
  save() {
    if (!this.readAuth().view.loggedIn) {
      return {
        command: {
          type: 'navigate',
          url: LOGIN_URL
        }
      }
    }

    if (!this.dirtyNow()) {
      return {
        command: {
          type: 'toast',
          title: '资料没有改动'
        }
      }
    }

    const pending = this.pending || {}
    const nickname = typeof pending.nickname === 'string' ? pending.nickname.trim() : ''
    const college = typeof pending.college === 'string' ? pending.college.trim() : ''

    this.repository.updateAuthProfile(this.storage, {
      nickname,
      college,
      avatarUrl: pending.avatarUrl || ''
    })

    return Object.assign({}, this.load(), {
      command: {
        type: 'toast',
        title: '资料已保存'
      }
    })
  }

  dirtyNow() {
    const current = this.readProfile()
    const pending = this.pending || {}

    return (
      (pending.nickname || '') !== (current.nickname || '') ||
      (pending.college || '') !== (current.college || '') ||
      (pending.avatarUrl || '') !== (current.avatarUrl || '')
    )
  }

  /**
   * 改密码 = 走「找回密码」流程（邮箱验证码重设）。
   * 这是设计稿 772:1076 已有的页面，不另造一个入口。
   */
  tapPassword() {
    const view = this.readAuth().view

    if (!view.loggedIn) {
      return {
        command: {
          type: 'navigate',
          url: LOGIN_URL
        }
      }
    }

    if (view.provider !== 'email') {
      return {
        command: {
          type: 'toast',
          title: '当前身份没有设置密码，可直接用微信登录'
        }
      }
    }

    return {
      command: {
        type: 'navigate',
        url: `${FORGOT_URL}?email=${encodeURIComponent(view.email || '')}`
      }
    }
  }

  tapEmail() {
    if (!this.readAuth().view.loggedIn) {
      return {
        command: {
          type: 'navigate',
          url: LOGIN_URL
        }
      }
    }

    return {
      command: {
        type: 'toast',
        title: ACCOUNT_MESSAGES.email
      }
    }
  }

  tapWechat() {
    const view = this.readAuth().view

    if (!view.loggedIn) {
      return {
        command: {
          type: 'navigate',
          url: LOGIN_URL
        }
      }
    }

    return {
      command: {
        type: 'toast',
        title: view.provider === 'wechat' ? ACCOUNT_MESSAGES.wechatBound : ACCOUNT_MESSAGES.wechatGuest
      }
    }
  }
}

module.exports = {
  ACCOUNT_MESSAGES,
  AccountViewModel
}
