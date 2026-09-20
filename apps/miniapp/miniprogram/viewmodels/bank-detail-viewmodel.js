const practiceRepository = require('../repositories/practice-repository.js')
const {
  summarizeBankProgress,
  summarizeSubjectProgress
} = require('../utils/practice-progress.js')

const COUNT_STEPS = [10, 20, 30]
const DEFAULT_DRAW_COUNT = 10

// 0 分钟表示不限时：此时走普通练习流程，不进入倒计时测试
const DURATION_OPTIONS = [
  { value: 0, label: '不限时' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 20, label: '20 分钟' }
]

const DEFAULT_PRACTICE_MODE = 'order'

// 对应参考产品的三种入口：背题（直接看答案）/ 顺序 / 随机
const PRACTICE_MODE_OPTIONS = [
  { value: 'view', label: '背题模式' },
  { value: 'order', label: '顺序练习' },
  { value: 'practice', label: '随机练习' }
]

function getInitialBankDetailViewData() {
  return {
    subjectId: '',
    subject: null,
    subjects: [],
    banks: [],
    stats: null,
    mode: DEFAULT_PRACTICE_MODE,
    isViewMode: false,
    modeOptions: PRACTICE_MODE_OPTIONS,
    configSheetVisible: false,
    configTitle: '模拟测试',
    countOptions: [],
    selectedCount: DEFAULT_DRAW_COUNT,
    durationOptions: DURATION_OPTIONS,
    selectedDuration: 10,
    routeLoadingVisible: false,
    routeLoadingTitle: '正在开始练习',
    routeLoadingDescription: ''
  }
}

function buildCountOptions(total) {
  const steps = COUNT_STEPS.filter((step) => step < total)
  return steps.concat(total > 0 ? [total] : []).map((value) => ({
    value,
    label: value >= total ? `全部 ${total} 题` : `${value} 题`
  }))
}

function resolveMode(value) {
  const matched = PRACTICE_MODE_OPTIONS.find((option) => option.value === value)
  return matched ? matched.value : DEFAULT_PRACTICE_MODE
}

class BankDetailViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || null
    this.mode = DEFAULT_PRACTICE_MODE
  }

  static getInitialData() {
    return getInitialBankDetailViewData()
  }

  load(subjectId) {
    const subjects = this.repository.getSubjectSummaries()
    const firstSubjectId = subjects.length ? subjects[0].id : ''
    // 题库已是 tabBar 页面，参数失效时不能靠「返回」兜底，
    // 因此回落到第一个科目，避免停在一个空工作台。
    const detail = this.repository.getSubjectDetail(subjectId || firstSubjectId) ||
      this.repository.getSubjectDetail(firstSubjectId)

    if (!detail) {
      return {
        command: {
          type: 'toast',
          title: '题库数据暂不可用'
        }
      }
    }

    this.mode = DEFAULT_PRACTICE_MODE

    return {
      data: this.buildViewData(subjects, detail)
    }
  }

  switchSubject(subjectId) {
    const detail = this.repository.getSubjectDetail(subjectId)

    if (!detail) {
      return null
    }

    return {
      data: this.buildViewData(this.repository.getSubjectSummaries(), detail)
    }
  }

  selectMode(mode) {
    const nextMode = resolveMode(mode)
    this.mode = nextMode

    return {
      data: {
        mode: nextMode,
        // 背题模式下只保留主按钮，副按钮的显隐依赖这个字段
        isViewMode: nextMode === 'view'
      }
    }
  }

  /**
   * 组装左侧科目栏、科目统计与带进度的题库列表。
   */
  buildViewData(subjects, detail) {
    const progress = this.repository.getProgress(this.storage)
    const subjectStats = summarizeSubjectProgress(progress, detail)
    const banks = (detail.banks || []).map((bank) => Object.assign({}, bank, {
      stats: summarizeBankProgress(progress, bank)
    }))

    return {
      subjectId: detail.id,
      subject: detail,
      stats: subjectStats,
      banks,
      mode: this.mode,
      isViewMode: this.mode === 'view',
      modeOptions: PRACTICE_MODE_OPTIONS,
      subjects: subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        theme: subject.theme,
        shortName: subject.shortName,
        bankCount: subject.bankCount,
        questionCount: subject.questionCount,
        active: subject.id === detail.id
      })),
      countOptions: buildCountOptions(detail.questionCount),
      selectedCount: Math.min(DEFAULT_DRAW_COUNT, detail.questionCount || DEFAULT_DRAW_COUNT),
      durationOptions: DURATION_OPTIONS
    }
  }

  openBank(bank) {
    if (!bank) {
      return null
    }

    const targetMode = resolveMode(this.mode)
    const query = [
      `subjectId=${encodeURIComponent(bank.subjectId)}`,
      `bankId=${encodeURIComponent(bank.id)}`,
      `mode=${encodeURIComponent(targetMode)}`
    ]

    if (targetMode === 'practice') {
      query.push(`seed=${Date.now()}`)
    }

    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/practice/index?${query.join('&')}`,
          title: targetMode === 'view' ? '正在打开题目' : '正在开始练习',
          description: bank.name || '读取题库'
        }
      }
    }
  }

  /**
   * 「开始练习」：按当前模式练整科全部题目，不弹抽屉。
   * 顺序 / 背题保持题库原顺序，随机模式由答题页打散。
   */
  startPractice(currentState) {
    const state = currentState || {}
    const mode = resolveMode(state.mode)
    const query = [
      `subjectId=${encodeURIComponent(state.subjectId || '')}`,
      'scope=subject',
      `mode=${encodeURIComponent(mode)}`,
      `seed=${Date.now()}`
    ]

    return {
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/practice/index?${query.join('&')}`,
          title: mode === 'view' ? '正在打开题目' : '正在开始练习',
          description: state.subject ? `${state.subject.name} · 全部题目` : '整科练习'
        }
      }
    }
  }

  /**
   * 「模拟测试」：题量与时长都在抽屉里配置。
   * 时长为「不限时」时退化为普通抽题练习，不进入倒计时。
   */
  openTestConfig() {
    return {
      data: {
        configSheetVisible: true,
        configTitle: '模拟测试'
      }
    }
  }

  closeConfig() {
    return {
      data: {
        configSheetVisible: false
      }
    }
  }

  selectCount(value) {
    const count = Number(value)

    if (!count || count <= 0) {
      return null
    }

    return {
      data: {
        selectedCount: count
      }
    }
  }

  selectDuration(value) {
    // 0 是合法值，代表「不限时」
    const duration = Number(value)

    if (!Number.isFinite(duration) || duration < 0) {
      return null
    }

    return {
      data: {
        selectedDuration: duration
      }
    }
  }

  confirmConfig(currentState) {
    const state = currentState || {}
    const count = Number(state.selectedCount) || DEFAULT_DRAW_COUNT
    const duration = Number(state.selectedDuration) || 0
    const isTimed = duration > 0
    const query = [
      `subjectId=${encodeURIComponent(state.subjectId || '')}`,
      'scope=subject',
      `count=${encodeURIComponent(count)}`,
      `mode=${encodeURIComponent(isTimed ? 'test' : resolveMode(state.mode))}`
    ]

    if (isTimed) {
      query.push(`duration=${encodeURIComponent(duration)}`)
    }

    query.push(`seed=${Date.now()}`)

    return {
      data: {
        configSheetVisible: false
      },
      command: {
        type: 'openRouteWithLoading',
        payload: {
          url: `/page/practice/index?${query.join('&')}`,
          title: isTimed ? '正在生成试卷' : '正在抽题',
          description: isTimed ? `${count} 题 / ${duration} 分钟` : `${count} 题 · 不限时`
        }
      }
    }
  }

  closeRouteLoading() {
    return {
      data: {
        routeLoadingVisible: false
      }
    }
  }

  getShareMessage(subjectId) {
    const subject = this.repository.getSubjectDetail(subjectId)

    return {
      title: subject ? `QandA · ${subject.name}` : 'QandA 题库',
      // 题库是 tabBar 页面，分享路径不能携带参数，进入后落在默认科目
      path: '/page/bank-detail/index'
    }
  }
}

module.exports = {
  BankDetailViewModel,
  DEFAULT_PRACTICE_MODE,
  PRACTICE_MODE_OPTIONS
}
