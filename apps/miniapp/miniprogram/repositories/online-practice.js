const http = require('./http-gateway.js')
const auth = require('./auth-repository.js')
const { createSyncQueue } = require('./practice-sync-queue.js')
let runtime = null

function mapQuestion(item, grading) {
  const q = item.question
  const g = grading || q
  const boolean = q.type === 'TRUE_FALSE'
  return {
    id: q.id, itemId: item.itemId, revisionId: q.revisionId, type: q.type,
    typeText: { SINGLE_CHOICE: '单选题', MULTIPLE_CHOICE: '多选题', TRUE_FALSE: '判断题', SHORT_ANSWER: '简答题' }[q.type],
    stem: q.stem, isMultiple: q.type === 'MULTIPLE_CHOICE', isShortAnswer: q.type === 'SHORT_ANSWER',
    options: boolean ? [{ key: 'true', label: '对', text: '正确' }, { key: 'false', label: '错', text: '错误' }] : (q.options || []).map(o => ({ key: o.key, label: o.key, text: o.content })),
    answerKeys: boolean ? [String(g.correctValue)] : (g.correctAnswer || []),
    referenceAnswer: g.referenceAnswer || '', explanation: g.explanation || '', assetIds: q.assetIds || []
  }
}
function enable(storage) { runtime = new OnlinePractice(storage); return runtime }
function current() { return runtime }
class OnlinePractice {
  constructor(storage) { this.storage = storage; this.userId = ''; this.token = ''; this.queue = null; this.releasing = {}; this.finishing = {}; this.creating = {} }
  identity() {
    const identity = auth.getAuth(this.storage)
    if (!identity.loggedIn || !identity.token) throw new Error('请先登录')
    if (this.userId !== identity.userId) {
      if (this.queue) this.queue.stop()
      this.userId = identity.userId
      const queueUserId = this.userId
      this.queue = createSyncQueue({ storage: this.storage, userId: queueUserId, send: (id, command) => this.send(id, command, queueUserId), onChange: (id, draft) => {
        if (draft.lastAcknowledgedKey) this.storage.remove(`qandaOnline:${queueUserId}:${id}:wire:${draft.lastAcknowledgedKey}`)
      } })
    }
    if (this.token !== identity.token) {
      this.token = identity.token
      this.queue.resumeAuthOnly().catch(() => {})
    }
    return identity
  }
  key(id) { return `qandaOnline:${this.userId}:${id}` }
  get(id) { this.identity(); return this.storage.get(this.key(id)) || null }
  put(id, value) { this.storage.set(this.key(id), value) }
  deviceId() {
    let id = this.storage.get('qandaDeviceId')
    if (!id) { id = http.uuid(); this.storage.set('qandaDeviceId', id) }
    return id
  }
  async call(method, path, body, options) {
    const identity = this.identity()
    const response = await http.request(method, path, body, Object.assign({ token: identity.token }, options))
    if (auth.getAuth(this.storage).userId !== identity.userId) return { ok: false, statusCode: 401, reason: '账号已切换，请重新打开练习' }
    return response
  }
  async required(method, path, body, options) {
    const response = await this.call(method, path, body, options)
    if (!response.ok) throw new Error(response.reason || '请求失败，请重试')
    return response.data
  }
  async prepare(options) {
    this.identity()
    const id = options.sessionId || (options.resume === '1' ? this.storage.get(`qandaOnlineLast:${this.userId}`) : '')
    if (id) {
      let cached = this.get(id)
      if (cached && cached.releaseCommand) {
        if (!await this.release(id)) throw new Error('正在确认练习同步状态，请保持联网后重试')
        cached = this.get(id)
      }
      let ordinary = cached
      if (cached && cached.status === 'SUBMITTED') return cached
      if (!cached || !cached.writer || !cached.writer.writerToken || cached.writer.deviceId !== this.deviceId()) {
        const remote = await this.required('GET', `/practice/sessions/${id}`)
        ordinary = remote
        if (remote.status === 'SUBMITTED') {
          remote.result = await this.required('GET', `/practice/sessions/${id}/result`)
          remote.items = remote.result.items
          return this.remember(remote, options)
        }
      }
      if (cached && cached.writer && cached.writer.deviceId === this.deviceId() && cached.writer.writerToken) {
        // 草稿始终先恢复；写入权变化由状态查询与服务端凭证校验收敛。
        return cached
      }
      const writer = await this.required('POST', `/practice/sessions/${id}/writer-acquire`, { deviceId: this.deviceId() }, { idempotencyKey: http.uuid() })
      if (writer.state !== 'ACTIVE' || !writer.writerToken) {
        const route = Object.assign({}, ordinary.route || {}, options || {}, { bankId: ordinary.questionBankId })
        this.rememberWaiting(id, route, writer)
        return { id, waiting: true, writer, route }
      }
      this.forgetWaiting(id)
      const snapshot = await this.required('GET', `/practice/sessions/${id}/snapshot?deviceId=${this.deviceId()}`, null, { headers: { 'X-Practice-Writer': writer.writerToken } })
      snapshot.writer = writer
      return this.remember(snapshot, options)
    }
    return this.createPractice(options)
  }
  createPractice(options) {
    const userId = this.identity().userId
    const route = {}
    Object.keys(options).sort().filter(key => key !== 'sessionId' && key !== 'resume').forEach(key => { route[key] = options[key] })
    const routeKey = JSON.stringify(route)
    const key = `${userId}:${routeKey}`
    if (this.creating[key]) return this.creating[key]
    this.creating[key] = this.createPracticeIntent(userId, routeKey, route).then((result) => { delete this.creating[key]; return result }, (error) => { delete this.creating[key]; throw error })
    return this.creating[key]
  }
  async createPracticeIntent(userId, routeKey, options) {
    const storageKey = `qandaOnlineCreate:${userId}`
    let intents = this.storage.get(storageKey) || []
    let intent = intents.find(value => value.routeKey === routeKey)
    if (!intent) {
      const bankId = options.bankId
      if (!bankId) throw new Error('请选择一个题库开始练习')
      const bank = require('./remote-data-repository.js').getBankMeta(bankId) || await this.required('GET', `/question-banks/${bankId}`)
      if (this.identity().userId !== userId) throw new Error('账号已切换，请重新打开练习')
      const scope = { questionBankId: bankId, count: Math.min(Number(options.count) || bank.questionCount || 20, 1000), order: ['practice', 'test'].includes(options.mode) ? 'RANDOM' : 'SEQUENTIAL', selectionKind: options.selectionKind || 'NORMAL', chapterIds: options.chapterId ? [options.chapterId] : [] }
      scope.collectionChip = options.collectionChip || 'all'
      if (options.ids) { scope.questionIds = String(options.ids).split(',').filter(Boolean); scope.count = scope.questionIds.length }
      intent = { routeKey, route: options, key: http.uuid(), title: bank.name, body: { scope, expectedContentVersion: bank.contentVersion, feedback: options.mode === 'test' ? 'AFTER_FINISH' : 'IMMEDIATE', deviceId: this.deviceId() } }
      intents = this.storage.get(storageKey) || []
      this.storage.set(storageKey, intents.concat(intent))
    }
    const response = await this.call('POST', '/practice/sessions', intent.body, { idempotencyKey: intent.key })
    if (!response.ok) {
      if ([400, 404, 409, 422].includes(response.statusCode)) this.storage.set(storageKey, (this.storage.get(storageKey) || []).filter(value => value.key !== intent.key))
      throw new Error(response.reason || '创建练习失败，请联网后重试')
    }
    const snapshot = response.data
    snapshot.title = intent.title
    const created = this.remember(snapshot, intent.route)
    this.storage.set(storageKey, (this.storage.get(storageKey) || []).filter(value => value.key !== intent.key))
    return created
  }
  waitingKey() { return `qandaWaiting:${this.identity().userId}` }
  waitingIds() { return Object.keys(this.storage.get(this.waitingKey()) || {}) }
  getWaiting(id) { return (this.storage.get(this.waitingKey()) || {})[id] || null }
  rememberWaiting(id, route, writer) {
    const key = this.waitingKey()
    const waits = this.storage.get(key) || {}
    waits[id] = Object.assign({}, waits[id] || { startedAt: Date.now() }, { route, writer })
    this.storage.set(key, waits)
  }
  forgetWaiting(id) {
    const key = this.waitingKey()
    const waits = this.storage.get(key) || {}
    delete waits[id]
    this.storage.set(key, waits)
  }
  trackCompleted(id) {
    const key = `qandaOnlineCompleted:${this.identity().userId}`
    const previous = this.storage.get(key) || []
    this.storage.set(key, [id].concat(previous.filter((value) => value !== id)))
    this.pruneCompleted()
  }
  pruneCompleted() {
    const key = `qandaOnlineCompleted:${this.identity().userId}`
    const completed = this.storage.get(key) || []
    const retained = []
    for (const id of completed) {
      if (retained.length < 5) { retained.push(id); continue }
      const snapshot = this.get(id)
      if (snapshot && (snapshot.status !== 'SUBMITTED' || !snapshot.result || snapshot.releaseCommand || Object.keys(snapshot.assessmentCommands || {}).length || this.finishing[`${this.userId}:${id}`])) { retained.push(id); continue }
      if (!this.queue.removeConfirmed(id)) { retained.push(id); continue }
      this.storage.remove(this.key(id))
    }
    this.storage.set(key, retained)
  }
  remember(snapshot, options) {
    const previous = this.get(snapshot.id)
    snapshot.route = Object.assign({}, previous && previous.route || {}, snapshot.route || {}, options || {})
    snapshot.formatVersion = 1
    this.put(snapshot.id, snapshot)
    this.storage.set(`qandaOnlineLast:${this.userId}`, snapshot.id)
    if (snapshot.status === 'SUBMITTED' && snapshot.result) this.trackCompleted(snapshot.id)
    else this.pruneCompleted()
    return snapshot
  }
  quiz(snapshot) {
    return { subjectId: snapshot.route.subjectId || '', bankId: snapshot.questionBankId, title: snapshot.title || '题库练习', storageKey: '', questions: snapshot.items.map(item => mapQuestion(item, (snapshot.offlineGrading || []).find(g => g.itemId === item.itemId))) }
  }
  restored(snapshot) {
    if (snapshot.localState) return JSON.parse(JSON.stringify(snapshot.localState))
    const questions = this.quiz(snapshot).questions
    return { sessionId: snapshot.id, questionIds: questions.map(q => q.id), questionOrder: questions.map((_, i) => i), currentIndex: snapshot.currentIndex, elapsedTime: snapshot.durationSeconds,
      markedIds: snapshot.items.filter(i => i.marked).map(i => i.question.id),
      answers: snapshot.items.map((item, index) => item.answer ? { questionId: item.question.id, selectedKeys: item.answer.optionKeys || (item.answer.value === null || item.answer.value === undefined ? [] : [String(item.answer.value)]), text: item.answer.text || '', confirmed: item.confirmed, selfAssessment: item.selfAssessment, isCorrect: item.question.type === 'SHORT_ANSWER' ? item.selfAssessment === 'CORRECT' : item.outcome ? item.outcome === 'CORRECT' : JSON.stringify((item.answer.optionKeys || (item.answer.value === undefined || item.answer.value === null ? [] : [String(item.answer.value)])).slice().sort()) === JSON.stringify(questions[index].answerKeys.slice().sort()) } : null),
      status: snapshot.status === 'SUBMITTED' ? 'SUBMITTED' : 'IN_PROGRESS', config: snapshot.route }
  }
  save(session) {
    this.identity()
    const state = JSON.parse(JSON.stringify(session.getPersistedState()))
    if ((!state.answers[state.currentIndex] || state.answers[state.currentIndex].confirmed === false) && session.state.selectedKeys.length) {
      state.answers[state.currentIndex] = { questionId: session.state.questions[state.currentIndex].id, selectedKeys: session.state.selectedKeys.slice(), confirmed: false, isCorrect: false }
    }
    const snapshot = this.get(state.sessionId)
    if (!snapshot) throw new Error('练习快照不存在')
    if (snapshot.releaseCommand) throw new Error('练习正在同步交接，请稍后继续')
    snapshot.localState = state
    if (snapshot.status === 'SUBMITTED' && snapshot.result) { this.put(snapshot.id, snapshot); return { ok: true, unchanged: true } }
    const items = snapshot.items.map((item, i) => {
      const answer = session.state.answers[i]
      const question = session.state.questions[i]
      const editing = i === state.currentIndex && (!answer || answer.confirmed === false)
      const keys = editing ? session.state.selectedKeys : answer ? answer.selectedKeys : []
      return { itemId: item.itemId, answer: question.isShortAnswer ? (answer && answer.text && answer.text.trim() ? { text: answer.text } : null) : keys && keys.length ? (question.type === 'TRUE_FALSE' ? { value: keys[0] === 'true' } : { optionKeys: keys }) : null, confirmed: !!answer && answer.confirmed !== false, marked: state.markedIds.includes(item.question.id) }
    })
    this.put(snapshot.id, snapshot)
    const saved = this.queue.save(snapshot.id, { progress: { currentIndex: state.currentIndex, durationSeconds: state.elapsedTime, items }, state })
    if (!saved.ok) throw new Error(saved.reason || '本机存储失败，请释放空间后重试')
    return saved
  }
  async send(id, command, queueUserId) {
    const identity = auth.getAuth(this.storage)
    if (!identity.loggedIn || identity.userId !== queueUserId) return { ok: false, statusCode: 401, reason: '请登录原账号后同步答题数据' }
    const snapshotKey = `qandaOnline:${queueUserId}:${id}`
    const snapshot = this.storage.get(snapshotKey)
    if (!snapshot || !snapshot.writer) return { ok: false, statusCode: 409, reason: '练习写入权不可用' }
    const key = `${snapshotKey}:wire:${command.idempotencyKey}`
    let body = this.storage.get(key)
    if (!body) {
      const acknowledged = snapshot.ackItems || {}
      const changes = command.payload.progress.items.filter(item => JSON.stringify(acknowledged[item.itemId]) !== JSON.stringify(item))
      body = Object.assign({}, command.payload.progress, { items: changes, expectedVersion: snapshot.version, writerToken: snapshot.writer.writerToken, clientSequence: command.sequence })
      this.storage.set(key, body)
    }
    const response = await http.request('PUT', `/practice/sessions/${id}/progress-ack`, body, { token: identity.token, idempotencyKey: command.idempotencyKey, priority: 'background' })
    if (response.ok) {
      const latest = this.storage.get(snapshotKey)
      latest.version = response.data.version; latest.writer = response.data.writer
      latest.ackItems = latest.ackItems || {}
      body.items.forEach(item => { latest.ackItems[item.itemId] = item })
      this.storage.set(snapshotKey, latest)
      if (latest.writer.pendingDeviceId && auth.getAuth(this.storage).userId === queueUserId) this.pendingTakeover = id
    }
    return Object.assign({}, response, response.ok ? response.data : {})
  }
  async flush(id) { this.identity(); return this.queue.flush(id) }
  finish(session) {
    const key = `${this.identity().userId}:${session.meta.sessionId}`
    if (this.finishing[key]) return this.finishing[key]
    this.finishing[key] = this.finishSession(session).then((result) => { delete this.finishing[key]; return result }, (error) => { delete this.finishing[key]; throw error })
    return this.finishing[key]
  }
  async assess(id, itemId, value) {
    if (!['CORRECT', 'WRONG'].includes(value)) throw new Error('自评结果无效')
    const snapshot = this.get(id)
    snapshot.assessmentCommands = snapshot.assessmentCommands || {}
    snapshot.assessed = snapshot.assessed || {}
    if (snapshot.assessed[itemId] === value) return snapshot.result
    if (!snapshot.assessmentCommands[itemId]) {
      snapshot.assessmentCommands[itemId] = { key: http.uuid(), body: { expectedVersion: snapshot.version, assessment: value } }
      this.put(id, snapshot)
    }
    const command = snapshot.assessmentCommands[itemId]
    const rated = await this.required('PUT', `/practice/sessions/${id}/items/${itemId}/self-assessment`, command.body, { idempotencyKey: command.key })
    snapshot.version = rated.version
    snapshot.result = rated
    snapshot.assessed[itemId] = command.body.assessment
    delete snapshot.assessmentCommands[itemId]
    this.put(id, snapshot)
    return rated
  }
  async finishSession(session) {
    const id = session.meta.sessionId
    let snapshot = this.get(id)
    if (!snapshot) throw new Error('练习快照不存在')
    if (!snapshot.finishCommand && !snapshot.result) {
      this.save(session)
      let pending = this.queue.get(id)
      while (pending && pending.sequence > pending.acknowledgedSequence) {
        const response = await this.flush(id)
        if (!response.ok) throw new Error(response.reason || '答题数据待同步，请联网后重试交卷')
        pending = this.queue.get(id)
      }
      snapshot = this.get(id)
      snapshot.finishCommand = { key: http.uuid(), body: { expectedVersion: snapshot.version, durationSeconds: session.getElapsedSeconds(), items: [], writerToken: snapshot.writer.writerToken } }
      this.put(id, snapshot)
    }
    if (!snapshot.result) {
      const result = await this.required('POST', `/practice/sessions/${id}/finish`, snapshot.finishCommand.body, { idempotencyKey: snapshot.finishCommand.key })
      snapshot.result = result; snapshot.status = 'SUBMITTED'; snapshot.version = result.version
      this.put(id, snapshot)
    }
    snapshot.assessed = snapshot.assessed || {}
    for (let index = 0; index < session.state.answers.length; index += 1) {
      const answer = session.state.answers[index]
      const itemId = snapshot.items[index].itemId
      if (!answer || !answer.selfAssessment || snapshot.assessed[itemId] === answer.selfAssessment) continue
      await this.assess(id, itemId, answer.selfAssessment)
      snapshot = this.get(id)
    }
    this.trackCompleted(id)
    return snapshot.result
  }
  async poll(id) {
    const cached = this.get(id)
    if (cached && cached.releaseCommand && !await this.release(id)) return null
    const response = await this.call('GET', `/practice/sessions/${id}/writer-state?deviceId=${this.deviceId()}`)
    if (!response.ok) return null
    const writer = response.data
    const snapshot = this.get(id)
    if (snapshot) { snapshot.writer = writer; this.put(id, snapshot) }
    const waiting = this.getWaiting(id)
    if (waiting) this.rememberWaiting(id, waiting.route, writer)
    return writer
  }
  release(id) {
    const userId = this.identity().userId
    const key = `${userId}:${id}`
    if (this.releasing[key]) return this.releasing[key]
    this.releasing[key] = this.releaseWriter(id, userId).then((result) => { delete this.releasing[key]; return result }, (error) => { delete this.releasing[key]; throw error })
    return this.releasing[key]
  }
  async releaseWriter(id, userId) {
    let snapshot = this.get(id)
    if (!snapshot) return false
    if (!snapshot.releaseCommand) {
      const flushed = await this.flush(id)
      if (!flushed.ok) return false
      const queued = this.queue.get(id)
      if (queued && queued.sequence > queued.acknowledgedSequence) return false
      if (this.identity().userId !== userId) return false
      snapshot = this.get(id)
      if (!snapshot.writer || !snapshot.writer.writerToken || snapshot.status === 'SUBMITTED') return false
      snapshot.releaseCommand = { key: http.uuid(), body: { deviceId: this.deviceId(), writerToken: snapshot.writer.writerToken, expectedVersion: snapshot.version, clientSequence: snapshot.writer.acknowledgedSequence || 0 } }
      this.put(id, snapshot)
    }
    const command = snapshot.releaseCommand
    const response = await this.call('POST', `/practice/sessions/${id}/writer-release`, command.body, { idempotencyKey: command.key })
    if (response.ok) {
      const latest = this.get(id)
      latest.writer = response.data
      delete latest.releaseCommand
      this.put(id, latest)
    }
    return response.ok
  }

}
module.exports = { enable, current, OnlinePractice, mapQuestion }
