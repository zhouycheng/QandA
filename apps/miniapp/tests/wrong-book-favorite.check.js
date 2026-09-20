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

// ---------- 5. 错题本页面 ViewModel ----------
{
  const storage = createMemoryStorage()
  const practiceVm = new PracticeViewModel({ storage })
  practiceVm.load({ subjectId: 'subject-english', bankId: 'english-ch001', mode: 'order' })
  answerSession(practiceVm, (index) => index < 2)

  const wrongVm = new WrongBookViewModel({ storage })
  const wrongData = wrongVm.load({ tab: 'wrong' }).data

  assert('错题本页 - 待复习列表', wrongData.items.length === 2, `实际 ${wrongData.items.length}`)
  assert('错题本页 - 统计数字', wrongData.pendingCount === 2 && wrongData.masteredCount === 0, '统计不符')
  assert('错题本页 - 题目正文还原', !!wrongData.items[0].stem && !!wrongData.items[0].sourceText, '题干缺失')
  assert('错题本页 - 练习按钮文案', wrongData.practiceText === '重练错题 2 题', wrongData.practiceText)

  const masteredData = wrongVm.switchFilter('mastered').data
  assert('错题本页 - 已攻克为空', masteredData.items.length === 0 && !!masteredData.emptyText, '切换筛选异常')

  wrongVm.switchFilter('pending')
  const practiceCommand = wrongVm.createPracticeCommand()
  assert('错题本页 - 生成练习指令', practiceCommand &&
    utils.customQuiz.normalizeCustomQuiz(storage.get('qandaCustomQuiz')).ids.length === 2, '练习卷未生成')

  // 收藏页
  practiceVm.load({ subjectId: 'subject-english', bankId: 'english-ch001', mode: 'order' })
  practiceVm.toggleFavoriteQuestion()
  const favoriteVm = new WrongBookViewModel({ storage })
  const favoriteData = favoriteVm.load({ tab: 'favorite' }).data

  assert('收藏页 - 列表渲染', favoriteData.items.length === 1 &&
    favoriteData.items[0].isFavorite, `实际 ${favoriteData.items.length}`)
  assert('收藏页 - 统计数字', favoriteData.favoriteCount === 1, '收藏数不符')

  const removed = favoriteVm.removeItem(favoriteData.items[0].id)
  assert('收藏页 - 移除收藏', removed.data.items.length === 0 &&
    utils.favorites.countFavorites(storage.get('qandaFavorites')) === 0, '移除失败')

  // 我的页统计
  const myVm = new MyViewModel({ storage })
  const myData = myVm.load().data
  assert('我的页 - 错题/收藏统计', myData.wrongCount === 2 && myData.favoriteCount === 0,
    `wrong=${myData.wrongCount} favorite=${myData.favoriteCount}`)
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

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
