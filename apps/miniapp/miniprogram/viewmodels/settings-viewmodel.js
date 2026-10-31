const repository = require('../repositories/practice-repository.js')
const { buildPreferenceView } = require('../utils/preferences.js')
const FONT_PREVIEW_TEXT = '预览：下列关于我国根本政治制度的表述，正确的一项是？'
class SettingsViewModel {
  constructor(options) { this.repository = options.repository || repository; this.storage = options.storage }
  static getInitialData() { return { switches: [], choices: [], fontSize: 'normal', fontPreviewText: FONT_PREVIEW_TEXT } }
  load() {
    const preferences = this.repository.getPreferences(this.storage)
    return { data: Object.assign(SettingsViewModel.getInitialData(), buildPreferenceView(preferences), { fontSize: preferences.fontSize }) }
  }
  save(action) {
    try { action(); return this.load() } catch (error) { return { data: this.load().data, command: { type: 'toast', title: '设置保存失败，请释放本机空间后重试' } } }
  }
  toggleSwitch(key, value) { return key ? this.save(() => this.repository.updatePreferenceSwitch(this.storage, key, !!value)) : null }
  selectChoice(key, value) { return this.save(() => this.repository.updatePreferenceChoice(this.storage, key, value)) }
  resetPreferences() { const result = this.save(() => this.repository.resetPreferences(this.storage)); if (!result.command) result.command = { type: 'toast', title: '已恢复默认答题偏好' }; return result }
}
module.exports = { FONT_PREVIEW_TEXT, SettingsViewModel }
