const assert = require('assert')
const api = require('../miniprogram/repositories/api-transport.js')
const remote = require('../miniprogram/repositories/remote-data-repository.js')
const auth = require('../miniprogram/repositories/auth-repository.js')
const { QuestionDetailViewModel } = require('../miniprogram/viewmodels/question-detail-viewmodel.js')
const repository = require('../miniprogram/repositories/practice-repository.js')
const values = {}
const storage = { get: (k) => values[k], set: (k,v) => { values[k] = v }, remove: (k) => delete values[k] }
const calls = []
let announcements = [{ id: 'n1', title: '课程通知', body: '公告正文', status: 'PUBLISHED' }]
api.request = async (method, path, body) => {
  calls.push([method,path,body])
  const lists = {
    '/subjects': [{ id: 's1', name: '课程一', bankCount: 1, questionCount: 3 }],
    '/question-banks': [{ id: 'b1', subjectId: 's1', name: '题库一', activeQuestionCount: 3, contentVersion: 8, progress: { answeredCount: 1, correctCount: 1, wrongCount: 0 } }],
    '/me/favorites': [{ questionId: 'q1', questionBankId: 'b1', type: 'SINGLE_CHOICE', stem: '收藏题' }],
    '/me/wrong-questions': [{ questionId: 'q1', questionBankId: 'b1', type: 'SINGLE_CHOICE', stem: '错题', rightCount: 1, wrongCount: 2, lastPracticedAt: '2026-10-28T01:00:00Z' }],
    '/announcements': announcements,
    '/colleges': [{ id: 'c1', name: '学院一' }]
  }
  if (lists[path]) return { ok: true, data: { total: lists[path].length, page: body.page, pageSize: body.pageSize, items: lists[path] } }
  if (path === '/subjects/s21') return { ok: true, data: { id: 's21', name: '直接进入的课程', bankCount: 30, questionCount: 600 } }
  if (path === '/me/learning-overview') return { ok: true, data: { answeredCount: 1, correctCount: 1, wrongCount: 1, favoriteCount: 1, subjectCount: 1, bankCount: 1, totalCount: 3, durationSeconds: 600, practiceCount: 1 } }
  if (path === '/me/question-collections/summary') return { ok: true, data: { total: 1, pendingCount: 1, repeatCount: 1, facets: [] } }
  if (path.startsWith('/me/recent-learning')) return { ok: true, data: { total: 1, page: 1, pageSize: 20, items: [{ id: 'p1', questionBankId: 'b1', status: 'IN_PROGRESS' }] } }
  if (path === '/me') return { ok: true, data: { id: 'u1', nickname: '同学', version: 2, collegeId: 'c1', majorId: 'm1' } }
  if (path === '/questions') return { ok: true, data: { total: 1, page: 1, items: [{ id: 'q1', questionBankId: 'b1', type: 'SINGLE_CHOICE', stem: '题目', options: [] }] } }
  if (path.startsWith('/questions/')) return { ok: true, data: { id: 'q1', questionBankId: 'b1', type: 'SINGLE_CHOICE', stem: '题目', options: [{ key: 'A', content: '选项' }], correctAnswer: ['A'], explanation: '不可提前显示' } }
  if (path === '/me/statistics') return { ok: true, data: { answeredCount: 20, objectiveAccuracy: 0.75, durationSeconds: 600 } }
  if (path.startsWith('/me/statistics/days')) return { ok: true, data: [{ date: '2026-10-28', answeredCount: 5, correctCount: 4, durationSeconds: 60 }] }
  return { ok: true, data: {} }
}
async function main() {
  remote.enable(true)
  await Promise.all([remote.refresh(storage, 'catalog'), remote.refresh(storage, 'catalog')])
  assert.deepStrictEqual(calls.map(call => call[1]).sort(), ['/question-banks', '/subjects'], '游客读取分页目录，合并重复请求')
  assert(calls.every(call => call[2].includeProgress === undefined), '游客目录省略个人进度')
  assert.equal(remote.getBankMeta('b1').name, '题库一')
  await remote.refresh(storage, 'catalog')
  assert.equal(calls.length, 2, '游客有效缓存零重复读取')
  await remote.refresh(storage, 'stats')
  assert.equal(calls.length, 2, '游客不请求个人统计')
  await remote.searchQuestions(storage, '题目', 1)
  await remote.loadQuestion(storage, 'q1')
  assert.deepStrictEqual(calls.slice(2).map(call => call[1]), ['/questions', '/questions/q1'])
  calls.length = 0
  auth.saveAuth(storage, { provider: 'email', userId: 'u1', token: 'token', nickname: '同学' })
  remote.bind(storage)
  assert.equal(remote.getSubjectSummaries().length, 0, '登录账号使用独立目录缓存')
  const { SubjectListViewModel } = require('../miniprogram/viewmodels/subject-list-viewmodel.js')
  const homeVm = new SubjectListViewModel({ repository, storage })
  assert.strictEqual(homeVm.load().data.hasAnnouncements, false, '公告加载前保持静止')
  await Promise.all([homeVm.refreshRemote(), homeVm.refreshRemote()])
  assert.deepStrictEqual(calls.map(c => c[1]).sort(), ['/announcements', '/me/learning-overview'], '首页仅请求两个轻量资源，并发刷新合并')
  assert.strictEqual(calls.find(c => c[1] === '/announcements')[2].pageSize, 1)
  assert.strictEqual(homeVm.load().data.hasAnnouncements, true, '有可见公告时持续摇动')
  assert.strictEqual(homeVm.load().data.announcements[0].body, '公告正文')
  assert.strictEqual(homeVm.openAnnouncement().data.announcementSheetVisible, true)
  assert.strictEqual(homeVm.closeAnnouncement().data.announcementSheetVisible, false)
  assert.strictEqual(homeVm.load().data.hasAnnouncements, true, '关闭公告后仍持续摇动')
  const openSheet = Object.assign({}, homeVm.openAnnouncement().data, (await homeVm.refreshRemote()).data)
  assert.strictEqual(openSheet.announcementSheetVisible, true, '异步刷新保留打开的公告弹窗')
  assert.strictEqual(calls.filter((c) => c[1] === '/announcements').length, 1, '有效缓存不重复请求')
  const originalNow = Date.now
  announcements = []
  Date.now = () => originalNow() + 60001
  try {
    assert.strictEqual((await homeVm.refreshRemote()).data.hasAnnouncements, false, '公告撤下后恢复静止')
  } finally { Date.now = originalNow }
  await remote.refresh(storage, 'catalog')
  await remote.refresh(storage, 'catalog', { subjectId: 's21' })
  assert.strictEqual(remote.getSubjectDetail('s21').questionCount, 600, '科目在目录第一页之外时直接读取目标摘要')
  const directCalls = calls.filter(c => c[1] === '/subjects/s21').length
  await remote.refresh(storage, 'catalog', { subjectId: 's21' })
  assert.strictEqual(calls.filter(c => c[1] === '/subjects/s21').length, directCalls, '直接入口摘要也复用有效缓存')
  await remote.refresh(storage, 'collection', { kind: 'WRONG' })
  await remote.refresh(storage, 'collection', { kind: 'FAVORITE' })
  await remote.refresh(storage, 'stats', { period: 'WEEK' })
  assert.strictEqual(remote.getSubjectSummaries()[0].questionCount, 3)
  assert.strictEqual(remote.getBankMeta('b1').contentVersion, 8)
  assert.strictEqual(remote.getProgress(storage).b1.answeredCount, 1)
  assert.deepStrictEqual(remote.getProgress(storage).b1.answers, {}, '题库进度使用服务端摘要')
  assert.strictEqual((await remote.searchQuestions(storage, '题目', 1)).items[0].questionId, 'q1')
  assert.strictEqual(remote.getWrongBook(storage).q1.wrongCount, 2)
  assert.deepStrictEqual(remote.getFavorites(storage).ids, ['q1'])
  assert.strictEqual(remote.getDailyLog(storage)['2026-10-28'].answered, 5)
  await remote.loadQuestion(storage, 'q1')
  const view = new QuestionDetailViewModel({ repository, storage }).load({ id: 'q1' }).data
  assert.strictEqual(view.correctText, '')
  assert.strictEqual(view.explanation, '')
  assert.ok(view.options.every((o) => !o.isCorrectOption))
  const runtime = require('../miniprogram/repositories/online-practice.js').enable(storage)
  runtime.identity()
  const snapshot = { id: 'p1', feedback: 'IMMEDIATE', status: 'IN_PROGRESS', items: [{ itemId: 'i1', question: { id: 'q1', type: 'SINGLE_CHOICE', stem: '题目', options: [{ key: 'A', content: '选项' }] } }], offlineGrading: [{ itemId: 'i1', correctAnswer: ['A'], explanation: '确认后解析' }], localState: { answers: [{ questionId: 'q1', selectedKeys: ['A'], confirmed: false, isCorrect: true }] } }
  runtime.put('p1', snapshot)
  const detail = new QuestionDetailViewModel({ repository, storage })
  assert.strictEqual(detail.load({ id: 'q1', sessionId: 'p1' }).data.explanation, '', '未确认不可显示')
  snapshot.localState.answers[0].confirmed = true
  runtime.put('p1', snapshot)
  assert.strictEqual(detail.load({ id: 'q1', sessionId: 'p1' }).data.explanation, '确认后解析', '即时模式确认后显示')
  snapshot.feedback = 'AFTER_FINISH'; runtime.put('p1', snapshot)
  assert.strictEqual(detail.load({ id: 'q1', sessionId: 'p1' }).data.explanation, '', '统一反馈交卷前不可显示')
  snapshot.status = 'SUBMITTED'; runtime.put('p1', snapshot)
  assert.strictEqual(detail.load({ id: 'q1', sessionId: 'p1' }).data.explanation, '确认后解析', '交卷后显示')
  runtime.queue.stop()
  const pendingSearch = {}
  const searchVm = new SubjectListViewModel({ storage, repository: { isRemoteEnabled: () => true, searchRemoteQuestions: (storage, text) => new Promise((resolve) => { pendingSearch[text] = resolve }) } })
  const oldSearch = searchVm.searchQuestions('旧词')
  const newSearch = searchVm.searchQuestions('新词')
  pendingSearch['新词']({ total: 1, items: [{ questionId: 'new' }] })
  assert.strictEqual((await newSearch).data.searchResults[0].questionId, 'new')
  pendingSearch['旧词']({ total: 1, items: [{ questionId: 'old' }] })
  assert.strictEqual(await oldSearch, null, '迟到搜索响应不得替换新结果')

  const onlineRuntime = require('../miniprogram/repositories/online-practice.js')
  const oldCurrent = onlineRuntime.current
  onlineRuntime.current = () => ({ waitingIds: () => ['waiting-id'], getWaiting: () => ({ route: { bankId: 'bank' }, writer: { state: 'WAITING' } }) })
  const waitingChoices = await new SubjectListViewModel({ storage }).openRecent()
  assert.strictEqual(waitingChoices.command.type, 'choosePractice')
  assert.strictEqual(waitingChoices.command.choices[0].id, 'waiting-id', '后台等待的原练习必须有可重新打开的入口')
  onlineRuntime.current = oldCurrent

  await remote.refreshProfile(storage)
  await remote.saveProfile(storage, { nickname: '新昵称' })
  const save = calls.find((c) => Array.isArray(c) && c[0] === 'PUT' && c[1] === '/me/profile')
  assert.strictEqual(save[2].majorId, 'm1', '完整更新保留未编辑资料')
  auth.saveAuth(storage, { provider: 'email', userId: 'u2', token: 'other' })
  assert.deepStrictEqual(remote.getFavorites(storage).ids, [], '账号切换立即清理内存快照')
  assert.strictEqual(remote.getSubjectSummaries().length, 0)
  let resolveProfile
  api.request = (method, path) => path === '/me' ? new Promise((resolve) => { resolveProfile = resolve }) : Promise.resolve({ ok: true, data: {} })
  const pendingProfile = remote.refreshProfile(storage)
  await Promise.resolve()
  auth.saveAuth(storage, { provider: 'email', userId: 'u3', token: 'third', nickname: '第三个账号' })
  resolveProfile({ ok: true, data: { id: 'u2', nickname: '旧账号资料', version: 9 } })
  await pendingProfile
  assert.strictEqual(auth.getAuth(storage).nickname, '第三个账号', '切换账号后迟到的资料响应不得写入新身份')

  const originalRequest = api.request
  let resolveAnnouncements
  api.request = (method, path, query) => path === '/announcements' ? new Promise((resolve) => { resolveAnnouncements = resolve }) : originalRequest(method, path, query)
  const pendingHome = homeVm.refreshRemote()
  await Promise.resolve()
  auth.saveAuth(storage, { provider: 'email', userId: 'u4', token: 'fourth' })
  resolveAnnouncements({ ok: true, data: { total: 1, page: 1, pageSize: 1, items: [{ id: 'old', title: '旧账号公告' }] } })
  await pendingHome
  assert.deepStrictEqual(remote.getAnnouncements(storage), [], '迟到公告不得显示到新账号')
  assert.strictEqual(homeVm.load().data.hasAnnouncements, false)

  remote.enable(false)
  console.log('remote-data checks passed')
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
