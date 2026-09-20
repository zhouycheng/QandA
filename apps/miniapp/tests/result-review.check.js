/**
 * 结果复盘（PRD 4.7）与题目详情（PRD 5）—— Node 自检脚本。
 * 运行：node apps/miniapp/tests/result-review.check.js
 *
 * 覆盖：正确 / 错误 / 未答筛选、题干 + 选项搜索、题目详情。
 *
 * 最容易错的一点是「未作答」：它的 isCorrect 也是 false，
 * 只按 isCorrect 筛会把"没做"和"做错"混为一类——这里专门断言。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const {
  RESULT_FILTERS,
  countResultItems,
  filterResultItems
} = require(path.join(MINIPROGRAM, 'models/practice-session.js'))
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))
const { QuestionDetailViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/question-detail-viewmodel.js'))
const sessionRepository = require(path.join(MINIPROGRAM, 'repositories/session-repository.js'))

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

const BANK_OPTIONS = {
  subjectId: 'subject-chinese',
  bankId: 'chinese-ch001',
  mode: 'order'
}

// ---------- 1. 筛选与搜索（纯函数） ----------
{
  const items = [
    { id: 'q1', stem: '第一题', searchText: '第一题 选项甲 选项乙', selectedText: 'A. 选项甲', correctText: 'A. 选项甲', answered: true, isCorrect: true },
    { id: 'q2', stem: '第二题', searchText: '第二题 选项丙 选项丁', selectedText: 'B. 选项丁', correctText: 'A. 选项丙', answered: true, isCorrect: false },
    { id: 'q3', stem: '第三题', searchText: '第三题 选项戊 选项己', selectedText: '未作答', correctText: 'A. 选项戊', answered: false, isCorrect: false }
  ]

  assert('筛选 - 全部', filterResultItems(items, RESULT_FILTERS.ALL, '').length === 3, '数量不符')
  assert('筛选 - 正确', filterResultItems(items, RESULT_FILTERS.CORRECT, '').map((i) => i.id).join(',') === 'q1', '筛选错误')
  assert('筛选 - 错误（未作答不算错误）',
    filterResultItems(items, RESULT_FILTERS.WRONG, '').map((i) => i.id).join(',') === 'q2',
    filterResultItems(items, RESULT_FILTERS.WRONG, '').map((i) => i.id).join(','))
  assert('筛选 - 未答（不混进"错误"）',
    filterResultItems(items, RESULT_FILTERS.UNANSWERED, '').map((i) => i.id).join(',') === 'q3',
    filterResultItems(items, RESULT_FILTERS.UNANSWERED, '').map((i) => i.id).join(','))
  assert('筛选 - 未知筛选值回落为全部',
    filterResultItems(items, 'bogus', '').length === 3, '未回落')

  assert('搜索 - 命中题干', filterResultItems(items, RESULT_FILTERS.ALL, '第二').map((i) => i.id).join(',') === 'q2', '未命中')
  assert('搜索 - 命中选项文本', filterResultItems(items, RESULT_FILTERS.ALL, '选项己').map((i) => i.id).join(',') === 'q3', '未命中选项')
  assert('搜索 - 空关键词不限制', filterResultItems(items, RESULT_FILTERS.ALL, '   ').length === 3, '空白被当成关键词')
  assert('搜索 - 无命中返回空', filterResultItems(items, RESULT_FILTERS.ALL, '不存在的词').length === 0, '不应有结果')
  assert('搜索 - 筛选与搜索叠加生效',
    filterResultItems(items, RESULT_FILTERS.UNANSWERED, '选项甲').length === 0,
    '两个条件应同时生效')

  const counts = countResultItems(items)
  assert('计数 - 四类数量正确',
    counts.all === 3 && counts.correct === 1 && counts.wrong === 1 && counts.unanswered === 1,
    JSON.stringify(counts))
  assert('计数 - 空列表不报错',
    countResultItems(null).all === 0 && countResultItems([]).correct === 0, '空值未兜底')
}

// ---------- 2. 端到端：交卷后的复盘交互 ----------
{
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })
  vm.load(Object.assign({}, BANK_OPTIONS))

  const questions = vm.session.state.questions
  const targetCount = Math.min(4, questions.length)

  // 答对前两题，第三题故意不答
  for (let index = 0; index < targetCount - 1; index += 1) {
    vm.jumpToQuestion(index)
    const question = questions[index]
    const correctIndexes = question.options.reduce(
      (items, option, optionIndex) => question.answerKeys.indexOf(option.key) >= 0 ? items.concat(optionIndex) : items,
      []
    )

    if (question.isMultiple) {
      correctIndexes.forEach((optionIndex) => vm.selectOption(optionIndex))
      vm.goNext()
    } else {
      vm.selectOption(correctIndexes[0])
    }
  }

  vm.forceSubmit()
  const viewData = vm.session.getViewData()

  assert('交卷 - 生成复盘列表', viewData.resultItems.length === questions.length, `实际 ${viewData.resultItems.length}`)
  assert('交卷 - 复盘列表默认展示全部',
    viewData.filteredResultItems.length === viewData.resultItems.length,
    `${viewData.filteredResultItems.length} / ${viewData.resultItems.length}`)
  assert('交卷 - 未作答被单独标记',
    viewData.resultItems.filter((item) => !item.answered).length > 0,
    '没有未作答的题，该断言失去意义')
  assert('交卷 - 答对的题 isCorrect 为真、answered 为真',
    viewData.resultItems.filter((item) => item.answered && item.isCorrect).length >= 1,
    '未记录答对')
  assert('交卷 - 结果项带选项与搜索文本',
    viewData.resultItems[0].options.length > 0 && !!viewData.resultItems[0].searchText,
    '缺少 options / searchText')

  const counts = viewData.resultFilterCounts
  assert('交卷 - 计数与列表一致',
    counts.all === viewData.resultItems.length &&
    counts.correct + counts.wrong + counts.unanswered === counts.all,
    JSON.stringify(counts))

  const wrongResult = vm.setResultFilter('wrong')
  assert('切换 - 错误筛选生效',
    wrongResult.data.resultFilter === 'wrong' &&
    wrongResult.data.filteredResultItems.every((item) => item.answered && !item.isCorrect),
    '筛选结果混入非错误项')

  const unansweredResult = vm.setResultFilter('unanswered')
  assert('切换 - 未答筛选生效',
    unansweredResult.data.filteredResultItems.every((item) => !item.answered),
    '筛选结果混入已答项')
  assert('切换 - 未答筛选数量与计数一致',
    unansweredResult.data.filteredResultItems.length === counts.unanswered,
    `${unansweredResult.data.filteredResultItems.length} / ${counts.unanswered}`)

  const allResult = vm.setResultFilter('all')
  assert('切换 - 回到全部', allResult.data.filteredResultItems.length === counts.all, '未恢复')

  const searchResult = vm.setResultKeyword(questions[0].stem.slice(0, 6))
  assert('搜索 - 按题干缩小列表',
    searchResult.data.filteredResultItems.length < counts.all,
    `仍为 ${searchResult.data.filteredResultItems.length} 条`)
  assert('搜索 - 关键词被记录', searchResult.data.resultKeyword === questions[0].stem.slice(0, 6), '未记录')

  const emptyResult = vm.setResultKeyword('一定不存在的关键词')
  assert('搜索 - 空态给出文案',
    emptyResult.data.filteredResultItems.length === 0 && !!emptyResult.data.resultFilterEmptyText,
    `空态文案：${emptyResult.data.resultFilterEmptyText}`)

  vm.setResultKeyword('')
  assert('搜索 - 清空后恢复全部', vm.session.getViewData().filteredResultItems.length === counts.all, '未恢复')
}

// ---------- 3. 题目详情 ----------
{
  const storage = createMemoryStorage()
  const vm = new PracticeViewModel({ storage })
  vm.load(Object.assign({}, BANK_OPTIONS))

  const questions = vm.session.state.questions
  const firstQuestion = questions[0]
  const correctIndexes = firstQuestion.options.reduce(
    (items, option, optionIndex) => firstQuestion.answerKeys.indexOf(option.key) >= 0 ? items.concat(optionIndex) : items,
    []
  )

  vm.jumpToQuestion(0)

  if (firstQuestion.isMultiple) {
    correctIndexes.forEach((optionIndex) => vm.selectOption(optionIndex))
    vm.goNext()
  } else {
    vm.selectOption(correctIndexes[0])
  }

  const sessionId = vm.session.meta.sessionId

  const detailVm = new QuestionDetailViewModel({ storage })
  const detail = detailVm.load({
    id: firstQuestion.id,
    sessionId
  }).data

  assert('详情 - 未指定题目时给出空态',
    new QuestionDetailViewModel({ storage }).load({}).data.emptyText === '未指定题目',
    '空态文案缺失')
  assert('详情 - 题目不存在时不崩溃',
    new QuestionDetailViewModel({ storage }).load({ id: '不存在的题目' }).data.emptyText !== '',
    '未给出空态')
  assert('详情 - 题干正确', detail.stem === firstQuestion.stem, '题干不符')
  assert('详情 - 选项完整', detail.options.length === firstQuestion.options.length, '选项数量不符')
  assert('详情 - 标出正确选项', detail.options.some((option) => option.isCorrectOption), '未标正确选项')
  assert('详情 - 带出用户答案', detail.hasAnswer && !!detail.selectedText, '未带出答案')
  assert('详情 - 判定为答对', detail.isCorrect === true, '判定错误')
  assert('详情 - 带出正确答案与解析', !!detail.correctText && !!detail.explanation, '缺失')
  assert('详情 - 带出来源科目与题库', !!detail.subjectName && !!detail.bankName, `${detail.subjectName} / ${detail.bankName}`)

  // sessionId 对不上时应当作没答过
  const anonymous = new QuestionDetailViewModel({ storage }).load({
    id: firstQuestion.id,
    sessionId: '别的会话'
  }).data
  assert('详情 - sessionId 不匹配时不显示答案', !anonymous.hasAnswer, '越权带出了答案')

  // 不带 sessionId 只显示题目
  const noSession = new QuestionDetailViewModel({ storage }).load({
    id: firstQuestion.id
  }).data
  assert('详情 - 不带 sessionId 仅看题', !noSession.hasAnswer && !!noSession.correctText, '行为不符')

  // 未作答的题也能看详情
  const unanswered = new QuestionDetailViewModel({ storage }).load({
    id: questions[questions.length - 1].id,
    sessionId
  }).data
  assert('详情 - 未作答题目可查看', unanswered.ready && !unanswered.hasAnswer, '未作答不可查看')
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
