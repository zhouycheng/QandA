const practiceRepository = require('../repositories/practice-repository.js')
const { PREFERENCE_CHOICES, buildPreferenceView } = require('../utils/preferences.js')
const { GUEST_NAME, describeAuth, getAuthHint } = require('../utils/auth-session.js')
const { buildExamCountdown, toDateKey, validateExamInput } = require('../utils/exam-countdown.js')

/**
 * 账户安全项。
 *
 * 登录已经落地（微信登录 + 本地身份降级），所以这里分成两类：
 *   - 已可用：微信登录、退出登录
 *   - 待接入：修改密码、更换邮箱（后端账号接口还没有）
 *
 * 仍标 available: false 的项只回一句说明，不静默无反应。
 */
const ACCOUNT_ACTIONS = [
  {
    key: 'wechat',
    icon: 'shield',
    title: '微信登录',
    description: '使用微信身份登录，后端未接入时自动使用本地身份',
    available: true
  },
  {
    key: 'password',
    icon: 'lock',
    title: '修改密码',
    description: '登录密码 6-20 位，修改后需要重新登录',
    available: false
  },
  {
    key: 'email',
    icon: 'mail',
    title: '更换邮箱',
    description: '用于找回密码与接收重要通知',
    available: false
  },
  {
    key: 'logout',
    icon: 'logout',
    title: '退出登录',
    description: '退出后本机学习数据仍会保留',
    available: true
  }
]

const PLAYGROUND_URL = '/page/playground/index'
const LOGIN_URL = '/page/login/index'

const ACCOUNT_MESSAGES = {
  password: '账号体系尚未接入，暂时不能修改密码',
  email: '账号体系尚未接入，暂时不能更换邮箱',
  logout: '当前没有登录状态'
}

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {}
  }
}

/**
 * 字号预览用的示例题干。
 * 改字号后用户得**当场**看到变化，只改个选中态会让人以为没生效——
 * 而答题页要重新进才读得到新偏好，当场看不到。
 */
const FONT_PREVIEW_TEXT = '预览：下列关于我国根本政治制度的表述，正确的一项是？'

function createGuestAuthView() {
  return {
    loggedIn: false,
    displayName: GUEST_NAME,
    avatarUrl: '',
    accountTag: GUEST_NAME,
    providerLabel: '',
    hint: ''
  }
}

function getInitialSettingsViewData() {
  return {
    switches: [],
    choices: [],
    accountActions: ACCOUNT_ACTIONS,
    auth: createGuestAuthView(),
    fontSize: 'normal',
    fontPreviewText: FONT_PREVIEW_TEXT,
    // 考试倒计时：首页卡片的数据源，未设置时 configured=false
    exam: buildExamCountdown(null),
    // 改名失焦时用它回填输入框，避免用户输入被中间态覆盖
    examDraftName: '',
    // Playground 是开发工具，入口默认不显示；连点版本号解锁后才出现
    playgroundEnabled: false,
    catalog: {
      subjectCount: 0,
      bankCount: 0,
      questionCount: 0
    }
  }
}

class SettingsViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialSettingsViewData()
  }

  load() {
    return {
      data: this.buildData()
    }
  }

  buildData() {
    const preferences = this.repository.getPreferences(this.storage)
    const preferenceView = buildPreferenceView(preferences)
    const auth = this.readAuthView()

    return Object.assign({}, getInitialSettingsViewData(), {
      switches: preferenceView.switches,
      choices: preferenceView.choices,
      fontSize: preferences.fontSize || 'normal',
      exam: buildExamCountdown({ examName: preferences.examName, examDate: preferences.examDate }),
      // 考试名称 / 日期：填齐才算设置成功，先存已填的一半并提示补齐
    examDraftName: preferences.examName || '',
      accountActions: buildAccountActions(auth),
      auth,
      playgroundEnabled: this.repository.isPlaygroundEnabled(),
      catalog: this.repository.getCatalogStats()
    })
  }

  /** 读身份失败不能让设置页白屏，退化成未登录视图 */
  readAuthView() {
    try {
      const auth = this.repository.getAuth(this.storage)
      const view = describeAuth(auth)

      return {
        loggedIn: view.loggedIn,
        displayName: view.displayName,
        avatarUrl: view.avatarUrl,
        accountTag: view.accountTag,
        providerLabel: view.providerLabel,
        hint: getAuthHint(auth)
      }
    } catch (error) {
      return createGuestAuthView()
    }
  }

  /** 开关型偏好：直接落盘并回传最新视图 */
  toggleSwitch(key, value) {
    if (!key) {
      return null
    }

    this.repository.updatePreferenceSwitch(this.storage, key, !!value)

    return {
      data: this.buildData()
    }
  }

  /**
   * 选择型偏好。
   * 尚未开放的选项（如发音音色）不改数据，只回一句说明，
   * 避免用户点了没反应、以为界面坏了。
   */
  selectChoice(key, value) {
    const definition = PREFERENCE_CHOICES.find((item) => item.key === key)

    if (!definition) {
      return null
    }

    if (!definition.available) {
      return {
        command: {
          type: 'toast',
          title: `${definition.label}会在题目朗读接入后开放`
        }
      }
    }

    this.repository.updatePreferenceChoice(this.storage, key, value)

    return {
      data: this.buildData()
    }
  }

  resetPreferences() {
    this.repository.resetPreferences(this.storage)

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已恢复默认设置'
      }
    }
  }

  /** 考试名称：失焦时落盘，空值视为「没填」，不写进偏好 */
  setExamName(text) {
    const name = typeof text === 'string' ? text.trim() : ''
    const preferences = this.repository.getPreferences(this.storage)

    // 名称清空时连同日期一起清掉，留一个没名字的倒计时没有意义
    if (!name) {
      this.repository.updatePreferenceText(this.storage, 'examName', '')
      this.repository.updatePreferenceText(this.storage, 'examDate', '')

      return {
        data: this.buildData(),
        command: {
          type: 'toast',
          title: '已清除考试倒计时'
        }
      }
    }

    this.repository.updatePreferenceText(this.storage, 'examName', name)

    // 已有日期时立刻校验一次，避免名字填完却卡在日期上没有任何反馈
    const date = preferences.examDate
    const check = date ? validateExamInput(name, date) : null

    return {
      data: this.buildData(),
      command: check && !check.ok
        ? { type: 'toast', title: check.reason }
        : null
    }
  }

  /**
   * 考试日期：pickDate 给 'YYYY-MM-DD'。
   * 日期与名称要凑齐才算设置成功，只选日期没填名称时先存下日期并提示补名称。
   */
  setExamDate(dateKey) {
    const date = typeof dateKey === 'string' ? dateKey : ''
    const preferences = this.repository.getPreferences(this.storage)
    const name = (preferences.examName || '').trim()

    if (!date) {
      return null
    }

    if (!name) {
      this.repository.updatePreferenceText(this.storage, 'examDate', date)

      return {
        data: this.buildData(),
        command: {
          type: 'toast',
          title: '请再填写考试名称'
        }
      }
    }

    const check = validateExamInput(name, date)

    if (!check.ok) {
      return {
        command: {
          type: 'toast',
          title: check.reason
        }
      }
    }

    this.repository.updatePreferenceText(this.storage, 'examDate', check.value.examDate)

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: `已设置${check.value.examName}倒计时`
      }
    }
  }

  /** 清除考试倒计时：名称和日期一起清，避免残留半天状态 */
  clearExam() {
    this.repository.updatePreferenceText(this.storage, 'examName', '')
    this.repository.updatePreferenceText(this.storage, 'examDate', '')

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已清除考试倒计时'
      }
    }
  }

  /** picker 的起始日期就是今天，避免用户选到过去 */
  getTodayDateKey() {
    return toDateKey(Date.now())
  }

  /**
   * 解锁 Playground 入口：连点版本号触发，一次解锁长期有效（存 storage）。
   * 做成隐藏入口是为了让线上界面保持干净——Playground 不进入生产版本（PRD 7）。
   */
  unlockPlayground() {
    if (this.repository.isPlaygroundEnabled()) {
      return {
        command: {
          type: 'navigate',
          url: PLAYGROUND_URL
        }
      }
    }

    this.repository.setPlaygroundEnabled(this.storage, true)

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已开启 Playground 开发者面板'
      }
    }
  }

  openPlayground() {
    return {
      command: {
        type: 'navigate',
        url: PLAYGROUND_URL
      }
    }
  }

  /**
   * 账户项。
   * 微信登录进登录页（已登录时在里面改资料 / 退出），退出登录就地执行，
   * 未接入的两项只给说明——点了要给反馈，不能静默。
   */
  openAccountAction(key) {
    const auth = this.readAuthView()

    if (key === 'wechat') {
      return {
        command: {
          type: 'navigate',
          url: LOGIN_URL
        }
      }
    }

    if (key === 'logout') {
      if (!auth.loggedIn) {
        return {
          command: {
            type: 'toast',
            title: ACCOUNT_MESSAGES.logout
          }
        }
      }

      this.repository.logout(this.storage)

      return {
        data: this.buildData(),
        command: {
          type: 'toast',
          title: '已退出登录'
        }
      }
    }

    const message = ACCOUNT_MESSAGES[key]

    if (!message) {
      return null
    }

    return {
      command: {
        type: 'toast',
        title: message
      }
    }
  }
}

/** 账户菜单按登录态裁剪：没登录就不给「退出登录」，登录项的文案随状态变 */
function buildAccountActions(auth) {
  const state = auth || createGuestAuthView()

  return ACCOUNT_ACTIONS.filter((item) => item.key !== 'logout' || state.loggedIn).map((item) => {
    if (item.key === 'wechat') {
      return Object.assign({}, item, {
        title: state.loggedIn ? '微信账号' : '微信登录',
        description: state.loggedIn ? '已登录，可修改头像昵称或退出登录' : item.description,
        tag: state.loggedIn ? state.accountTag : '去登录'
      })
    }

    return Object.assign({}, item, {
      tag: item.available ? '' : '待接入'
    })
  })
}

module.exports = {
  ACCOUNT_ACTIONS,
  ACCOUNT_MESSAGES,
  FONT_PREVIEW_TEXT,
  LOGIN_URL,
  SettingsViewModel,
  buildAccountActions
}
