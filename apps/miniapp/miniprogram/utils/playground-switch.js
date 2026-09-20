/**
 * Playground 总开关（PRD 第 7 节：Playground 属于开发工具，不进入生产版本）。
 *
 * 用运行时开关而不是编译期常量的原因：Playground 题库要出现在科目列表里才能被
 * 真实页面走到（否则「空题库」「100 题压力」只能停留在单元测试里）。
 * 开关默认关闭 → 线上与默认数据完全不受影响；开发者在 Playground 面板打开后，
 * 题库列表才追加 Playground 科目。
 */

const STORAGE_KEY = 'qandaPlayground'

let enabled = false

function isEnabled() {
  return enabled === true
}

function setEnabled(storage, value) {
  enabled = value === true

  if (storage && typeof storage.set === 'function') {
    storage.set(STORAGE_KEY, enabled ? '1' : '0')
  }

  return enabled
}

/**
 * 从 storage 恢复开关。真实 wx.getStorageSync 缺键返回空字符串 ''，
 * 内存 mock 返回 null，两种都要能吃下。
 */
function syncFromStorage(storage) {
  const raw = storage && typeof storage.get === 'function' ? storage.get(STORAGE_KEY) : null
  enabled = raw === '1' || raw === true || raw === 1

  return enabled
}

module.exports = {
  STORAGE_KEY,
  isEnabled,
  setEnabled,
  syncFromStorage
}
