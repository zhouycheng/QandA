const { createWxStorageAdapter } = require('./utils/wx-storage.js')
const playgroundSwitch = require('./utils/playground-switch.js')
const practiceRepository = require('./repositories/practice-repository.js')
const http = require('./repositories/http-gateway.js')
const onlinePractice = require('./repositories/online-practice.js')
const remoteData = require('./repositories/remote-data-repository.js')

App({
  globalData: {
    version: '1.0.0',
    // 题库是 tabBar 页面，而 switchTab 不支持 query 参数，
    // 因此首页点科目时先把 subjectId 暂存在这里，由题库页 onShow 时取走。
    pendingSubjectId: ''
  },

  onLaunch() {
    this.globalData.launchAt = Date.now()
    const storage = createWxStorageAdapter()
    const config = typeof wx.getExtConfigSync === 'function' ? wx.getExtConfigSync() || {} : {}
    http.configure({ baseUrl: config.apiBaseUrl || '', tokenProvider: () => practiceRepository.getAuth(storage).token || '' })
    remoteData.enable(true)
    remoteData.bind(storage)
    onlinePractice.enable(storage)
    // Playground 开关存在 storage 里，冷启动必须先同步到内存，
    // 否则上一次开启的 Playground 题库在这次启动中会凭空消失
    playgroundSwitch.syncFromStorage(createWxStorageAdapter())
    // 点击链路诊断的起点：逻辑层只要启动了，第一行日志就一定会有。
    // 如果控制台连这行都没有，说明 appservice 根本没跑起来，
    // 后面所有的「点了没反应」都不用再从业务代码里找。
    console.log('[trace] app onLaunch，逻辑层已启动')
  },

  onShow() {
    this.appVisible = true
    this.lifecycleEpoch = (this.lifecycleEpoch || 0) + 1
    const runtime = onlinePractice.current()
    if (!runtime) return
    try { runtime.identity(); runtime.queue.flushAll().catch(() => {}) } catch (error) { /* 登录后恢复同步 */ }
    this.watchPendingPractice()
  },

  onHide() {
    this.appVisible = false
    const epoch = this.lifecycleEpoch = (this.lifecycleEpoch || 0) + 1
    if (this.practiceWatch) clearTimeout(this.practiceWatch)
    const runtime = onlinePractice.current()
    if (!runtime || !runtime.queue) return
    const queue = runtime.queue
    const owner = runtime.userId
    queue.flushAll().then(async () => {
      for (const id of queue.sessionIds()) {
        if (this.appVisible || this.lifecycleEpoch !== epoch) return
        try {
          if (runtime.identity().userId !== owner) return
          const snapshot = runtime.get(id)
          if (snapshot && snapshot.status === 'IN_PROGRESS' && snapshot.writer && snapshot.writer.writerToken) await runtime.release(id)
        } catch (error) { /* 未确认的草稿保留到下一次联网 */ }
      }
    }).catch(() => {})
  },

  watchPendingPractice() {
    if (this.practiceWatch) clearTimeout(this.practiceWatch)
    if (this.appVisible === false) return
    this.practiceWatch = setTimeout(async () => {
      const runtime = onlinePractice.current()
      if (runtime && runtime.queue) {
        try {
          const ids = Array.from(new Set(runtime.queue.sessionIds().concat(runtime.waitingIds())))
          const eligible = ids.filter((id) => {
            if (id === runtime.activeId) return false
            if (runtime.getWaiting(id)) return true
            const snapshot = runtime.get(id)
            return snapshot && snapshot.status === 'IN_PROGRESS' && snapshot.writer && snapshot.writer.writerToken && snapshot.writer.deviceId === runtime.deviceId()
          })
          const start = (this.practiceCursor || 0) % (eligible.length || 1)
          const count = Math.min(4, eligible.length)
          for (let offset = 0; offset < count; offset += 1) {
            if (this.appVisible === false) break
            const id = eligible[(start + offset) % eligible.length]
            const waiting = runtime.getWaiting(id)
            const writer = await runtime.poll(id)
            if (waiting && writer && writer.state === 'ACTIVE' && writer.writerToken && !(waiting.writer && waiting.writer.writerToken)) {
              wx.showToast({ title: '上次练习已完成同步，可继续答题', icon: 'none' })
            }
            if (!waiting && writer && writer.pendingDeviceId) await runtime.release(id)
          }
          this.practiceCursor = (start + count) % (eligible.length || 1)
        } catch (error) { /* 草稿与等待状态保留，下一次联网重试 */ }
      }
      this.watchPendingPractice()
    }, 15000 + Math.floor(Math.random() * 3000))
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
