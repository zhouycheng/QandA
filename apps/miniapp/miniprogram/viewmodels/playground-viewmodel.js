const practiceRepository = require('../repositories/practice-repository.js')

/**
 * Playground 面板（PRD 第 7 节）。
 *
 * 面板只做三件事：
 * 1. 开关 Playground 总开关（开启后科目列表才出现 Playground 题库）；
 * 2. 一键应用某个场景（切网关行为 + 写会话预设），并给出可直接进入练习的链接；
 * 3. 显示当前网关（Mock / HTTP），必要时退回 Mock。
 *
 * 这是开发工具，入口藏在设置页「版本号连点 5 次」后面，默认不出现在任何 tab 里。
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

function getInitialPlaygroundViewData() {
  return {
    enabled: false,
    scenarios: [],
    currentScenario: '',
    currentScenarioLabel: '',
    gatewayName: 'mock',
    gatewayText: 'Mock',
    note: ''
  }
}

class PlaygroundViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialPlaygroundViewData()
  }

  load() {
    // 开关状态存在 storage 里，进入面板时先同步一次，
    // 否则上一次开启的状态在冷启动后会被内存里的默认值覆盖掉
    if (typeof this.repository.syncPlaygroundEnabled === 'function') {
      this.repository.syncPlaygroundEnabled(this.storage)
    }

    return {
      data: this.buildData()
    }
  }

  buildData() {
    const enabled = this.repository.isPlaygroundEnabled()
    const current = this.repository.getMockScenario(this.storage)
    const scenarios = this.repository.listPlaygroundScenarios().map((scenario) => ({
      key: scenario.key,
      label: scenario.label,
      hint: scenario.hint,
      questionCountText: `${scenario.bankId === 'playground-empty' ? 0 : scenario.bankId === 'playground-stress' ? 100 : 20} 题`,
      isCurrent: scenario.key === current
    }))
    const currentScenario = scenarios.find((item) => item.isCurrent)
    const gatewayName = this.repository.getGatewayName()

    return Object.assign({}, getInitialPlaygroundViewData(), {
      enabled,
      scenarios,
      currentScenario: current,
      currentScenarioLabel: currentScenario ? currentScenario.label : current,
      gatewayName,
      gatewayText: gatewayName === 'mock' ? 'Mock（本地）' : 'HTTP（联调）',
      note: enabled
        ? '已开启：题库页会多出 Playground 科目（正常 20 题 / 空 0 题 / 100 题压力）'
        : '关闭时 Playground 题库不会出现在题库列表，线上即为此状态'
    })
  }

  toggleEnabled(value) {
    this.repository.setPlaygroundEnabled(this.storage, !!value)

    return {
      data: this.buildData()
    }
  }

  /** 应用场景并返回跳转练习的命令：一步到位，省掉「切完再自己找入口」 */
  applyScenario(name) {
    const applied = this.repository.applyPlaygroundScenario(this.storage, name)

    return {
      data: this.buildData(),
      command: {
        type: 'navigate',
        url: applied.url
      }
    }
  }

  resetGateway() {
    this.repository.resetGateway()

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已退回 Mock 网关'
      }
    }
  }
}

module.exports = {
  PlaygroundViewModel,
  getInitialPlaygroundViewData
}
