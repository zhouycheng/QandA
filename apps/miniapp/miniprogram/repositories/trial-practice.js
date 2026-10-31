const http = require('./http-gateway.js')
const { OnlinePractice } = require('./online-practice.js')
const KEY = 'qandaTrialPractice'
const LIMIT = 2
let creating = null

function read(storage) {
  const value = storage.get(KEY)
  if (!value) return { version: 1, sessions: [] }
  if (value.version !== 1 || !Array.isArray(value.sessions)) throw new Error('试答记录无法读取，请联系支持')
  return JSON.parse(JSON.stringify(value))
}
function list(storage) { return read(storage).sessions }
function get(storage, id) { return list(storage).find(item => item.id === id) || null }
function remaining(storage) { return Math.max(0, LIMIT - list(storage).length) }
function quotaError() { const error = new Error('本机的两次试答已使用，登录后可继续练习'); error.code = 'TRIAL_LIMIT'; return error }
function resumable(storage) { return list(storage).slice().reverse().find(item => item.status !== 'SUBMITTED') || null }
async function required(method, path, body) {
  const response = await http.request(method, path, body, { token: '' })
  if (!response.ok) throw new Error(response.reason || '读取试答失败，请联网后重试')
  return response.data
}
function prepare(storage, options) {
  const saved = options.sessionId ? get(storage, options.sessionId) : options.resume === '1' ? resumable(storage) : null
  if (saved) return Promise.resolve(saved)
  if (options.sessionId) return Promise.reject(new Error('请登录原账号后恢复这次练习'))
  if (creating) return creating
  creating = create(storage, options).finally(() => { creating = null })
  return creating
}
async function create(storage, options) {
  if (!remaining(storage)) throw quotaError()
  if (options.selectionKind && options.selectionKind !== 'NORMAL') throw new Error('登录后可按错题或收藏范围练习')
  if (!options.bankId) throw new Error('请选择一个题库开始试答')
  const bank = require('./remote-data-repository.js').getBankMeta(options.bankId) || await required('GET', '/question-banks/' + options.bankId)
  const scope = { questionBankId: bank.id || options.bankId, count: Math.min(Number(options.count) || bank.questionCount || bank.activeQuestionCount || 20, 1000), order: ['practice', 'test'].includes(options.mode) ? 'RANDOM' : 'SEQUENTIAL', selectionKind: 'NORMAL', chapterIds: options.chapterId ? [options.chapterId] : [] }
  if (options.ids) { scope.questionIds = String(options.ids).split(',').filter(Boolean); scope.count = scope.questionIds.length }
  const snapshot = await required('POST', '/practice/trial-snapshots', { scope, expectedContentVersion: bank.contentVersion, feedback: options.mode === 'test' ? 'AFTER_FINISH' : 'IMMEDIATE' })
  if (!snapshot || !snapshot.id || !snapshot.items || !snapshot.items.length || !Array.isArray(snapshot.offlineGrading) || snapshot.items.some(item => !item.question || !snapshot.offlineGrading.some(grading => grading.itemId === item.itemId))) throw new Error('试答内容下载不完整，请重试')
  snapshot.route = Object.assign({}, options, { bankId: snapshot.questionBankId })
  snapshot.title = bank.name
  snapshot.status = 'IN_PROGRESS'
  snapshot.currentIndex = 0
  snapshot.durationSeconds = 0
  const record = read(storage)
  if (record.sessions.length >= LIMIT) throw quotaError()
  record.sessions.push(snapshot)
  // 快照与已用次数在同一次写入中保存；失败时不进入答题。
  storage.set(KEY, record)
  return snapshot
}
const projection = OnlinePractice.prototype
function quiz(snapshot) { return projection.quiz(snapshot) }
function restored(snapshot) { return projection.restored.call({ quiz }, snapshot) }
function save(storage, session) {
  const record = read(storage)
  const snapshot = record.sessions.find(item => item.id === session.meta.sessionId)
  if (!snapshot) throw new Error('试答记录不存在，无法保存')
  const state = JSON.parse(JSON.stringify(session.getPersistedState()))
  if ((!state.answers[state.currentIndex] || state.answers[state.currentIndex].confirmed === false) && session.state.selectedKeys.length) {
    state.answers[state.currentIndex] = { questionId: session.state.questions[state.currentIndex].id, selectedKeys: session.state.selectedKeys.slice(), confirmed: false, isCorrect: false }
  }
  snapshot.localState = state
  snapshot.status = state.status
  snapshot.updatedAt = new Date().toISOString()
  storage.set(KEY, record)
}
function recent(storage) {
  return list(storage).slice().reverse().map(snapshot => ({ id: snapshot.id, questionBankId: snapshot.questionBankId, title: snapshot.title, questionBankName: snapshot.title, status: snapshot.status, mode: snapshot.route.mode, totalQuestions: snapshot.items.length, answeredCount: snapshot.localState ? snapshot.localState.answers.filter(answer => answer && answer.confirmed !== false).length : 0, createdAt: snapshot.createdAt }))
}
module.exports = { KEY, LIMIT, list, get, remaining, prepare, resumable, quiz, restored, save, recent }
