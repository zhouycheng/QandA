const {
  SESSION_STATUS,
  STORAGE_KEY,
  SYNC_STATUS,
  isResumable,
  normalizeSession,
  serializeSession
} = require('../models/practice-session-state.js')

/**
 * 仓储层：PracticeSession 读写。计算与序列化在 models/practice-session-state.js。
 *
 * 只保留一份「当前会话」：小程序单键 1MB，且同一时刻用户只可能在一场练习里。
 * 开始新练习会覆盖旧的，这是刻意的选择——用户主动开新卷就等于放弃上一份。
 *
 * storage 由页面注入（微信端传 wx 适配器），未注入时退化为空实现，便于在 Node 中测试。
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

function getStorageAdapter(storage) {
  return storage || createNullStorage()
}

function readRawSession(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(STORAGE_KEY)
  } catch (error) {
    return null
  }

  // 真实 wx.getStorageSync 在键不存在时返回空字符串 ''，内存 mock 返回 null
  return normalizeSession(raw)
}

function getSession(storage) {
  return readRawSession(storage)
}

/** 还能接着答的会话：入口页用它决定要不要弹「继续练习」 */
function getResumableSession(storage) {
  const session = readRawSession(storage)

  return isResumable(session) ? session : null
}

/** 已交卷但没同步成功的：结果页用它给出重试入口 */
function getPendingSession(storage) {
  const session = readRawSession(storage)

  if (!session) {
    return null
  }

  const isSubmitted = session.status === SESSION_STATUS.SUBMITTED
  const isSynced = session.syncStatus === SYNC_STATUS.SYNCED || session.syncStatus === SYNC_STATUS.LOCAL_ONLY

  return isSubmitted && !isSynced ? session : null
}

function saveSession(storage, session, now) {
  const adapter = getStorageAdapter(storage)
  const timestamp = typeof now === 'number' ? now : Date.now()
  const payload = serializeSession(Object.assign({}, session, {
    updatedAt: timestamp,
    createdAt: session && session.createdAt ? session.createdAt : timestamp
  }))

  try {
    adapter.set(STORAGE_KEY, payload)
  } catch (error) {
    return payload
  }

  return payload
}

function clearSession(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(STORAGE_KEY)
  } catch (error) {
    return false
  }

  return true
}

module.exports = {
  clearSession,
  getPendingSession,
  getResumableSession,
  getSession,
  saveSession
}
