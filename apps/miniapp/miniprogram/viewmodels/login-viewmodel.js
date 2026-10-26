const practiceRepository = require('../repositories/practice-repository.js')
const {
  AUTH_HINTS,
  GUEST_NAME,
  describeAuth,
  formatLoginTime,
  getAuthHint
} = require('../utils/auth-session.js')

/**
 * 登录页视图模型。
 *
 * 页面只做两件事：把用户点的东西传进来、把 result 里的 data / command 应用掉。
 * 所有「显示什么文案、算不算登录成功」的判断都在这里。
 *
 * 文案统一取 utils/auth-session.js 的 AUTH_HINTS：登录页、我的、设置
 * 三处显示的是同一句解释，各写一份迟早会写出三种说法。
 */

const HINTS = AUTH_HINTS

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getInitialLoginViewData() {
  return {
    loggedIn: false,
    provider: '',
    providerLabel: '',
    displayName: GUEST_NAME,
    avatarUrl: '',
    nickname: '',
    accountTag: GUEST_NAME,
    loginHint: HINTS.guest,
    loginTimeText: '',
    // 降级身份要在界面上说清楚，否则用户以为自己真的登录了微信
    degraded: false,
    degradeNote: '',
    canEditProfile: false,
    primaryText: '微信一键登录'
  }
}

class LoginViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialLoginViewData()
  }

  load() {
    return {
      data: this.buildData()
    }
  }

  buildData() {
    const auth = this.repository.getAuth(this.storage)
    const view = describeAuth(auth)
    const degraded = view.loggedIn && view.provider === 'dev'

    return Object.assign(getInitialLoginViewData(), {
      loggedIn: view.loggedIn,
      provider: view.provider,
      providerLabel: view.providerLabel,
      displayName: view.displayName,
      avatarUrl: view.avatarUrl,
      nickname: auth.nickname || '',
      accountTag: view.accountTag,
      loginHint: getAuthHint(auth),
      loginTimeText: formatLoginTime(view.loginAt),
      degraded,
      degradeNote: degraded ? '当前为本地身份，非微信账号' : '',
      canEditProfile: view.loggedIn,
      primaryText: view.loggedIn ? '退出登录' : '微信一键登录'
    })
  }

  /**
   * 登录。返回 Promise —— wx.login 必然异步，ViewModel 保持同一形状，
   * 页面用一个 .then 收口，不用写两套分支。
   */
  login(options) {
    return this.repository.login(this.storage, options).then((outcome) => {
      const result = {
        data: this.buildData()
      }

      result.command = {
        type: 'toast',
        title: outcome && outcome.degraded ? '已用本地身份登录' : '微信登录成功'
      }

      return result
    })
  }

  logout() {
    this.repository.logout(this.storage)

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已退出登录'
      }
    }
  }

  /** 昵称：微信官方的 nickname input 在失焦时给值，未登录时改不动 */
  setNickname(text) {
    const outcome = this.repository.updateAuthProfile(this.storage, { nickname: text })

    if (!outcome.ok) {
      return {
        command: {
          type: 'toast',
          title: outcome.reason || '请先登录'
        }
      }
    }

    return {
      data: this.buildData()
    }
  }

  setAvatar(avatarUrl) {
    const outcome = this.repository.updateAuthProfile(this.storage, { avatarUrl })

    if (!outcome.ok) {
      return {
        command: {
          type: 'toast',
          title: outcome.reason || '请先登录'
        }
      }
    }

    return {
      data: this.buildData()
    }
  }
}

module.exports = {
  HINTS,
  LoginViewModel
}
