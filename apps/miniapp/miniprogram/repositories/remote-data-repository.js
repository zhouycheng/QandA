const api = require('./api-transport.js')
const authRepository = require('./auth-repository.js')
const { observable, runInAction } = require('mobx-miniprogram')
const { createResourceCache, queryKey } = require('./resource-cache.js')
const cache = createResourceCache()
const TTL = { catalog: 300000, profile: 300000, learning: 30000, announcements: 60000, colleges: 86400000 }
let enabled = false
let owner = ''
let activeStorage = null
function empty() { return { subjects: [], subjectTotal: 0, banks: [], chapters: {}, questions: {}, favorites: [], wrong: [], mastered: [], recent: [], history: [], days: [], statistics: null, periodStatistics: {}, overview: null, profile: null, colleges: [], majors: [], announcements: [], announcementTotal: 0 } }
const state = observable.object(empty(), { questions: false }, { deep: false })
function reset() { cache.clear(); runInAction(() => Object.assign(state, empty())) }
function enable(value) { enabled = value !== false; owner = ''; activeStorage = null; reset() }
function isEnabled() { return enabled }
function bind(storage) {
  activeStorage = storage || activeStorage
  const auth = authRepository.getAuth(activeStorage)
  const id = auth && auth.token && auth.userId || ''
  if (id !== owner) {
    owner = id; reset(); api.cancelReads()
    const saved = id && activeStorage && activeStorage.get && activeStorage.get('qandaReadCache:' + id)
    if (saved && saved.version === 1) runInAction(() => {
      state.overview = saved.overview || null; state.profile = saved.profile || null
    })
  }
  return id
}
function persistSummary() {
  if (!owner || !activeStorage || !activeStorage.set) return
  try { activeStorage.set('qandaReadCache:' + owner, { version: 1, overview: state.overview, profile: state.profile }) } catch (_) { /* Read caches can be rebuilt from the server. */ }
}
function checked(response) { if (!response.ok) throw new Error(response.reason || '请求失败'); return response.data }
function get(path, query) { return api.request('GET', path, query).then(checked) }
function mutate(method, path, data) { return api.request(method, path, data, { idempotencyKey: api.uuid() }).then(checked) }
function resource(storage, name, query, ttl, path, publish, force) {
  if (!enabled) return Promise.resolve(null)
  const user = bind(storage)
  const publicRead = /^\/(subjects|question-banks|questions|colleges)(\/|$)/.test(path)
  if (!user && !publicRead) return Promise.resolve(null)
  return cache.load(queryKey(name, query), ttl, () => get(path, query).then(data => { bind(storage); return data }), publish, force)
}
function mergeById(previous, items) {
  const byId = new Map(previous.map(item => [item.id, item]))
  items.forEach(item => byId.set(item.id, item))
  return Array.from(byId.values())
}
function refreshOverview(storage, options) {
  return resource(storage, 'overview', {}, TTL.learning, '/me/learning-overview', data => { state.overview = data; persistSummary() }, options && options.force)
}
function refreshSubjects(storage, options) {
  bind(storage)
  const query = { page: options && options.page || 1, pageSize: 20, includeProgress: owner ? true : undefined }
  return resource(storage, 'subjects', query, TTL.catalog, '/subjects', data => {
    state.subjects = mergeById(state.subjects, data.items); state.subjectTotal = data.total
  }, options && options.force)
}
function bankQuery(options) { return { subjectId: options && options.subjectId || undefined, keyword: options && options.keyword || undefined, page: options && options.page || 1, pageSize: 20, includeProgress: owner ? true : undefined } }
function refreshBanks(storage, options) {
  bind(storage)
  const query = bankQuery(options)
  return resource(storage, 'banks', query, TTL.catalog, '/question-banks', data => { state.banks = mergeById(state.banks, data.items) }, options && options.force)
}
async function refreshCatalog(storage, options) {
  const settings = options || {}
  await Promise.all([
    refreshSubjects(storage, { force: settings.force }),
    settings.subjectId ? loadSubject(storage, settings.subjectId, settings) : Promise.resolve()
  ])
  const subjectId = settings.subjectId || (state.subjects[0] || {}).id
  if (subjectId || settings.keyword) return refreshBanks(storage, Object.assign({}, settings, { subjectId: settings.keyword ? undefined : subjectId }))
  return null
}
function loadSubject(storage, id, options) {
  bind(storage)
  const listed = getSubjectPage(1)
  if (!(options && options.force) && Date.now() - listed.at < TTL.catalog && listed.data && listed.data.items.some(subject => subject.id === id)) return Promise.resolve()
  return resource(storage, 'subject:' + id, { includeProgress: owner ? true : undefined }, TTL.catalog, '/subjects/' + encodeURIComponent(id), data => {
    state.subjects = mergeById(state.subjects, [data])
  }, options && options.force)
}
function loadBank(storage, id, options) {
  return resource(storage, 'bank:' + id, {}, TTL.catalog, '/question-banks/' + encodeURIComponent(id), data => {
    const previous = getBankMeta(id)
    state.banks = mergeById(state.banks, [Object.assign({}, data, { progress: data.progress || previous && previous.progress })])
    if (!state.subjects.some(s => s.id === data.subjectId)) state.subjects = state.subjects.concat({ id: data.subjectId, name: data.subjectName || '' })
  }, options && options.force)
}
function previewPracticeScope(storage, scope) {
  const user = bind(storage)
  if (!user) return Promise.reject(new Error('请先登录'))
  return api.request('POST', '/practice/scope-preview', scope).then(checked).then(data => {
    if (bind(storage) !== user) throw new Error('账号已切换，请重新发起练习')
    return data
  })
}
function loadChapters(storage, id) {
  return resource(storage, 'chapters:' + id, {}, TTL.catalog, '/question-banks/' + encodeURIComponent(id) + '/chapters', data => { state.chapters = Object.assign({}, state.chapters, { [id]: data }) })
}
function refreshProfile(storage, options) {
  return resource(storage, 'profile', {}, TTL.profile, '/me', profile => {
    state.profile = profile
    authRepository.saveAuth(storage, Object.assign({}, authRepository.getAuth(storage), { nickname: profile.nickname, email: profile.email || '', profile, version: profile.version, college: profile.collegeName || '' }))
    persistSummary()
  }, options && options.force)
}
function refreshAnnouncements(storage, options) {
  const query = { page: options && options.page || 1, pageSize: options && options.pageSize || 20 }
  return resource(storage, 'announcements', query, TTL.announcements, '/announcements', data => {
    state.announcementTotal = data.total
    state.announcements = query.page === 1 && query.pageSize > 1 ? data.items : mergeById(state.announcements, data.items).slice(0, data.total)
  }, options && options.force)
}
function refreshRecent(storage, options) {
  const query = { page: options && options.page || 1, pageSize: 20 }
  return resource(storage, 'recent', query, TTL.learning, '/me/recent-learning', data => { state.recent = query.page === 1 ? data.items : mergeById(state.recent, data.items) }, options && options.force)
}
function refreshStatistics(storage, options) {
  const period = options && options.period || 'WEEK'
  const end = new Date(); end.setDate(end.getDate() + 1)
  const start = new Date(end); start.setDate(start.getDate() - 182)
  const date = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return Promise.all([
    refreshOverview(storage, options),
    resource(storage, 'statistics', { period }, TTL.learning, '/me/statistics', data => { state.periodStatistics = Object.assign({}, state.periodStatistics, { [period]: data }); if (period === 'ALL') state.statistics = data }, options && options.force),
    resource(storage, 'days', { startDate: date(start), endDateExclusive: date(end) }, TTL.learning, '/me/statistics/days', data => { state.days = data }, options && options.force)
  ])
}
function collectionQuery(options) {
  const input = options || {}
  return { subjectId: input.subjectId || undefined, questionBankId: input.questionBankId || undefined, chip: input.chip || 'all', sort: input.sort || (input.kind === 'FAVORITE' ? 'recent' : 'urgent'), page: input.page || 1, pageSize: 5 }
}
function refreshCollection(storage, options) {
  const kind = options.kind === 'FAVORITE' ? 'FAVORITE' : 'WRONG'
  const query = collectionQuery(options)
  return Promise.all([
    resource(storage, 'collectionSummary', { kind }, TTL.learning, '/me/question-collections/summary', null, options.force),
    resource(storage, 'collection:' + kind, query, TTL.learning, kind === 'FAVORITE' ? '/me/favorites' : '/me/wrong-questions', data => {
      state[kind === 'FAVORITE' ? 'favorites' : 'wrong'] = data.items
      cacheQuestions(data.items.map(q => Object.assign({ id: q.questionId, view: 'summary' }, q)))
    }, options.force)
  ])
}
function getCollection(storage, options) { bind(storage); return cache.read(queryKey('collection:' + options.kind, collectionQuery(options))) }
function getCollectionSummary(storage, kind) { bind(storage); return cache.read(queryKey('collectionSummary', { kind })).data }
function getOverview(storage) { bind(storage); return state.overview }
function getCatalogPage(options) { return cache.read(queryKey('banks', bankQuery(options))) }
function getSubjectPage(page) { return cache.read(queryKey('subjects', { page: page || 1, pageSize: 20, includeProgress: owner ? true : undefined })) }
function getResourceState(name, query) { return cache.read(queryKey(name, query || {})) }
function getAnnouncements(storage) { bind(storage); return enabled ? state.announcements : [] }
function getAnnouncementTotal(storage) { bind(storage); return state.announcementTotal }
function getBankMeta(id) { return state.banks.find(b => b.id === id) || null }
function invalidateLearning() { ['overview:', 'statistics:', 'days:', 'recent:', 'subjects:', 'banks:', 'collection'].forEach(cache.invalidate) }
function refresh(storage, kind, options) {
  if (!enabled) return Promise.resolve()
  const user = bind(storage)
  const settings = options || {}
  if (kind === 'catalog') return refreshCatalog(storage, settings)
  if (!user) return Promise.resolve()
  if (kind === 'home') return Promise.all([refreshOverview(storage, settings), refreshAnnouncements(storage, Object.assign({}, settings, { pageSize: 1 }))])
  if (kind === 'profile') return refreshProfile(storage, settings)
  if (kind === 'stats') return refreshStatistics(storage, settings)
  if (kind === 'collection') return refreshCollection(storage, settings)
  if (kind === 'recent') return refreshRecent(storage, settings)
  if (kind === 'announcements') return refreshAnnouncements(storage, settings)
  return Promise.resolve()
}
function mapQuestion(q) {
  const type = ({ SINGLE_CHOICE: 'single', MULTIPLE_CHOICE: 'multiple', TRUE_FALSE: 'judge', SHORT_ANSWER: 'short' })[q.type] || q.type || 'single'
  const options = type === 'judge' ? [{ key: 'true', label: '正确', text: '正确' }, { key: 'false', label: '错误', text: '错误' }] : (q.options || []).map((o) => ({ key: o.key, label: o.key, text: o.content === undefined ? o.text : o.content }))
  return { id: q.id, bankId: q.questionBankId, chapterId: q.chapterId, revisionId: q.revisionId, type, isMultiple: type === 'multiple', isJudge: type === 'judge', typeText: ({ single: '单选题', multiple: '多选题', judge: '判断题', short: '简答题' })[type], stem: q.stem || '', options, answerKeys: q.correctAnswer || (typeof q.correctValue === 'boolean' ? [String(q.correctValue)] : []), referenceAnswer: q.referenceAnswer || '', explanation: q.explanation || '', available: q.available !== false, complete: q.view !== 'summary', subjectId: q.subjectId || '', subjectName: q.subjectName || '', bankName: q.questionBankName || '' }
}
function cacheQuestions(questions) { questions.forEach((q) => { const mapped = mapQuestion(q); if (mapped.complete || !state.questions[mapped.id]) state.questions[mapped.id] = mapped }) }
function loadQuestion(storage, id) { return resource(storage, 'question:' + id, {}, TTL.catalog, `/questions/${encodeURIComponent(id)}`, q => cacheQuestions([q])) }
function getSubjectSummaries() {
  bind(activeStorage)
  return state.subjects.map((s, i) => {
    const banks = state.banks.filter(b => b.subjectId === s.id)
    const count = s.questionCount == null ? banks.reduce((sum, b) => sum + questionCount(b), 0) : s.questionCount
    const bankCount = s.bankCount == null ? banks.length : s.bankCount
    return { id: s.id, name: s.name, description: s.description, progress: s.progress || null,
      theme: ['chinese','mental','english'][i % 3], shortName: s.name.slice(0,1), order: i, banks: banks.map(bankMeta),
      bankCount, questionCount: count, bankText: `${bankCount} 个题库`, questionText: `${count} 道题目`, detailUrl: `/page/bank-detail/index?subjectId=${s.id}` }
  })
}
function questionCount(bank) { return Number(bank.activeQuestionCount === undefined ? bank.questionCount : bank.activeQuestionCount) || 0 }
function bankMeta(b) { const s = state.subjects.find((s) => s.id === b.subjectId) || {}; return { id: b.id, subjectId: b.subjectId, subjectName: b.subjectName || s.name || '', progress: b.progress || null, name: b.name, questionCount: questionCount(b), questionText: `${questionCount(b)} 题`, practiceUrl: `/page/practice/index?subjectId=${b.subjectId}&bankId=${b.id}` } }
function getSubjectDetail(id) { const subject = getSubjectSummaries().find((s) => s.id === id); return subject ? Object.assign({}, subject, { bankBadgeText: subject.bankText, questionBadgeText: subject.questionText }) : null }
function getCatalogStats() { const s = getSubjectSummaries(); const overview = state.overview; return { version: '1.0.0', subjectCount: overview ? overview.subjectCount : s.length, bankCount: overview ? overview.bankCount : state.banks.length, questionCount: overview ? overview.totalCount : s.reduce((n, s) => n+s.questionCount, 0) } }
function getBankQuiz(subjectId, bankId) { const s = getSubjectDetail(subjectId); const bank = s && s.banks.find((b) => b.id === bankId); return bank ? { subjectId, subjectName: s.name, bankId, bankName: bank.name, title: `${s.name} · ${bank.name}`, questions: Object.values(state.questions).filter((q) => q.bankId === bankId), questionCount: bank.questionCount, storageKey: '', sharePath: bank.practiceUrl } : null }
function getSubjectQuiz(id) { const s = getSubjectDetail(id); return s ? { subjectId: id, subjectName: s.name, bankId: '', bankName: '全部题库', title: s.name, questions: Object.values(state.questions).filter((q) => s.banks.some((b) => b.id === q.bankId)), questionCount: s.questionCount, storageKey: '' } : null }
function getQuestionIndex() { bind(activeStorage); const index = {}; Object.values(state.questions).forEach((q) => { const b = state.banks.find((b) => b.id === q.bankId); const s = b && state.subjects.find((s) => s.id === b.subjectId); index[q.id] = { id: q.id, question: q, bankId: q.bankId, bankName: q.bankName || b && b.name || '', subjectId: q.subjectId || s && s.id || '', subjectName: q.subjectName || s && s.name || '' } }); return index }
function findQuestionEntries(ids) { const index = getQuestionIndex(); return ids.map((id) => index[id]).filter(Boolean) }
function getFavorites(storage) { bind(storage); return { ids: state.favorites.map((q) => q.questionId) } }
function getWrongBook(storage) { bind(storage); const result = {}; state.wrong.concat(state.mastered).forEach((q) => { result[q.questionId] = { wrongCount: q.wrongCount, rightCount: q.rightCount, mastered: state.mastered.indexOf(q) >= 0, updatedAt: Date.parse(q.lastPracticedAt) || 0 } }); return result }
function getDailyLog(storage) { bind(storage); const result = {}; state.days.forEach((d) => { result[d.date] = { answered: d.answeredCount, correct: d.correctCount, seconds: d.durationSeconds, sessions: d.practiceCount } }); return result }
function getStudyTime(storage) { bind(storage); return { totalSeconds: state.overview && state.overview.durationSeconds || 0, sessionCount: state.overview && state.overview.practiceCount || 0 } }
function getStatistics(storage, period) { bind(storage); return period ? state.periodStatistics[period] : state.statistics }
function getProgress(storage) {
  bind(storage)
  const result = {}
  state.banks.forEach(bank => { if (bank.progress) result[bank.id] = Object.assign({ total: questionCount(bank), answers: {}, updatedAt: 0 }, bank.progress) })
  return result
}
function getRecent(storage) { bind(storage); return state.recent.length ? state.recent : state.overview && state.overview.recentSession ? [state.overview.recentSession] : [] }
function getHistory(storage) { bind(storage); return state.history }
function getScopeMeta(id) { const b = state.banks.find((b) => b.id === id); const s = getSubjectDetail(b ? b.subjectId : id); if (!s) return null; return { scopeKey: id, subjectId: s.id, bankId: b ? b.id : '', title: b ? b.name : s.name, description: s.name, url: `/page/practice/index?subjectId=${s.id}&bankId=${b ? b.id : (s.banks[0] || {}).id || ''}` } }
function setQuestionFavorite(storage, id, value) {
  const user = bind(storage)
  return mutate(value ? 'PUT' : 'DELETE', `/me/favorites/${encodeURIComponent(id)}`).then(() => {
    if (bind(storage) !== user) return { value, favorites: { ids: [] } }
    runInAction(() => {
      state.favorites = state.favorites.filter(q => q.questionId !== id).concat(value ? [{ questionId: id }] : [])
      invalidateLearning()
    })
    return { value, favorites: getFavorites(storage) }
  })
}
function addQuestionFavorite(storage, id) { return setQuestionFavorite(storage, id, true) }
function removeQuestionFavorite(storage, id) { return setQuestionFavorite(storage, id, false) }
function toggleQuestionFavorite(storage, id) { bind(storage); return setQuestionFavorite(storage, id, !state.favorites.some(q => q.questionId === id)) }
function removeQuestionFavorites(storage, ids) { return ids.reduce((p, id) => p.then(() => removeQuestionFavorite(storage, id)), Promise.resolve()) }
async function clearFavorites(storage) {
  const user = bind(storage)
  while (bind(storage) === user) {
    const page = await get('/me/favorites', { page: 1, pageSize: 100 })
    if (bind(storage) !== user) throw new Error('账号已切换，已停止清理收藏')
    if (!page.items.length) return
    for (const item of page.items) {
      if (bind(storage) !== user) throw new Error('账号已切换，已停止清理收藏')
      await removeQuestionFavorite(storage, item.questionId)
    }
  }
}
function removeWrongQuestions() { return Promise.reject(new Error('错题记录随练习结果更新，请通过复习掌握题目')) }
function searchQuestions(storage, keyword, page) {
  const user = bind(storage)
  return api.request('GET', '/questions', { keyword, page: page || 1, pageSize: 20, view: 'summary' }).then(checked).then((result) => {
    bind(storage)
    if (owner !== user) throw new Error('账号已切换，请重新搜索')
    cacheQuestions((result.items || []).map(q => Object.assign({}, q, { view: 'summary' })))
    const index = getQuestionIndex()
    return { total: result.total, page: result.page, items: (result.items || []).map((question) => {
      const entry = index[question.id]
      return { questionId: question.id, stem: question.stem, typeText: entry.question.typeText, sourceText: [entry.subjectName, entry.bankName].filter(Boolean).join(' · ') }
    }) }
  })
}
function getProfile(storage) { bind(storage); return state.profile }
function getColleges() { return state.colleges }
function loadColleges(storage, page) {
  return resource(storage, 'colleges', { page: page || 1, pageSize: 100 }, TTL.colleges, '/colleges', data => { state.colleges = page > 1 ? mergeById(state.colleges, data.items) : data.items })
}
function loadMajors(id, page) {
  return resource(activeStorage, 'majors:' + id, { page: page || 1, pageSize: 100 }, TTL.colleges, `/colleges/${id}/majors`, data => { state.majors = data.items }).then(data => data ? data.items : [])
}
function saveProfile(storage, patch) {
  const profile = getProfile(storage)
  if (!profile) return Promise.reject(new Error('请先刷新账号资料'))
  const user = owner
  return mutate('PUT', '/me/profile', Object.assign({ expectedVersion: profile.version, nickname: profile.nickname, collegeId: profile.collegeId, majorId: profile.majorId, enrollmentYear: profile.enrollmentYear }, patch)).then(() => {
    if (bind(storage) === user) { cache.invalidate('profile:'); return refreshProfile(storage) }
  })
}
module.exports = { searchQuestions, addQuestionFavorite, removeQuestionFavorite, getBankMeta, invalidateLearning, enable, isEnabled, bind, refresh, refreshCatalog, refreshProfile, mapQuestion, cacheQuestions, loadQuestion, getSubjectSummaries, getSubjectDetail, getCatalogStats, getBankQuiz, getSubjectQuiz, getQuestionIndex, findQuestionEntries, getFavorites, getWrongBook, getDailyLog, getStudyTime, getStatistics, getProgress, getRecent, getHistory, getScopeMeta, toggleQuestionFavorite, removeQuestionFavorites, clearFavorites, removeWrongQuestions, getProfile, getColleges, loadMajors, saveProfile }
module.exports.getAnnouncements = getAnnouncements

Object.assign(module.exports, { refreshOverview, refreshSubjects, refreshBanks, refreshAnnouncements, refreshRecent, refreshCollection, refreshStatistics, getOverview, getCollection, getCollectionSummary, getCatalogPage, getSubjectPage, getResourceState, getAnnouncementTotal, loadColleges, loadBank, loadChapters, previewPracticeScope })
