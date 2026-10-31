const practiceRepository = require('../repositories/practice-repository.js')
const { describeAuth, getProviderLabel } = require('../utils/auth-session.js')
const { normalizePreferences } = require('../utils/preferences.js')
const { DEFAULT_ORDER } = require('../utils/practice-layout.js')
const { maskEmail } = require('../utils/auth-form.js')

const LOGIN_URL = '/page/login/index'
const ACCOUNT_URL = '/page/account/index'
const SETTINGS_URL = '/page/settings/index'
const REMINDER_URL = '/page/reminder/index'

// 「我的」集中提供账号、独立学习设置与关于入口。

/** 协议正文：只有摘要，正式文本随发布版本补充，避免凭空编法务条款 */
const AGREEMENT_TEXT = [
  'QandA 提供课程复习与题库练习，登录后通过服务端保存学习记录。',
  '正式练习草稿联网后同步到账号，游客试答记录保存在当前设备。',
  '完整协议文本将随正式版本一并发布。'
].join('\n')

const PRIVACY_TEXT = [
  '学习数据（进度、错题、收藏、时长）按账号保存并同步到服务端。',
  '登录会创建用于身份验证与设备会话管理的服务端会话。',
  '完整隐私政策将随正式版本一并发布。'
].join('\n')

function createNullStorage() {
  return {
    get() {
      return 0
    },

    keys() {
      return []
    },

    remove() {}
  }
}

/** 未登录时的资料头；读身份失败也用它，保证 tabBar 页面不会白屏 */
function createGuestAuthView() {
  return {
    loggedIn: false,
    displayName: '点击登录',
    avatarUrl: '',
    accountTag: '未登录',
    college: '',
    emailMasked: '',
    subText: '未登录',
    metaText: '登录后记录正式练习'
  }
}

/**
 * 注意：这里不声明 version。版本号由页面从全局配置读取后 setData，
 * 若 ViewModel 也用空值参与 setData，会把页面已写入的版本号覆盖回空白。
 */
function getInitialMyViewData() {
  return {
    auth: createGuestAuthView(),
    // 学习设置与关于：右侧摘要随偏好 / 提醒设置变化
    learnRows: [],
    links: [],
    about: {
      version: '',
      subjectCount: 0,
      bankCount: 0,
      questionCount: 0,
      playgroundEnabled: false
    },
    // 弹层：'' | about | agreement | privacy
    sheet: '',
    sheetTitle: '',
    sheetBody: ''
  }
}

/** 右侧摘要用：即时显示解析 / 只标对错 */
function describeExplanationLabel(preferences) {
  return preferences.autoShowExplanation ? '即时答案' : '仅看对错'
}

class MyViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.version = ''
  }

  refreshRemote(options) {
    if (!this.repository.isRemoteEnabled || !this.repository.isRemoteEnabled()) return Promise.resolve(null)
    return this.repository.refreshRemote(this.storage, 'profile', options).then(() => ({ data: this.projectRemote() })).catch((error) => ({ command: { type: 'toast', title: error.message } }))
  }

  projectRemote() {
    require('../repositories/remote-data-repository.js').getProfile(this.storage)
    const data = this.load().data
    delete data.sheet
    delete data.sheetTitle
    delete data.sheetBody
    return data
  }

  static getInitialData() {
    return getInitialMyViewData()
  }

  load() {
    const stats = this.repository.getCatalogStats()
    const preferences = normalizePreferences(this.repository.getPreferences(this.storage))
    const reminder = this.repository.getReminder(this.storage)
    const auth = this.readAuthView()

    return {
      data: Object.assign(getInitialMyViewData(), {
        auth,
        learnRows: [
          { key: 'practice', title: '答题偏好', value: describeExplanationLabel(preferences) },
          { key: 'layout', title: '自定义布局', value: preferences.moduleOrder.join() === DEFAULT_ORDER.join() ? '默认布局' : '已自定义' },
          { key: 'reminder', title: '邮箱提醒', value: reminder.enabled ? '已开启' : '已关闭' },
          { key: 'about', title: '关于QandA', value: '' }
        ],
        links: [
          { key: 'agreement', title: '用户协议' },
          { key: 'privacy', title: '隐私政策' }
        ],
        about: {
          version: this.version,
          subjectCount: stats.subjectCount || 0,
          bankCount: stats.bankCount || 0,
          questionCount: stats.questionCount || 0,
          playgroundEnabled: !!this.repository.isPlaygroundEnabled()
        }
      })
    }
  }

  /**
   * 资料头视图。
   * 未登录：第二行给账号状态（未登录），第三行给引导；
   * 已登录：第二行学院（没填就退到身份来源），第三行脱敏邮箱。
   */
  readAuthView() {
    try {
      const auth = this.repository.getAuth(this.storage)
      const view = describeAuth(auth)

      if (!view.loggedIn) {
        return createGuestAuthView()
      }

      return {
        loggedIn: true,
        displayName: view.displayName,
        avatarUrl: view.avatarUrl,
        accountTag: view.accountTag,
        college: view.college,
        emailMasked: maskEmail(view.email),
        subText: view.college || getProviderLabel(view.provider) || view.accountTag,
        metaText: maskEmail(view.email) || '未绑定邮箱'
      }
    } catch (error) {
      return createGuestAuthView()
    }
  }

  /** 行点击：账号 / 学习设置 / 关于 / 协议，退出登录由页面加确认弹窗后调 logout() */
  tapRow(key) {
    if (key === 'account' || key === 'profile') {
      const auth = this.readAuthView()

      return {
        command: {
          type: 'navigate',
          url: auth.loggedIn ? ACCOUNT_URL : LOGIN_URL
        }
      }
    }

    if (key === 'practice') {
      return {
        command: {
          type: 'navigate',
          url: SETTINGS_URL
        }
      }
    }

    if (key === 'layout') {
      return {
        command: {
          type: 'navigate',
          url: '/page/practice-layout/index'
        }
      }
    }

    if (key === 'reminder') {
      const auth = this.readAuthView()

      if (!auth.loggedIn) {
        return {
          command: {
            type: 'toast',
            title: '登录后才能收到邮箱提醒'
          }
        }
      }

      return {
        command: {
          type: 'navigate',
          url: REMINDER_URL
        }
      }
    }

    if (key === 'about') {
      return this.openSheet('about')
    }

    if (key === 'agreement') {
      return this.openSheet('agreement')
    }

    if (key === 'privacy') {
      return this.openSheet('privacy')
    }

    return null
  }

  openSheet(name) {
    if (name === 'about') {
      return {
        data: {
          sheet: 'about',
          sheetTitle: '关于QandA',
          sheetBody: '',
          about: this.load().data.about
        }
      }
    }

    if (name === 'agreement') {
      return {
        data: {
          sheet: 'agreement',
          sheetTitle: '用户协议',
          sheetBody: AGREEMENT_TEXT
        }
      }
    }

    if (name === 'privacy') {
      return {
        data: {
          sheet: 'privacy',
          sheetTitle: '隐私政策',
          sheetBody: PRIVACY_TEXT
        }
      }
    }

    return null
  }

  unlockPlayground() {
    try { this.repository.setPlaygroundEnabled(this.storage, true); return this.openSheet('about') }
    catch (error) { return { command: { type: 'toast', title: '设置保存失败，请重试' } } }
  }

  closeSheet() {
    return {
      data: {
        sheet: ''
      }
    }
  }

  /** 版本号由页面注入（来自全局配置），供「关于」弹层显示 */
  setVersion(version) {
    this.version = typeof version === 'string' ? version : ''

    return {
      data: {
        about: Object.assign({}, this.load().data.about, { version: this.version })
      }
    }
  }

  /** 退出登录：只清身份，本机学习数据保留 */
  logout() {
    if (!this.readAuthView().loggedIn) {
      return {
        command: {
          type: 'toast',
          title: '当前没有登录状态'
        }
      }
    }

    this.repository.logout(this.storage)

    return {
      data: this.load().data,
      command: {
        type: 'toast',
        title: '已退出登录'
      }
    }
  }

  openPlayground() {
    return {
      command: {
        type: 'navigate',
        url: '/page/playground/index'
      }
    }
  }
}

module.exports = {
  AGREEMENT_TEXT,
  MyViewModel,
  PRIVACY_TEXT
}
