const api = require('./api-transport.js')
const authRepository = require('./auth-repository.js')

let enabled = false
let owner = ''
let activeStorage = null
let state = empty()
let catalogRequest = null
let learningRequest = null
let profileRequest = null
let announcementsRequest = null
let announcementsAt = 0
let profileAt = 0
let catalogAt = 0
let learningAt = 0
function empty() { return { subjects: [], progressRows: [], banks: [], chapters: {}, questions: {}, favorites: [], wrong: [], mastered: [], recent: [], history: [], days: [], statistics: null, periodStatistics: {}, profile: null, colleges: [], majors: [], announcements: [] } }
function enable(value) { enabled = value !== false; owner = ''; activeStorage = null; state = empty(); catalogAt = 0; learningAt = 0; profileAt = 0; announcementsAt = 0; catalogRequest = null; learningRequest = null; profileRequest = null; announcementsRequest = null }
function isEnabled() { return enabled }
function bind(storage) {
  activeStorage = storage || activeStorage
  storage = activeStorage
  const auth = authRepository.getAuth(storage)
  const id = auth && auth.token && auth.userId || ''
  if (id !== owner) { owner = id; state = empty(); catalogRequest = null; learningRequest = null; catalogAt = 0; learningAt = 0; profileAt = 0; profileRequest = null; announcementsAt = 0; announcementsRequest = null }
  return id
}
function checked(response) { if (!response.ok) throw new Error(response.reason || '请求失败'); return response.data }
function get(path) { return api.request('GET', path).then(checked) }
function all(path, query) { return api.getAll(path, query).then(checked) }
function mutate(method, path, data) { return api.request(method, path, data, { idempotencyKey: api.uuid() }).then(checked) }
function refreshCatalog(storage) {
  if (!enabled || !bind(storage)) return Promise.resolve()
  if (catalogRequest) return catalogRequest
  if (Date.now() - catalogAt < 10000) return Promise.resolve()
  const user = owner
  catalogRequest = Promise.all([all('/subjects'), all('/question-banks')]).then(([subjects, banks]) => {
    bind(storage)
    if (owner !== user) return
    state.subjects = subjects; state.banks = banks; catalogAt = Date.now()
  }).finally(() => { if (owner === user) catalogRequest = null })
  return catalogRequest
}
function refreshLearning(storage) {
  if (!enabled || !bind(storage)) return Promise.resolve()
  if (learningRequest) return learningRequest
  if (Date.now() - learningAt < 10000) return Promise.resolve()
  const user = owner
  const end = new Date(); end.setDate(end.getDate() + 1)
  const start = new Date(); start.setDate(start.getDate() - 189)
  const date = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  learningRequest = Promise.all([all('/me/favorites'), all('/me/wrong-questions'), all('/me/wrong-questions', { status: 'MASTERED' }), get('/me/recent-learning?page=1&pageSize=20').then(page => page.items), all('/me/question-progress'), get('/me/statistics?period=ALL'), get('/me/statistics?period=WEEK'), get('/me/statistics?period=MONTH'), get(`/me/statistics/days?startDate=${date(start)}&endDateExclusive=${date(end)}`)])
    .then(([favorites, wrong, mastered, recent, progressRows, statistics, week, month, days]) => {
      bind(storage)
    if (owner !== user) return
      Object.assign(state, { favorites, wrong, mastered, recent, progressRows, statistics, days }); state.periodStatistics = { WEEK: week, MONTH: month, ALL: statistics }; learningAt = Date.now()
      favorites.concat(wrong, mastered).forEach((q) => { if (!state.questions[q.questionId]) state.questions[q.questionId] = mapQuestion({ id: q.questionId, questionBankId: q.questionBankId, stem: q.stem, type: q.type, available: q.available }) })
    }).finally(() => { if (owner === user) learningRequest = null })
  return learningRequest
}
function refreshProfile(storage) {
  if (!enabled || !bind(storage)) return Promise.resolve()
  if (profileRequest) return profileRequest
  if (Date.now() - profileAt < 10000) return Promise.resolve()
  const user = owner
  profileRequest = Promise.all([get('/me'), all('/colleges')]).then(([profile, colleges]) => {
    bind(storage)
    if (owner !== user) return
    state.profile = profile; state.colleges = colleges; profileAt = Date.now()
    authRepository.saveAuth(storage, Object.assign({}, authRepository.getAuth(storage), { nickname: profile.nickname, email: profile.email || '', profile, version: profile.version, college: (colleges.find((c) => c.id === profile.collegeId) || {}).name || '' }))
  }).finally(() => { if (owner === user) profileRequest = null })
  return profileRequest
}
function invalidateLearning() { learningAt = 0 }
function refreshAnnouncements(storage) {
  if (!enabled || !bind(storage)) return Promise.resolve()
  if (announcementsRequest) return announcementsRequest
  if (Date.now() - announcementsAt < 10000) return Promise.resolve()
  const user = owner
  announcementsRequest = all('/announcements').then((items) => {
    bind(storage)
    if (owner !== user) return
    state.announcements = items; announcementsAt = Date.now()
  }).finally(() => { if (owner === user) announcementsRequest = null })
  return announcementsRequest
}
function getAnnouncements(storage) { bind(storage); return enabled ? state.announcements : [] }
function getBankMeta(id) { bind(activeStorage); return state.banks.find((b) => b.id === id) || null }
function refresh(storage, kind) {
  if (!enabled) return Promise.resolve()
  bind(storage)
  const requests = kind === 'profile' ? [refreshProfile(storage)] : kind === 'catalog' ? [refreshCatalog(storage)] : [refreshCatalog(storage), refreshLearning(storage)]
  if (kind === 'home') requests.push(refreshAnnouncements(storage))
  return Promise.all(requests)
}
function mapQuestion(q) {
  const type = ({ SINGLE_CHOICE: 'single', MULTIPLE_CHOICE: 'multiple', TRUE_FALSE: 'judge', SHORT_ANSWER: 'short' })[q.type] || q.type || 'single'
  const options = type === 'judge' ? [{ key: 'true', label: '正确', text: '正确' }, { key: 'false', label: '错误', text: '错误' }] : (q.options || []).map((o) => ({ key: o.key, label: o.key, text: o.content === undefined ? o.text : o.content }))
  return { id: q.id, bankId: q.questionBankId, chapterId: q.chapterId, revisionId: q.revisionId, type, isMultiple: type === 'multiple', isJudge: type === 'judge', typeText: ({ single: '单选题', multiple: '多选题', judge: '判断题', short: '简答题' })[type], stem: q.stem || '', options, answerKeys: q.correctAnswer || (typeof q.correctValue === 'boolean' ? [String(q.correctValue)] : []), referenceAnswer: q.referenceAnswer || '', explanation: q.explanation || '', available: q.available !== false }
}
function cacheQuestions(questions) { questions.forEach((q) => { const mapped = mapQuestion(q); state.questions[mapped.id] = mapped }) }
function loadQuestion(storage, id) { bind(storage); const user = owner; return get(`/questions/${encodeURIComponent(id)}`).then((q) => { bind(storage); if (owner === user) cacheQuestions([q]); return q }) }
function getSubjectSummaries() {
  bind(activeStorage)
  return state.subjects.map((s, i) => { const banks = state.banks.filter((b) => b.subjectId === s.id); const count = banks.reduce((sum, b) => sum + questionCount(b), 0); return { id: s.id, name: s.name, description: s.description, theme: ['chinese','mental','english'][i % 3], shortName: s.name.slice(0,1), order: i, banks: banks.map(bankMeta), bankCount: banks.length, questionCount: count, bankText: `${banks.length} 个题库`, questionText: `${count} 道题目`, detailUrl: `/page/bank-detail/index?subjectId=${s.id}` } })
}
function questionCount(bank) { return Number(bank.activeQuestionCount === undefined ? bank.questionCount : bank.activeQuestionCount) || 0 }
function bankMeta(b) { const s = state.subjects.find((s) => s.id === b.subjectId) || {}; return { id: b.id, subjectId: b.subjectId, subjectName: s.name || '', name: b.name, questionCount: questionCount(b), questionText: `${questionCount(b)} 题`, practiceUrl: `/page/practice/index?subjectId=${b.subjectId}&bankId=${b.id}` } }
function getSubjectDetail(id) { const subject = getSubjectSummaries().find((s) => s.id === id); return subject ? Object.assign({}, subject, { bankBadgeText: subject.bankText, questionBadgeText: subject.questionText }) : null }
function getCatalogStats() { const s = getSubjectSummaries(); return { version: '1.0.0', subjectCount: s.length, bankCount: state.banks.length, questionCount: s.reduce((n, s) => n+s.questionCount, 0) } }
function getBankQuiz(subjectId, bankId) { const s = getSubjectDetail(subjectId); const bank = s && s.banks.find((b) => b.id === bankId); return bank ? { subjectId, subjectName: s.name, bankId, bankName: bank.name, title: `${s.name} · ${bank.name}`, questions: Object.values(state.questions).filter((q) => q.bankId === bankId), questionCount: bank.questionCount, storageKey: '', sharePath: bank.practiceUrl } : null }
function getSubjectQuiz(id) { const s = getSubjectDetail(id); return s ? { subjectId: id, subjectName: s.name, bankId: '', bankName: '全部题库', title: s.name, questions: Object.values(state.questions).filter((q) => s.banks.some((b) => b.id === q.bankId)), questionCount: s.questionCount, storageKey: '' } : null }
function getQuestionIndex() { bind(activeStorage); const index = {}; Object.values(state.questions).forEach((q) => { const b = state.banks.find((b) => b.id === q.bankId); const s = b && state.subjects.find((s) => s.id === b.subjectId); index[q.id] = { id: q.id, question: q, bankId: q.bankId, bankName: b && b.name || '', subjectId: s && s.id || '', subjectName: s && s.name || '' } }); return index }
function findQuestionEntries(ids) { const index = getQuestionIndex(); return ids.map((id) => index[id]).filter(Boolean) }
function getFavorites(storage) { bind(storage); return { ids: state.favorites.map((q) => q.questionId) } }
function getWrongBook(storage) { bind(storage); const result = {}; state.wrong.concat(state.mastered).forEach((q) => { result[q.questionId] = { wrongCount: q.wrongCount, rightCount: q.rightCount, mastered: state.mastered.indexOf(q) >= 0, updatedAt: Date.parse(q.lastPracticedAt) || 0 } }); return result }
function getDailyLog(storage) { bind(storage); const result = {}; state.days.forEach((d) => { result[d.date] = { answered: d.answeredCount, correct: d.correctCount, seconds: d.durationSeconds, sessions: d.practiceCount } }); return result }
function getStudyTime(storage) { bind(storage); return { totalSeconds: state.statistics && state.statistics.durationSeconds || 0, sessionCount: state.statistics && state.statistics.practiceCount || 0 } }
function getStatistics(storage, period) { bind(storage); return period ? state.periodStatistics[period] : state.statistics }
function getProgress(storage) {
  bind(storage)
  const progress = {}
  state.progressRows.forEach((row) => {
    const bankId = row.questionBankId
    const bank = state.banks.find((bank) => bank.id === bankId)
    const entry = progress[bankId] || { total: bank ? questionCount(bank) : 0, answers: {}, updatedAt: 0 }
    entry.answers[row.questionId] = row.outcome === 'CORRECT' ? 1 : 0
    entry.updatedAt = Math.max(entry.updatedAt, Date.parse(row.lastPracticedAt) || 0)
    progress[bankId] = entry
  })
  return progress
}
function getRecent(storage) { bind(storage); return state.recent }
function getHistory(storage) { bind(storage); return state.history }
function getScopeMeta(id) { const b = state.banks.find((b) => b.id === id); const s = getSubjectDetail(b ? b.subjectId : id); if (!s) return null; return { scopeKey: id, subjectId: s.id, bankId: b ? b.id : '', title: b ? b.name : s.name, description: s.name, url: `/page/practice/index?subjectId=${s.id}&bankId=${b ? b.id : (s.banks[0] || {}).id || ''}` } }
function setQuestionFavorite(storage, id, value) { bind(storage); return mutate(value ? 'PUT' : 'DELETE', `/me/favorites/${encodeURIComponent(id)}`).then(() => { invalidateLearning(); return refreshLearning(storage) }).then(() => ({ value, favorites: getFavorites(storage) })) }
function addQuestionFavorite(storage, id) { return setQuestionFavorite(storage, id, true) }
function removeQuestionFavorite(storage, id) { return setQuestionFavorite(storage, id, false) }
function toggleQuestionFavorite(storage, id) { bind(storage); const value = !state.favorites.some((q) => q.questionId === id); return mutate(value ? 'PUT' : 'DELETE', `/me/favorites/${encodeURIComponent(id)}`).then(() => { invalidateLearning(); return refreshLearning(storage) }).then(() => ({ value, favorites: getFavorites(storage) })) }
function removeQuestionFavorites(storage, ids) { return ids.reduce((p, id) => p.then(() => mutate('DELETE', `/me/favorites/${encodeURIComponent(id)}`)), Promise.resolve()).then(() => { invalidateLearning(); return refreshLearning(storage) }) }
function clearFavorites(storage) { return removeQuestionFavorites(storage, getFavorites(storage).ids) }
function removeWrongQuestions() { return Promise.reject(new Error('错题记录随练习结果更新，请通过复习掌握题目')) }
function searchQuestions(storage, keyword, page) {
  const user = bind(storage)
  if (!user) return Promise.reject(new Error('请先登录'))
  return api.request('GET', '/questions', { keyword, page: page || 1, pageSize: 20 }).then(checked).then((result) => {
    bind(storage)
    if (owner !== user) throw new Error('账号已切换，请重新搜索')
    cacheQuestions(result.items || [])
    const index = getQuestionIndex()
    return { total: result.total, page: result.page, items: (result.items || []).map((question) => {
      const entry = index[question.id]
      return { questionId: question.id, stem: question.stem, typeText: entry.question.typeText, sourceText: [entry.subjectName, entry.bankName].filter(Boolean).join(' · ') }
    }) }
  })
}
function getProfile(storage) { bind(storage); return state.profile }
function getColleges() { return state.colleges }
function loadMajors(id) { return all(`/colleges/${id}/majors`).then((items) => { state.majors = items; return items }) }
function saveProfile(storage, patch) { const profile = getProfile(storage); if (!profile) return Promise.reject(new Error('请先刷新账号资料')); return mutate('PUT', '/me/profile', Object.assign({ expectedVersion: profile.version, nickname: profile.nickname, collegeId: profile.collegeId, majorId: profile.majorId, enrollmentYear: profile.enrollmentYear }, patch)).then(() => { profileAt = 0; return refreshProfile(storage) }) }
module.exports = { searchQuestions, addQuestionFavorite, removeQuestionFavorite, getBankMeta, invalidateLearning, enable, isEnabled, bind, refresh, refreshCatalog, refreshLearning, refreshProfile, mapQuestion, cacheQuestions, loadQuestion, getSubjectSummaries, getSubjectDetail, getCatalogStats, getBankQuiz, getSubjectQuiz, getQuestionIndex, findQuestionEntries, getFavorites, getWrongBook, getDailyLog, getStudyTime, getStatistics, getProgress, getRecent, getHistory, getScopeMeta, toggleQuestionFavorite, removeQuestionFavorites, clearFavorites, removeWrongQuestions, getProfile, getColleges, loadMajors, saveProfile }
module.exports.getAnnouncements = getAnnouncements
