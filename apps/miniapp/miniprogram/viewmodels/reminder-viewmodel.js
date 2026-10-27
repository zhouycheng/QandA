const practiceRepository = require('../repositories/practice-repository.js')
const { describeAuth } = require('../utils/auth-session.js')
const { maskEmail } = require('../utils/auth-form.js')
const { toDateKey } = require('../utils/exam-countdown.js')
const { FREQUENCY_OPTIONS, buildReminderView } = require('../utils/reminder-settings.js')

/**
 * 邮箱提醒（设计稿 Figma 781:2043）。
 *
 * 交互取舍：开关 / 时间 / 频率 / 提前提醒 / 增删考试**都即时落盘**。
 * 端上没有「取消」按钮，如果攒在内存里等保存，用户左右滑退出就静默丢失改动；
 * 即时保存之后，「保存设置」只是显式确认并返回，不会造成两种心智模型并存。
 */

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {}
  }
}

function getInitialReminderViewData() {
  return {
    emailMasked: '',
    enabled: true,
    reviewEnabled: true,
    examEnabled: true,
    reviewTime: '20:00',
    frequency: 'daily',
    frequencyLabel: '每天',
    // picker 要的两个字段也要有初始值，否则首帧 WXML 读不到
    frequencyOptions: [],
    frequencyIndex: 0,
    summaryLabel: '已开启',
    exams: [],
    examCount: 0,
    advanceOptions: [],
    // 添加考试弹层：与列表同页，避免再开一个页面带走上下文
    addSheetVisible: false,
    examDraftName: '',
    examDraftDate: ''
  }
}

class ReminderViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.examDraft = { name: '', date: '' }
    // 脱敏邮箱只在 load 时读一次身份，后续局部刷新复用，避免每敲一下都读 storage
    this.emailMasked = ''
  }

  static getInitialData() {
    return getInitialReminderViewData()
  }

  load() {
    const reminder = this.repository.getReminder(this.storage)

    this.emailMasked = this.readEmailMasked()

    return {
      data: Object.assign(getInitialReminderViewData(), this.buildView(reminder), {
        examDraftDate: this.examDraft.date || this.todayDateKey()
      })
    }
  }

  readEmailMasked() {
    try {
      return maskEmail(describeAuth(this.repository.getAuth(this.storage)).email)
    } catch (error) {
      return ''
    }
  }

  buildView(reminder) {
    const view = buildReminderView(reminder, { emailMasked: this.emailMasked })

    return {
      emailMasked: view.emailMasked,
      enabled: view.enabled,
      reviewEnabled: view.reviewEnabled,
      examEnabled: view.examEnabled,
      reviewTime: view.reviewTime,
      frequency: view.frequency,
      frequencyLabel: view.frequencyLabel,
      frequencyOptions: view.frequencyOptions,
      frequencyIndex: view.frequencyIndex,
      summaryLabel: view.summaryLabel,
      exams: view.exams,
      examCount: view.examCount,
      advanceOptions: view.advanceOptions
    }
  }

  /** 局部刷新：设置页停留在原处，只更新视图字段 */
  refresh(patch) {
    const reminder = this.repository.getReminder(this.storage)

    return {
      data: Object.assign(this.buildView(reminder), patch || {})
    }
  }

  todayDateKey() {
    return toDateKey(Date.now())
  }

  toggleSwitch(key, value) {
    if (['enabled', 'reviewEnabled', 'examEnabled'].indexOf(key) < 0) {
      return null
    }

    this.repository.updateReminderSwitch(this.storage, key, !!value)

    const result = this.refresh()

    if (key === 'enabled') {
      result.command = {
        type: 'toast',
        title: value ? '已开启邮箱提醒' : '已关闭邮箱提醒'
      }
    }

    return result
  }

  pickTime(time) {
    if (typeof time !== 'string' || !time) {
      return null
    }

    this.repository.updateReminderTime(this.storage, time)

    return this.refresh()
  }

  pickFrequency(value) {
    if (!value) {
      return null
    }

    this.repository.updateReminderFrequency(this.storage, value)

    return this.refresh()
  }

  /** picker 给的是下标，映射成值放这里，页面不用再拉一份选项表 */
  pickFrequencyIndex(index) {
    const option = FREQUENCY_OPTIONS[Number(index)] 

    if (!option) {
      return null
    }

    return this.pickFrequency(option.value)
  }

  /** 提前提醒多选：至少留一个，最后一个取消时给提示而不是静默不动 */
  toggleAdvance(day) {
    const before = this.repository.getReminder(this.storage)
    const next = this.repository.toggleAdvanceDay(this.storage, day)
    const blocked = before.advanceDays.length === 1 &&
      before.advanceDays.indexOf(Number(day)) >= 0 &&
      next.advanceDays.length === 1

    if (blocked) {
      return {
        data: Object.assign(this.buildView(next), {}),
        command: {
          type: 'toast',
          title: '至少保留一个提前提醒时间'
        }
      }
    }

    return this.refresh()
  }

  openAddSheet() {
    this.examDraft = { name: '', date: this.todayDateKey() }

    return {
      data: {
        addSheetVisible: true,
        examDraftName: '',
        examDraftDate: this.examDraft.date
      }
    }
  }

  closeAddSheet() {
    return {
      data: {
        addSheetVisible: false
      }
    }
  }

  /** 名称走 bindblur：放 bindinput 会每敲一个字存一次，也避开光标跳位 */
  setExamDraftName(text) {
    this.examDraft = Object.assign({}, this.examDraft, {
      name: typeof text === 'string' ? text : ''
    })

    return null
  }

  setExamDraftDate(date) {
    if (typeof date === 'string' && date) {
      this.examDraft = Object.assign({}, this.examDraft, { date })
    }

    return {
      data: {
        examDraftDate: this.examDraft.date
      }
    }
  }

  confirmAddExam() {
    const outcome = this.repository.addReminderExam(this.storage, this.examDraft)

    if (!outcome.ok) {
      return {
        command: {
          type: 'toast',
          title: outcome.reason
        }
      }
    }

    this.examDraft = { name: '', date: this.todayDateKey() }

    return {
      data: Object.assign(this.buildView(this.repository.getReminder(this.storage)), {
        addSheetVisible: false,
        examDraftName: '',
        examDraftDate: this.examDraft.date
      }),
      command: {
        type: 'toast',
        title: '已添加考试'
      }
    }
  }

  removeExam(id) {
    if (!id) {
      return null
    }

    this.repository.removeReminderExam(this.storage, id)

    return {
      data: this.buildView(this.repository.getReminder(this.storage)),
      command: {
        type: 'toast',
        title: '已删除考试'
      }
    }
  }

  /** 显式保存：即时保存之后这一步是幂等的确认动作，页面收到后回上一页 */
  save() {
    this.repository.saveReminder(this.storage, this.repository.getReminder(this.storage))

    return {
      data: this.buildView(this.repository.getReminder(this.storage)),
      command: {
        type: 'toast-navigate',
        title: '设置已保存'
      }
    }
  }
}

module.exports = {
  ReminderViewModel
}
