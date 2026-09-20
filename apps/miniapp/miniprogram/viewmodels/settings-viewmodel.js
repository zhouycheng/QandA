const practiceRepository = require('../repositories/practice-repository.js')
const { PREFERENCE_CHOICES, buildPreferenceView } = require('../utils/preferences.js')

/**
 * 账户安全项。
 *
 * 小程序当前是本地题库模式，没有登录态，因此这三项先把入口与说明摆出来、
 * 统一标记为「待接入」：等后端账号接口就绪，只需把 available 改成 true
 * 并在 ViewModel 里接上对应调用，页面模板不用动。
 */
const ACCOUNT_ACTIONS = [
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
    available: false
  }
]

const PLAYGROUND_URL = '/page/playground/index'

const ACCOUNT_MESSAGES = {
  password: '账号体系尚未接入，暂时不能修改密码',
  email: '账号体系尚未接入，暂时不能更换邮箱',
  logout: '当前是本地模式，没有需要退出的登录状态'
}

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {}
  }
}

function getInitialSettingsViewData() {
  return {
    switches: [],
    choices: [],
    accountActions: ACCOUNT_ACTIONS,
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
    const preferenceView = buildPreferenceView(this.repository.getPreferences(this.storage))

    return Object.assign({}, getInitialSettingsViewData(), {
      switches: preferenceView.switches,
      choices: preferenceView.choices,
      playgroundEnabled: this.repository.isPlaygroundEnabled(),
      catalog: this.repository.getCatalogStats()
    })
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

  openAccountAction(key) {
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

module.exports = {
  ACCOUNT_ACTIONS,
  ACCOUNT_MESSAGES,
  SettingsViewModel
}
