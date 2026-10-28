const remoteData = require('../repositories/remote-data-repository.js')
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
  email: '邮箱更换入口暂未开放，可通过找回密码验证邮箱',
  wechatBound: '当前已是微信登录身份，无需重复绑定',
  wechatGuest: '微信绑定入口暂未开放'
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
    saving: false,
    collegeOptions: [],
    collegeIndex: 0
  }
}

class AccountViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    // 输入框刻意不受控：只在内存里攒改动，不回写 value，否则真机光标会跳到末尾
    this.pending = null
    this.editRevision = 0
  }

  refreshRemote(subjectId) {
    if (!this.repository.isRemoteEnabled || !this.repository.isRemoteEnabled()) return Promise.resolve(null)
    const revision = this.editRevision
    return this.repository.refreshRemote(this.storage, 'profile').then(() => revision === this.editRevision ? this.load() : null).catch((error) => ({ command: { type: 'toast', title: error.message } }))
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
        saving: false,
        collegeOptions: [{ id: '', name: '未选择' }].concat(remoteData.getColleges()),
        collegeIndex: Math.max(0, [{ id: '' }].concat(remoteData.getColleges()).findIndex((item) => item.id === ((remoteData.getProfile(this.storage) || {}).collegeId || '')))
      }
    }
  }

  readAuth() {
    try {
      const raw = this.repository.getAuth(this.storage)

      return {
        view: describeAuth(raw),
        // 编辑框要的是「用户真正填过的昵称」，不是带兜底的 displayName
        nickname: raw && typeof raw.nickname === 'string' ? raw.nickname : '',
        profile: raw && raw.profile
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
      // 密码状态随邮箱登录能力显示。
      passwordStatus: view.provider === 'email' ? '已设置' : '未设置',
      wechatStatus: (state.profile && state.profile.wechatBound) || view.provider === 'wechat' ? '已绑定' : '未绑定'
    }
  }

  selectCollege(index) {
    this.editRevision += 1
    const colleges = [{ id: '', name: '未选择' }].concat(remoteData.getColleges())
    const college = colleges[Number(index)] || colleges[0]
    this.pending = Object.assign({}, this.pending, { college: college.id ? college.name : '', collegeId: college.id || null })
    return { data: { collegeIndex: Number(index), dirty: true } }
  }

  /** 输入：只记改动，不回写 value（回写会让光标跳到末尾） */
  setField(key, value) {
    if (['avatarUrl', 'nickname', 'college'].indexOf(key) < 0) {
      return null
    }

    this.editRevision += 1
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

    if (this.repository.isRemoteEnabled && this.repository.isRemoteEnabled()) {
      const profile = remoteData.getProfile(this.storage) || {}
      return remoteData.saveProfile(this.storage, { nickname, collegeId: pending.collegeId === undefined ? profile.collegeId : pending.collegeId, majorId: pending.collegeId === undefined || pending.collegeId === profile.collegeId ? profile.majorId : null }).then(() => {
        this.repository.updateAuthProfile(this.storage, { avatarUrl: pending.avatarUrl || '' })
        return Object.assign({}, this.load(), { command: { type: 'toast', title: '资料已保存' } })
      })
    }
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
