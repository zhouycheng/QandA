const { PracticeSession } = require('../models/practice-session.js')
const preferences = require('../repositories/preference-repository.js')
const layout = require('../utils/practice-layout.js')
const SAMPLE = { id: 'layout-example', type: 'SINGLE_CHOICE', typeText: '单选题', stem: '学习新知识后，以下哪种复习方式更有助于形成长期记忆？', options: [{ key: 'A', label: 'A', text: '把所有复习集中在考试前一天' }, { key: 'B', label: 'B', text: '间隔一段时间回顾，并主动回忆关键内容' }, { key: 'C', label: 'C', text: '只反复阅读熟悉的段落' }], answerKeys: ['B'], explanation: '间隔复习与主动回忆可以帮助巩固记忆。尝试在当天、几天后和一周后重新回顾知识，再通过练习检查掌握情况。' }
class PracticeLayoutViewModel {
  constructor(options) { this.storage = options.storage }
  static getInitialData() { return Object.assign(require('../models/practice-session.js').getInitialPracticeViewData(), { editLayout: true, moduleLabels: layout.LABELS, dragId: '', dragTarget: '', dragScroll: 0, dragReset: 0, scrollTop: 0, explanationOpen: true }) }
  load() {
    const prefs = preferences.getPreferences(this.storage)
    this.order = prefs.moduleOrder
    const session = new PracticeSession({ quiz: { subjectId: 'layout-example', bankId: 'layout-example', sharePath: '/page/practice-layout/index', title: '答题布局预览', questions: [SAMPLE] }, mode: 'order', preferences: Object.assign({}, prefs, { autoShowExplanation: true, autoNextWhenCorrect: false, showOverviewEntry: true }) })
    session.reset()
    session.selectOption(1)
    return { data: Object.assign(PracticeLayoutViewModel.getInitialData(), session.getViewData(), { editLayout: true, moduleLabels: layout.LABELS, layoutRanks: layout.ranks(this.order), explanationOpen: true }) }
  }
  save(order) {
    const normalized = layout.normalizeOrder(order)
    try {
      preferences.savePreferences(this.storage, Object.assign(preferences.getPreferences(this.storage), { moduleOrder: normalized }))
      this.order = normalized
      return { data: { layoutRanks: layout.ranks(normalized) } }
    } catch (error) { return { data: { layoutRanks: layout.ranks(this.order) }, command: { title: '布局保存失败，已恢复原顺序' } } }
  }
  drop(id, index) { return this.save(layout.move(this.order, id, index)) }
  reset() { return this.save(layout.DEFAULT_ORDER) }
}
module.exports = { PracticeLayoutViewModel }
