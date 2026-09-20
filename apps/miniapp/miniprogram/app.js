const { createWxStorageAdapter } = require('./utils/wx-storage.js')
const playgroundSwitch = require('./utils/playground-switch.js')
const practiceRepository = require('./repositories/practice-repository.js')

App({
  globalData: {
    version: 'v1-mock-snapshot',
    // 题库是 tabBar 页面，而 switchTab 不支持 query 参数，
    // 因此首页点科目时先把 subjectId 暂存在这里，由题库页 onShow 时取走。
    pendingSubjectId: ''
  },

  onLaunch() {
    this.globalData.launchAt = Date.now()
    // 用户自助导入的题库存在 storage 里，也要在冷启动时挂回 catalog，
    // 否则上次导入的题库这次打开就不见了
    practiceRepository.syncUserBanks(createWxStorageAdapter())
    // Playground 开关存在 storage 里，冷启动必须先同步到内存，
    // 否则上一次开启的 Playground 题库在这次启动中会凭空消失
    playgroundSwitch.syncFromStorage(createWxStorageAdapter())
    // 点击链路诊断的起点：逻辑层只要启动了，第一行日志就一定会有。
    // 如果控制台连这行都没有，说明 appservice 根本没跑起来，
    // 后面所有的「点了没反应」都不用再从业务代码里找。
    console.log('[trace] app onLaunch，逻辑层已启动')
  },

  /**
   * 全局错误兜底：页面里抛的错会在这里以 `[trace] 未捕获` 打出来。
   * 之前排查「点不动」时控制台干干净净，就是因为没有这一层，
   * 分不清「没触发」和「触发了但内部报错被吞掉」。
   */
  onError(error) {
    console.error(`[trace] 未捕获错误：${error}`)
  },

  onUnhandledRejection(res) {
    console.error(`[trace] 未处理的 Promise 拒绝：${res && res.reason ? res.reason : res}`)
  },

  setPendingSubjectId(subjectId) {
    this.globalData.pendingSubjectId = subjectId || ''
  },

  /** 取走即清空，避免下次普通切换 tab 时被重复消费 */
  consumePendingSubjectId() {
    const subjectId = this.globalData.pendingSubjectId || ''

    this.globalData.pendingSubjectId = ''

    return subjectId
  }
})
