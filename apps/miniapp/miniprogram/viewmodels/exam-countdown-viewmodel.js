const repository = require('../repositories/preference-repository.js')
const { buildExamCountdown, validateExamInput } = require('../utils/exam-countdown.js')
class ExamCountdownViewModel {
  constructor(options) { this.storage = options.storage }
  static getInitialData() { return { examDraftName: '', exam: buildExamCountdown(null) } }
  load() { const preferences = repository.getPreferences(this.storage); return { data: { examDraftName: preferences.examName, exam: buildExamCountdown(preferences) } } }
  save(change) {
    const preferences = Object.assign(repository.getPreferences(this.storage), change)
    if (preferences.examName && preferences.examDate) {
      const check = validateExamInput(preferences.examName, preferences.examDate)
      if (!check.ok) return { command: { title: check.reason } }
    }
    try { repository.savePreferences(this.storage, preferences); return this.load() }
    catch (error) { return { data: this.load().data, command: { title: '倒计时保存失败，请释放本机空间后重试' } } }
  }
  setExamName(value) { const name = String(value || '').trim(); return this.save(name ? { examName: name } : { examName: '', examDate: '' }) }
  setExamDate(value) { return this.save({ examDate: value }) }
  clearExam() { return this.save({ examName: '', examDate: '' }) }
}
module.exports = { ExamCountdownViewModel }
