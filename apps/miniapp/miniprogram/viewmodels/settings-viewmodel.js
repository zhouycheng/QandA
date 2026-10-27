const practiceRepository = require('../repositories/practice-repository.js')
const { PREFERENCE_CHOICES, buildPreferenceView } = require('../utils/preferences.js')
const { buildExamCountdown, toDateKey, validateExamInput } = require('../utils/exam-countdown.js')

/**
 * 设置页 = 答题偏好页。
 *
 * 账号相关的操作在改版后归「我的 · 账号管理」（设计稿 781:2123），
 * 这里不再放一份——同一个开关两处都能改，迟早改出两种文案和两种状态。
 * 关于 / Playground 仍留在这里，「我的」的「关于QandA」行直接跳到本页锚点。
 */

const PLAYGROUND_URL = '/page/playground/index'

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

function getInitialSettingsViewData() {
  return {
    switches: [],
    choices: [],
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

    return Object.assign({}, getInitialSettingsViewData(), {
      switches: preferenceView.switches,
      choices: preferenceView.choices,
      fontSize: preferences.fontSize || 'normal',
      exam: buildExamCountdown({ examName: preferences.examName, examDate: preferences.examDate }),
      // 考试名称 / 日期：填齐才算设置成功，先存已填的一半并提示补齐
      examDraftName: preferences.examName || '',
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
   * 清空本机学习数据。
   * 改版后「我的」页只放导航，危险操作收到设置页底部；
   * 具体清哪些交给仓储层的一份实现（与页面身份无关）。
   */
  clearRecords() {
    this.repository.clearLearningData(this.storage)

    return {
      data: this.buildData(),
      command: {
        type: 'toast',
        title: '已清空本机学习数据'
      }
    }
  }
}

module.exports = {
  FONT_PREVIEW_TEXT,
  SettingsViewModel
}
