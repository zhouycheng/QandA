/**
 * 错题本 / 收藏 / 重练错题 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/wrong-book-favorite.check.js
 *
 * 小程序运行在微信沙箱内，纯计算层（utils / models / viewmodels / repositories）
 * 可以直接在 Node 中 require 验证，避免每次改动都要在开发者工具里点一遍。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const utils = {
  favorites: require(path.join(MINIPROGRAM, 'utils/favorites.js')),
  wrongBook: require(path.join(MINIPROGRAM, 'utils/wrong-book.js')),
  customQuiz: require(path.join(MINIPROGRAM, 'utils/custom-quiz.js')),
  questionLookup: require(path.join(MINIPROGRAM, 'utils/question-lookup.js'))
}
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))
const { WrongBookViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/wrong-book-viewmodel.js'))
const { MyViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/my-viewmodel.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function createMemoryStorage(initial) {
  const map = Object.assign({}, initial || {})

  return {
    get(key) {
      return map[key] === undefined ? null : map[key]
    },

    set(key, value) {
      map[key] = value
    },

    remove(key) {
      delete map[key]
    },

    keys() {
      return Object.keys(map)
    },

    raw: map
  }
}

function findOptionIndex(question, predicate) {
  return question.options.findIndex((option) => predicate(option.key))
}

function answerSession(vm, shouldAnswerWrong) {
  const questions = vm.session.state.questions

  questions.forEach((question, index) => {
    const wrong = shouldAnswerWrong(index)
    const correctIndexes = question.options.reduce(
      (items, option, optionIndex) =>
        question.answerKeys.indexOf(option.key) >= 0 ? items.concat(optionIndex) : items,
      []
    )
    const wrongIndex = findOptionIndex(question, (key) => question.answerKeys.indexOf(key) < 0)

    if (question.isMultiple) {
      const indexes = wrong && wrongIndex >= 0 ? correctIndexes.concat(wrongIndex) : correctIndexes

      indexes.forEach((optionIndex) => vm.selectOption(optionIndex))
      // 多选题需要先确认答案，再前进
      vm.goNext()
    } else {
      vm.selectOption(wrong && wrongIndex >= 0 ? wrongIndex : correctIndexes[0])
    }

    vm.goNext()
  })

  return vm.forceSubmit()
}

// ---------- 1. 收藏夹纯计算 ----------
{
  const { addFavorite, countFavorites, getFavoriteIds, hasFavorite, removeFavorite, toggleFavorite } = utils.favorites
  let favorites = addFavorite(null, 'q-001')
  favorites = addFavorite(favorites, 'q-002')

  assert('收藏夹 - 新增两条', countFavorites(favorites) === 2, `实际 ${countFavorites(favorites)}`)
  assert('收藏夹 - 去重', countFavorites(addFavorite(favorites, 'q-001')) === 2, '重复收藏未去重')
  assert('收藏夹 - 最新在前', getFavoriteIds(favorites)[0] === 'q-002', `实际 ${getFavoriteIds(favorites)[0]}`)

  const toggled = toggleFavorite(favorites, 'q-001')
  assert('收藏夹 - 取消收藏', toggled.value === false && !hasFavorite(toggled.favorites, 'q-001'), '取消失败')
  assert('收藏夹 - 移除条目', !hasFavorite(removeFavorite(favorites, 'q-002'), 'q-002'), '移除失败')
}

// ---------- 2. 错题本纯计算 ----------
{
  const { getPendingIds, getMasteredIds, mergeResults, summarizeWrongBook } = utils.wrongBook
  const correctOnly = mergeResults(null, [{ id: 'q-009', answered: true, correct: true }])
  assert('错题本 - 答对不入库', getPendingIds(correctOnly).length === 0, '答对的题不应进入错题本')

  let wrongBook = mergeResults(null, [{ id: 'q-001', answered: true, correct: false }])
  assert('错题本 - 答错入库', getPendingIds(wrongBook).length === 1, '未入库')

  wrongBook = mergeResults(wrongBook, [{ id: 'q-001', answered: true, correct: true }])
  assert('错题本 - 答对一次仍在待复习', getPendingIds(wrongBook).length === 1, '连续答对 1 次不应攻克')

  wrongBook = mergeResults(wrongBook, [{ id: 'q-001', answered: true, correct: true }])
  assert('错题本 - 连续答对 2 次攻克', getMasteredIds(wrongBook).length === 1, '未标记为已攻克')
  assert('错题本 - 攻克后移出待复习', getPendingIds(wrongBook).length === 0, '仍在待复习列表')

  wrongBook = mergeResults(wrongBook, [{ id: 'q-001', answered: true, correct: false }])
  assert('错题本 - 再错回到待复习', getPendingIds(wrongBook).length === 1, '未回到待复习')

  const withUnanswered = mergeResults(null, [{ id: 'q-002', answered: false, correct: false }])
  assert('错题本 - 未作答按答错处理', getPendingIds(withUnanswered).length === 1, '未作答未入错题本')

  const summary = summarizeWrongBook(wrongBook)
  assert('错题本 - 汇总字段完整', summary.pending === 1 && summary.total === 1, JSON.stringify(summary))
}

// ---------- 3. 题目反查 ----------
{
  const { getQuizByIds, getQuestionIndex } = utils.questionLookup
  const index = getQuestionIndex()
  const allIds = Object.keys(index)

  assert('题目反查 - 索引非空', allIds.length > 0, '索引为空')
  const quiz = getQuizByIds([allIds[0], allIds[1]], '测试卷')

  assert('题目反查 - 按 id 组卷', quiz && quiz.questions.length === 2, '组卷数量不符')
  assert('题目反查 - 跨题库不记最佳分', quiz && quiz.storageKey === '', 'storageKey 应为空')
  assert('题目反查 - 忽略无效 id', getQuizByIds(['not-exist']) === null, '无效 id 应返回 null')
}

// ---------- 4. 端到端：答题 → 收藏 / 错题 / 重练 ----------
{
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })
  const loaded = vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  const questions = vm.session.state.questions

  assert('端到端 - 载入题库', questions.length > 0, '题目为空')
  assert('端到端 - 初始无收藏', loaded.data.favoriteQuestionIds.length === 0, '初始收藏非空')

  // 收藏第 1 题
  const favoriteResult = vm.toggleFavoriteQuestion()
  assert('端到端 - 收藏落盘', !!storage.get('qandaFavorites') &&
    utils.favorites.hasFavorite(storage.get('qandaFavorites'), questions[0].id), '收藏未写入 storage')

  vm.toggleFavoriteQuestion()
  assert('端到端 - 取消收藏落盘', utils.favorites.countFavorites(storage.get('qandaFavorites')) === 0, '取消未落盘')
  vm.toggleFavoriteQuestion()
  assert('端到端 - 收藏状态回显', favoriteResult && favoriteResult.value === true, '收藏返回值异常')

  // 第 1 题答错，其余答对
  answerSession(vm, (index) => index === 0)
  const resultData = vm.session.getViewData()

  assert('端到端 - 错题 id 收集', resultData.wrongQuestionIds.length === 1 &&
    resultData.wrongQuestionIds[0] === questions[0].id, JSON.stringify(resultData.wrongQuestionIds))
  assert('端到端 - 结果页展示错题数', resultData.wrongCount === 1 && resultData.hasWrongQuestions, 'wrongCount 异常')

  const wrongBook = storage.get('qandaWrongBook')
  assert('端到端 - 错题本落盘', !!wrongBook && utils.wrongBook.getPendingIds(wrongBook).length === 1, '错题本未写入')
  assert('端到端 - 进度落盘', !!storage.get('qandaProgress'), '进度未写入')

  // 重练错题
  const redoCommand = vm.createRedoWrongCommand(resultData.wrongQuestionIds)
  assert('端到端 - 重练指令生成', redoCommand && redoCommand.command.type === 'navigate', '指令缺失')
  assert('端到端 - 自定义卷落盘',
    utils.customQuiz.normalizeCustomQuiz(storage.get('qandaCustomQuiz')).ids.length === 1, '自定义卷未写入')

  const redoVm = new PracticeViewModel({ storage })
  const redoLoaded = redoVm.load({ scope: 'custom', mode: 'practice' })

  assert('端到端 - 重练载入错题', redoLoaded.data.questions.length === 1 &&
    redoLoaded.data.questions[0].id === questions[0].id, '重练题目不符')
  assert('端到端 - 重练保留收藏标记', redoLoaded.data.isCurrentQuestionFavorite === true, '收藏状态未回填')

  // 重练答对一次：仍在待复习
  answerSession(redoVm, () => false)
  assert('端到端 - 重练答对仍待复习',
    utils.wrongBook.getPendingIds(storage.get('qandaWrongBook')).length === 1, '答对一次不应立即攻克')

  // 再答对一次：攻克
  const secondVm = new PracticeViewModel({ storage })
  secondVm.load({ scope: 'custom', mode: 'practice' })
  answerSession(secondVm, () => false)

  assert('端到端 - 连续答对两次攻克',
    utils.wrongBook.getMasteredIds(storage.get('qandaWrongBook')).length === 1, '未标记为已攻克')

  // 背题模式不写错题本
  const viewStorage = createMemoryStorage()
  const viewVm = new PracticeViewModel({ storage: viewStorage })
  viewVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'view' })
  viewVm.forceSubmit()

  assert('端到端 - 背题模式不记错题', !viewStorage.get('qandaWrongBook'), '背题模式写入了错题本')
}

// ---------- 5. 错题本 / 收藏本页面 ViewModel（设计稿两张画板） ----------
{
  const storage = createMemoryStorage()
  const practiceVm = new PracticeViewModel({ storage })
  practiceVm.load({ subjectId: 'subject-english', bankId: 'english-ch001', mode: 'order' })
  answerSession(practiceVm, (index) => index < 2)

  const wrongVm = new WrongBookViewModel({ storage })
  const wrongData = wrongVm.load({ type: 'wrong' }).data

  assert('错题本页 - 标题与统计卡标题',
    wrongData.title === '错题本' && wrongData.statTitle === '错题统计',
    wrongData.title)
  assert('错题本页 - 三个指标齐全且总数正确',
    wrongData.stats.length === 3 && wrongData.stats[0].value === '2',
    JSON.stringify(wrongData.stats))
  // 正确率必须是「本子里的题」的答对率：全部只答错过、没答对过就是 0%，
  // 取全站正确率会显示成好看的 80%，和这一页的主题自相矛盾
  assert('错题本页 - 正确率按本子内作答算',
    wrongData.stats[1].key === 'accuracy' && wrongData.stats[1].value === '0',
    JSON.stringify(wrongData.stats[1]))
  assert('错题本页 - 统计卡提示不复用正确率',
    wrongData.statHint.indexOf('%') < 0, wrongData.statHint)
  assert('错题本页 - 只列待复习（已攻克不算错题）',
    wrongData.items.length === 2, `实际 ${wrongData.items.length}`)
  assert('错题本页 - 卡片带知识点与题干',
    wrongData.items[0].title.indexOf(' · ') > 0 && !!wrongData.items[0].stem,
    JSON.stringify(wrongData.items[0]))
  assert('错题本页 - 错次徽标', /^错 \d+ 次$/.test(wrongData.items[0].badgeText), wrongData.items[0].badgeText)
  assert('错题本页 - 科目分布有数据',
    wrongData.hasDist && wrongData.dist.length >= 1 && wrongData.dist[0].count === 2,
    JSON.stringify(wrongData.dist))
  assert('错题本页 - chips 是「全部 / 反复错 / 近 7 天更新」',
    wrongData.chips.map((chip) => chip.key).join(',') === 'all,repeat,recent',
    wrongData.chips.map((chip) => chip.key).join(','))
  assert('错题本页 - chips 带真实计数', wrongData.chips[0].text === '全部 2', wrongData.chips[0].text)
  assert('错题本页 - 底部按钮带题量',
    wrongData.footerText === '开始错题练习 · 2 道', wrongData.footerText)
  assert('错题本页 - 默认按「最需复习」排', wrongData.sortText === '最需复习', wrongData.sortText)

  // 每道只错 1 次时，「反复错」应当是空列表 + 筛选空态（不是「还没有错题」）
  const repeatData = wrongVm.setChip('repeat').data
  assert('错题本页 - 反复错筛选为空时给筛选空态',
    repeatData.items.length === 0 && repeatData.emptyText.indexOf('换个条件') >= 0,
    repeatData.emptyText)
  wrongVm.setChip('all')

  const sorted = wrongVm.toggleSort().data
  assert('错题本页 - 排序在两种口径间切换', sorted.sortText === '最近更新', sorted.sortText)
  assert('错题本页 - 再点一次切回最需复习', wrongVm.toggleSort().data.sortText === '最需复习')

  // 管理态：卡片上出现「移除」，底部按钮变成「清空」
  const managed = wrongVm.toggleManage().data
  assert('错题本页 - 管理态开启', managed.manage === true)
  assert('错题本页 - 管理态说明文案随类型变', !!managed.footerHint, managed.footerHint)
  wrongVm.toggleManage()

  const practiceCommand = wrongVm.createPracticeCommand()
  assert('错题本页 - 生成练习指令', practiceCommand &&
    practiceCommand.command.type === 'navigate' &&
    utils.customQuiz.normalizeCustomQuiz(storage.get('qandaCustomQuiz')).ids.length === 2,
    '练习卷未生成')

  // ---------- 分页：题目超过一页才有第二页 ----------
  const pageStorage = createMemoryStorage()
  const pageVm = new WrongBookViewModel({ storage: pageStorage })
  const orderVm = new PracticeViewModel({ storage: pageStorage })
  orderVm.load({ subjectId: 'subject-english', bankId: 'english-ch001', mode: 'order' })
  const bankQuestionIds = orderVm.session.state.questions.map((question) => question.id)
  const manyWrong = {}

  bankQuestionIds.slice(0, 6).forEach((questionId, index) => {
    manyWrong[questionId] = {
      wrongCount: 6 - index,
      rightCount: 0,
      streak: 0,
      mastered: false,
      updatedAt: 1000 + index
    }
  })
  pageStorage.set('qandaWrongBook', manyWrong)

  const firstPage = pageVm.load({ type: 'wrong' }).data
  assert('错题本页 - 一页 5 道', firstPage.items.length === 5 && firstPage.pageCount === 2,
    `${firstPage.items.length} / ${firstPage.pageCount}`)
  assert('错题本页 - 分页文案', firstPage.pageText === '共 6 题 · 第 1 页', firstPage.pageText)
  assert('错题本页 - 最需复习按错次降序', firstPage.items[0].wrongCount === 6, String(firstPage.items[0].wrongCount))

  const secondPage = pageVm.goNextPage().data
  assert('错题本页 - 翻到第二页只剩 1 道', secondPage.items.length === 1 && secondPage.page === 2, String(secondPage.items.length))
  assert('错题本页 - 末页再翻不动', pageVm.goNextPage() === null)
  assert('错题本页 - 可翻回上一页', pageVm.goPrevPage().data.page === 1)

  // ---------- 收藏本 ----------
  practiceVm.load({ subjectId: 'subject-english', bankId: 'english-ch001', mode: 'order' })
  practiceVm.toggleFavoriteQuestion()
  const favoriteVm = new WrongBookViewModel({ storage })
  const favoriteData = favoriteVm.load({ type: 'favorite' }).data

  assert('收藏本 - 标题与统计卡标题',
    favoriteData.title === '收藏本' && favoriteData.statTitle === '收藏统计',
    favoriteData.title)
  assert('收藏本 - 三个指标是 收藏 / 已练 / 待练',
    favoriteData.stats.map((item) => item.label).join(',') === '收藏题,已练习,待练习',
    favoriteData.stats.map((item) => item.label).join(','))
  assert('收藏本 - 列表渲染', favoriteData.items.length === 1, `实际 ${favoriteData.items.length}`)
  assert('收藏本 - chips 是「全部 / 待练习 / 已练习」',
    favoriteData.chips.map((chip) => chip.key).join(',') === 'all,pending,practiced',
    favoriteData.chips.map((chip) => chip.key).join(','))
  assert('收藏本 - 练过的题标「已练习」',
    favoriteData.items[0].badgeText === '已练习', favoriteData.items[0].badgeText)

  // 没练过的收藏标「待练习」：pageStorage 里只有错题记录，没有任何交卷进度
  const todoStorage = createMemoryStorage({
    qandaFavorites: { ids: [bankQuestionIds[0]], updatedAt: 1 }
  })
  const todoData = new WrongBookViewModel({ storage: todoStorage }).load({ type: 'favorite' }).data
  assert('收藏本 - 没练过的题标「待练习」',
    todoData.items.length === 1 && todoData.items[0].badgeText === '待练习',
    todoData.items.length ? todoData.items[0].badgeText : '无条目')
  assert('收藏本 - 统计里待练习计数正确', todoData.stats[2].value === '1', JSON.stringify(todoData.stats))
  assert('收藏本 - 底部按钮文案', favoriteData.footerText.indexOf('开始收藏练习') === 0, favoriteData.footerText)

  // 类型由参数决定，且旧的 tab 参数继续可用（题库页老入口跳转时带的是 tab）
  assert('收藏本 - 兼容旧 tab 参数',
    new WrongBookViewModel({ storage }).load({ tab: 'favorite' }).data.type === 'favorite')

  const removed = favoriteVm.removeItem(favoriteData.items[0].id)
  assert('收藏本 - 移除收藏', removed.data.items.length === 0 &&
    utils.favorites.countFavorites(storage.get('qandaFavorites')) === 0, '移除失败')

  // 空收藏要有空态，而不是一条渲染失败的卡片
  assert('收藏本 - 空态文案', removed.data.items.length === 0 && removed.data.emptyText.indexOf('还没有收藏') === 0,
    removed.data.emptyText)

  // 科目筛选只影响列表，不动统计卡（统计卡看的是全集）
  const filterVm = new WrongBookViewModel({ storage: pageStorage })
  filterVm.load({ type: 'wrong' })
  const filterTarget = filterVm.buildViewData().subjectFilters[1]
  const filtered = filterVm.setSubject(filterTarget.id).data
  assert('错题本页 - 科目筛选保留统计卡口径',
    filtered.totalCount === 6 && filtered.subjectFilterText === filterTarget.name,
    JSON.stringify({ total: filtered.totalCount, name: filtered.subjectFilterText }))

  // 我的页：改版后（设计稿 781:1922）不再重复展示错题 / 收藏计数，
  // 这两个数字的入口只有题库页左栏与统计页；这里锁住「别又长回来」
  const myData = new MyViewModel({ storage }).load().data

  assert('我的页 - 不再重复展示错题/收藏计数',
    myData.wrongCount === undefined && myData.favoriteCount === undefined,
    `wrong=${myData.wrongCount} favorite=${myData.favoriteCount}`)
  assert('我的页 - 关于弹层带题库规模', myData.about.questionCount > 0,
    `questionCount=${myData.about.questionCount}`)
}

// ---------- 6. 底部主按钮文案（底部只保留上一题 / 下一题） ----------
{
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })
  const loaded = vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  const questions = vm.session.state.questions

  assert('主按钮 - 首题未作答显示「下一题」', loaded.data.primaryActionText === '下一题',
    loaded.data.primaryActionText)
  assert('主按钮 - 首题可用于置灰「上一题」', loaded.data.currentIndex === 0,
    `currentIndex=${loaded.data.currentIndex}`)

  const lastIndex = questions.length - 1
  vm.jumpToQuestion(lastIndex)
  assert('主按钮 - 末题显示「交卷」', vm.session.getViewData().primaryActionText === '交卷',
    vm.session.getViewData().primaryActionText)

  const viewVm = new PracticeViewModel({ storage: createMemoryStorage() })
  viewVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'view' })
  viewVm.jumpToQuestion(viewVm.session.state.questions.length - 1)
  assert('主按钮 - 背题末题显示「返回题库」',
    viewVm.session.getViewData().primaryActionText === '返回题库',
    viewVm.session.getViewData().primaryActionText)
}

// ---------- 7. 标记（设计稿底部的第三个工具钮） ----------
{
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })
  vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })

  const before = vm.session.getViewData()
  assert('标记 - 初始未标记', before.isCurrentQuestionMarked === false)
  assert('标记 - 初始计数为 0', before.markedCount === 0, `实际 ${before.markedCount}`)

  const marked = vm.toggleMarkQuestion()
  assert('标记 - 点一下变成已标记', marked.data.isCurrentQuestionMarked === true)
  assert('标记 - 计数 +1', marked.data.markedCount === 1, `实际 ${marked.data.markedCount}`)
  assert('标记 - 回传 value 供 toast 使用', marked.value === true)

  const items = vm.session.getOverviewItems(vm.session.state.answers, 0)
  assert('标记 - 答题卡第 1 格带 isMarked', items[0].isMarked === true)
  assert('标记 - 其它格不带 isMarked', items[1].isMarked === false)

  // 落盘 → 重新载入：橙色记号要还在。
  // ⚠️ 必须带 sessionId（或 resume=1）才会走恢复分支：只传 bankId 会新建一轮，
  //    那样断言「恢复后还在」永远失败，看起来像标记没存住
  vm.saveSessionNow()
  const savedSessionId = storage.raw.qandaSession.sessionId
  const restoredVm = new PracticeViewModel({ storage })
  restoredVm.load({ sessionId: savedSessionId, subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  assert('标记 - 会话恢复后标记还在',
    restoredVm.session.getViewData().isCurrentQuestionMarked === true)
  assert('标记 - 会话恢复后计数正确',
    restoredVm.session.getViewData().markedCount === 1,
    `实际 ${restoredVm.session.getViewData().markedCount}`)

  // 再点一次取消
  const unmarked = vm.toggleMarkQuestion()
  assert('标记 - 再点一下取消', unmarked.data.isCurrentQuestionMarked === false)
  assert('标记 - 取消后计数归零', unmarked.data.markedCount === 0)

  // 重练会开新一轮：标记属于这一轮，要清空，别把上一轮的记号带进新卷
  vm.toggleMarkQuestion()
  const restarted = vm.reset()
  assert('标记 - 重练清空标记', restarted.data.markedCount === 0 && restarted.data.isCurrentQuestionMarked === false)

  // 脏数据：markedIds 里混进不属于本卷的 id 必须被丢掉，否则答题卡会多出格子
  const dirtyStorage = createMemoryStorage({
    qandaSession: {
      sessionId: 'sess_dirty',
      subjectId: 'subject-chinese',
      questionBankId: 'chinese-ch001',
      config: { mode: 'order', subjectId: 'subject-chinese', bankId: 'chinese-ch001' },
      questionIds: ['ghost-question-id'],
      questionOrder: [0],
      currentIndex: 0,
      answers: [null],
      markedIds: ['ghost-question-id', 'not-in-this-sheet'],
      status: 'IN_PROGRESS',
      createdAt: 1,
      updatedAt: 1
    }
  })
  const dirtyVm = new PracticeViewModel({ storage: dirtyStorage })
  const dirtyLoaded = dirtyVm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'order' })
  const dirtyMarked = (dirtyLoaded.data.markedQuestionIds || []).filter(
    (id) => vm.session.state.questions.every((question) => question.id !== id)
  )
  assert('标记 - 脏数据里不属于本卷的 id 被过滤', dirtyMarked.length === 0,
    dirtyMarked.join(', '))
}

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
