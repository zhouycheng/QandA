/**
 * 题库页 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/bank-detail-entry.check.js
 *
 * 2026-10-27 按设计稿改版后，页面从「科目栏 + 常驻参数按钮」变成
 * 「页内标题 + 搜索/筛选 + 科目栏 + 章节列表 + 答题配置抽屉」，
 * 本文件锁住的契约随之调整为：
 *
 *   1. 章节行一章一条，标题带「第N章：」，进度数字来自真实进度表；
 *   2. 参数全部在抽屉里，切参数只改状态、不跳转；
 *   3. 「开始答题」按 模式 × 顺序 × 限时 × 只答错题 组合出跳转链接；
 *   4. 背题固定原序、模拟考必须带时长、只答错题必须走 ids；
 *   5. 左栏「最近在刷 / 我的错题 / 我的收藏」三入口各有真实数据来源。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const catalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
const { BankDetailViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/bank-detail-viewmodel.js'))
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))

const SUBJECT_ID = 'subject-chinese'
const FIRST_BANK_ID = 'chinese-ch001'
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

/** 解析跳转 URL 的 query（保持原编码，交给答题页自己解码） */
function parseQuery(url) {
  const queryIndex = String(url).indexOf('?')

  if (queryIndex < 0) {
    return {}
  }

  return String(url).slice(queryIndex + 1).split('&').reduce((acc, pair) => {
    const segments = pair.split('=')
    acc[segments[0]] = segments.slice(1).join('=')
    return acc
  }, {})
}

function openPractice(query) {
  const vm = new PracticeViewModel({ storage: createMemoryStorage() })
  vm.load(query)
  return vm
}

function questionIds(session) {
  return session.state.questions.map((question) => question.id).join(',')
}

function decodeList(value) {
  return decodeURIComponent(value || '').split(',').filter(Boolean)
}

// ---------- 详情页初始状态 ----------
const storage = createMemoryStorage()
const detailVm = new BankDetailViewModel({ storage })
const loaded = detailVm.load(SUBJECT_ID)
const subjectQuiz = catalog.getSubjectQuiz(SUBJECT_ID)
const subjectDetail = catalog.getSubjectDetail(SUBJECT_ID)

assert('详情页 - 加载成功', !!loaded && !!loaded.data, 'detail 为空')
assert('详情页 - 默认顺序练习', loaded.data.mode === 'order', loaded.data.mode)
assert('详情页 - 默认非背题模式', loaded.data.isViewMode === false, String(loaded.data.isViewMode))
assert('详情页 - 抽屉默认关闭', loaded.data.configSheetVisible === false)
assert('详情页 - 默认停在科目而非「最近在刷」',
  loaded.data.railMode === 'subject',
  loaded.data.railMode)

// ---------- 章节列表 ----------
assert('章节列表 - 一章一行',
  loaded.data.rows.length === subjectDetail.banks.length,
  `${loaded.data.rows.length} vs ${subjectDetail.banks.length}`)
assert('章节列表 - 标题带章节序号',
  loaded.data.rows[0].title === `第一章：${subjectDetail.banks[0].name}`,
  loaded.data.rows[0].title)
assert('章节列表 - 未做过时右侧显示总题量',
  loaded.data.rows[0].metaText === `${subjectDetail.banks[0].questionCount} 题`,
  loaded.data.rows[0].metaText)
assert('章节列表 - 统计卡给整科口径',
  loaded.data.stats.total === subjectDetail.questionCount,
  String(loaded.data.stats.total))

// 进度落盘后，章节行与统计卡一起跟着变
const bankQuestions = catalog.getBankQuiz(SUBJECT_ID, FIRST_BANK_ID).questions
const progressStorage = createMemoryStorage({
  qandaProgress: {
    [FIRST_BANK_ID]: {
      total: bankQuestions.length,
      answers: { [bankQuestions[0].id]: 1, [bankQuestions[1].id]: 0 },
      updatedAt: 1758000000000
    }
  }
})
const progressData = new BankDetailViewModel({ storage: progressStorage }).load(SUBJECT_ID).data

assert('章节列表 - 有进度时右侧显示 已做/总数',
  progressData.rows[0].metaText === `2/${bankQuestions.length}`,
  progressData.rows[0].metaText)
assert('章节列表 - 统计卡同步已做数', progressData.stats.answered === 2, String(progressData.stats.answered))
assert('章节列表 - 行上有进度百分比', progressData.rows[0].progressPercent > 0)

// ---------- 最近在刷 ----------
const recentData = new BankDetailViewModel({ storage: progressStorage }).enterRecent()
assert('最近在刷 - 走最近练习记录', recentData.data.subjectId === SUBJECT_ID, recentData.data.subjectId)
assert('最近在刷 - 左栏切到最近态', recentData.data.railMode === 'recent', recentData.data.railMode)
assert('最近在刷 - 记住科目名', recentData.data.recentSubjectName === subjectDetail.name,
  recentData.data.recentSubjectName)
assert('最近在刷 - 没有任何练习记录时回落到第一个科目',
  !!new BankDetailViewModel({ storage: createMemoryStorage() }).enterRecent().data.subject,
  '空记录时崩了')

// ---------- 抽屉：切参数不跳转 ----------
const sheetVm = new BankDetailViewModel({ storage })
sheetVm.load(SUBJECT_ID)
const opened = sheetVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)

assert('抽屉 - 打开后可见', opened.data.configSheetVisible === true)
assert('抽屉 - 副标题是 章节名 + 题量',
  opened.data.configSubtitle === `第一章：${subjectDetail.banks[0].name} · ${bankQuestions.length} 题`,
  opened.data.configSubtitle)
assert('抽屉 - 默认不限时', opened.data.sheetTimed === false)

const modeSwitched = sheetVm.setSheetMode('view')
assert('抽屉 - 切模式不产生跳转命令',
  !modeSwitched.command,
  JSON.stringify(modeSwitched.command))
assert('抽屉 - 切背题同步 isViewMode',
  modeSwitched.data.isViewMode === true && modeSwitched.data.mode === 'view',
  JSON.stringify({ mode: modeSwitched.data.mode, isViewMode: modeSwitched.data.isViewMode }))
assert('抽屉 - 背题时顺序不可用', modeSwitched.data.sheetOrderDisabled === true)
assert('抽屉 - 按钮文案随模式变', modeSwitched.data.sheetStartText === '开始背题',
  modeSwitched.data.sheetStartText)

const testSwitched = sheetVm.setSheetMode('test')
assert('抽屉 - 选模拟考自动开限时',
  testSwitched.data.sheetTimed === true,
  JSON.stringify({ timed: testSwitched.data.sheetTimed }))
assert('抽屉 - 模拟考按钮文案', testSwitched.data.sheetStartText === '开始测试',
  testSwitched.data.sheetStartText)

// ---------- 开始答题：章节 + 顺序 ----------
sheetVm.setSheetMode('practice')
sheetVm.setSheetOrder('order')
sheetVm.setSheetTimed(false)

const bankResult = sheetVm.confirmConfig(opened.data)
const bankQuery = parseQuery(bankResult.command.payload.url)

assert('章节练习 - 带上科目与章节', bankQuery.subjectId === SUBJECT_ID && bankQuery.bankId === FIRST_BANK_ID,
  JSON.stringify(bankQuery))
assert('章节练习 - 不整科取卷', !bankQuery.scope, JSON.stringify(bankQuery))
assert('章节练习 - 不限时不带时长', !bankQuery.duration, JSON.stringify(bankQuery))
assert('章节练习 - 顺序模式', bankQuery.mode === 'order', bankQuery.mode)

const bankVm = openPractice(bankQuery)
assert('章节练习 - 题量等于该章题数',
  bankVm.session.state.total === bankQuestions.length,
  `${bankVm.session.state.total} vs ${bankQuestions.length}`)
assert('章节练习 - 顺序模式保持原序',
  questionIds(bankVm.session) === bankQuestions.map((q) => q.id).join(','),
  '题序被改动')
assert('章节练习 - 不进倒计时', bankVm.session.getViewData().isTestMode === false)

// ---------- 开始答题：随机 ----------
const randomOpened = sheetVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)
sheetVm.setSheetOrder('random')
const randomQuery = parseQuery(sheetVm.confirmConfig(randomOpened.data).command.payload.url)
const randomVm = openPractice(randomQuery)

assert('章节练习 - 随机模式标记为 practice', randomQuery.mode === 'practice', randomQuery.mode)
assert('章节练习 - 随机模式题序被打散',
  questionIds(randomVm.session) !== bankQuestions.map((q) => q.id).join(','),
  '题序与题库原序完全一致')

// ---------- 开始答题：背题 ----------
const viewOpened = sheetVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)
sheetVm.setSheetMode('view')
const viewQuery = parseQuery(sheetVm.confirmConfig(viewOpened.data).command.payload.url)
const viewVm = openPractice(viewQuery)

assert('背题 - 模式为 view', viewQuery.mode === 'view', viewQuery.mode)
assert('背题 - 保持题库原顺序',
  questionIds(viewVm.session) === bankQuestions.map((q) => q.id).join(','),
  '题序被改动')
assert('背题 - 不判分', viewVm.session.getViewData().isViewMode === true)
assert('背题 - 即使开着限时也不带时长', !viewQuery.duration, JSON.stringify(viewQuery))

// ---------- 模拟考 ----------
const testOpened = sheetVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)
sheetVm.setSheetMode('test')
sheetVm.selectDuration(15)
const testQuery = parseQuery(sheetVm.confirmConfig(testOpened.data).command.payload.url)
const testVm = openPractice(testQuery)

assert('模拟考 - 进入测试模式', testQuery.mode === 'test', testQuery.mode)
assert('模拟考 - 带上时长', testQuery.duration === '15', String(testQuery.duration))
assert('模拟考 - 开启倒计时', testVm.session.getViewData().isTestMode === true)
assert('模拟考 - 题量等于该章题数', testVm.session.state.total === bankQuestions.length,
  String(testVm.session.state.total))

// ---------- 整科练习（统计卡入口） ----------
const subjectOpened = sheetVm.openSubjectConfig(SUBJECT_ID)
sheetVm.setSheetMode('practice')
sheetVm.setSheetOrder('order')
sheetVm.setSheetTimed(false)

const subjectQuery = parseQuery(sheetVm.confirmConfig(subjectOpened.data).command.payload.url)
const subjectVm = openPractice(subjectQuery)

assert('整科练习 - 走整科范围', subjectQuery.scope === 'subject', JSON.stringify(subjectQuery))
assert('整科练习 - 不限定题量', !subjectQuery.count, JSON.stringify(subjectQuery))
assert('整科练习 - 题量等于科目总题数',
  subjectVm.session.state.total === subjectQuiz.questions.length,
  `${subjectVm.session.state.total} vs ${subjectQuiz.questions.length}`)
assert('整科练习 - 不进入倒计时', subjectVm.session.getViewData().isTestMode === false)

// ---------- 只答错题 ----------
const wrongStorage = createMemoryStorage({
  qandaWrongBook: {
    [bankQuestions[0].id]: { wrongCount: 1, rightCount: 0, streak: 0, updatedAt: 1 },
    [bankQuestions[1].id]: { wrongCount: 1, rightCount: 0, streak: 0, updatedAt: 2 },
    // 已达攻克阈值：不该计入待复习
    [bankQuestions[2].id]: { wrongCount: 1, rightCount: 2, streak: 2, updatedAt: 3 }
  }
})
const wrongVm = new BankDetailViewModel({ storage: wrongStorage })
wrongVm.load(SUBJECT_ID)
const wrongOpened = wrongVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)

assert('只答错题 - 抽屉里给出本章错题数', wrongOpened.data.sheetWrongCount === 2,
  String(wrongOpened.data.sheetWrongCount))

wrongVm.setSheetOnlyWrong(true)
const onlyWrongQuery = parseQuery(wrongVm.confirmConfig(wrongOpened.data).command.payload.url)

assert('只答错题 - 走 ids 取卷', !!onlyWrongQuery.ids, JSON.stringify(onlyWrongQuery))
assert('只答错题 - 只带待复习的题',
  decodeList(onlyWrongQuery.ids).length === 2 &&
  decodeList(onlyWrongQuery.ids).indexOf(bankQuestions[2].id) < 0,
  decodeList(onlyWrongQuery.ids).join(','))

const onlyWrongVm = openPractice(onlyWrongQuery)
assert('只答错题 - 答题页题量正确', onlyWrongVm.session.state.total === 2,
  String(onlyWrongVm.session.state.total))

// 整科 + 只答错题：答题页先判断 scope==='subject'，所以这里绝不能带 scope=subject
const subjectWrongOpened = wrongVm.openSubjectConfig(SUBJECT_ID)
wrongVm.setSheetOnlyWrong(true)
const subjectWrongQuery = parseQuery(wrongVm.confirmConfig(subjectWrongOpened.data).command.payload.url)

assert('只答错题 - 整科时不能带 scope=subject',
  subjectWrongQuery.scope !== 'subject' && !!subjectWrongQuery.ids,
  JSON.stringify(subjectWrongQuery))

// 这一章没有错题时开关不生效，但要给出提示（不能点了没反应）
const emptyWrongVm = new BankDetailViewModel({ storage })
emptyWrongVm.load(SUBJECT_ID)
const emptySheet = emptyWrongVm.openBankConfig(SUBJECT_ID, FIRST_BANK_ID)
const rejected = emptyWrongVm.setSheetOnlyWrong(true)

assert('只答错题 - 无错题时开关不生效',
  rejected.data.sheetOnlyWrong === false,
  String(rejected.data.sheetOnlyWrong))
assert('只答错题 - 无错题时给出提示',
  rejected.command && rejected.command.type === 'toast',
  JSON.stringify(rejected.command))

// ---------- 抽屉其余交互 ----------
assert('抽屉 - 允许选择合法时长',
  sheetVm.selectDuration(5) !== null && sheetVm.selectDuration(5).data.sheetDuration === 5)
assert('抽屉 - 拒绝非法时长',
  sheetVm.selectDuration(0) === null && sheetVm.selectDuration(-1) === null)
assert('抽屉 - 可关闭', sheetVm.closeConfig().data.configSheetVisible === false)
assert('抽屉 - 关闭后清空目标',
  sheetVm.confirmConfig({ subjectId: SUBJECT_ID }).command.payload.url.indexOf('bankId') < 0,
  '关闭后仍按上次章节取卷')

// ---------- 搜索 ----------
const searchVm = new BankDetailViewModel({ storage })
searchVm.load(SUBJECT_ID)
const searched = searchVm.updateSearch('语言')

assert('搜索 - 命中章节', searched.data.searchResults.length >= 1, '没搜到')
assert('搜索 - 结果带科目与章节标题',
  searched.data.searchResults[0].subjectName === subjectDetail.name &&
  searched.data.searchResults[0].chapterTitle.indexOf('章') > 0,
  JSON.stringify(searched.data.searchResults[0]))
assert('搜索 - 空关键词退出搜索态',
  searchVm.updateSearch('   ').data.searchActive === false)
assert('搜索 - 无命中时给空态文案',
  searchVm.updateSearch('不存在的章节名xyz').data.searchEmptyText.indexOf('没有匹配') >= 0)
assert('搜索 - 关键词超长被截断',
  searchVm.updateSearch('啊'.repeat(40)).data.searchKeyword.length === 20,
  searchVm.updateSearch('啊'.repeat(40)).data.searchKeyword.length)

// 搜别的科目也要能搜到（索引是跨科目的）
const crossSubject = searchVm.updateSearch('英语')
assert('搜索 - 跨科目可见',
  crossSubject.data.searchResults.some((item) => item.subjectId !== SUBJECT_ID),
  JSON.stringify(crossSubject.data.searchResults.slice(0, 2)))

// ---------- 筛选 ----------
const partialStorage = createMemoryStorage({
  qandaProgress: {
    [FIRST_BANK_ID]: {
      total: bankQuestions.length,
      answers: bankQuestions.reduce((acc, question) => {
        acc[question.id] = 1
        return acc
      }, {}),
      updatedAt: 1758000000000
    }
  }
})
const filterVm = new BankDetailViewModel({ storage: partialStorage })
const filterData = filterVm.load(SUBJECT_ID).data
const filtered = filterVm.toggleFilter().data

assert('筛选 - 打开后只剩未刷完的章节',
  filtered.rows.length === filterData.rows.length - 1,
  `${filtered.rows.length} vs ${filterData.rows.length}`)
assert('筛选 - 统计卡不受筛选影响',
  filterVm.load(SUBJECT_ID).data.stats.total === subjectDetail.questionCount,
  '统计卡被筛选改掉了')
assert('筛选 - 隐藏条数与空态文案都要给出',
  filtered.hiddenRowCount >= 1 && filtered.listEmptyText === '没有符合条件的章节',
  JSON.stringify({ hidden: filtered.hiddenRowCount, text: filtered.listEmptyText }))

// ---------- 入口归属：错题本 / 收藏本已挪到复盘页，题库页只管选章节 ----------
const fs = require('fs')

// ---------- 入口归属：只应在题库页，不得回流到我的页 ----------
const bankWxml = fs.readFileSync(path.join(MINIPROGRAM, 'page/bank-detail/index.wxml'), 'utf8')
const myWxml = fs.readFileSync(path.join(MINIPROGRAM, 'page/my/index.wxml'), 'utf8')
const myJs = fs.readFileSync(path.join(MINIPROGRAM, 'page/my/index.js'), 'utf8')

const statsWxml = fs.readFileSync(path.join(MINIPROGRAM, 'page/stats/index.wxml'), 'utf8')
const statsVmSource = fs.readFileSync(path.join(MINIPROGRAM, 'viewmodels/stats-viewmodel.js'), 'utf8')

assert('入口归属 - 题库页不再绑定错题本 / 收藏入口',
  bankWxml.indexOf('handleWrongBookTap') < 0 && bankWxml.indexOf('handleFavoriteTap') < 0,
  '题库页还留着错题本 / 收藏入口')
assert('入口归属 - 复盘页展示错题本 / 收藏本两张卡',
  statsWxml.indexOf('entries.wrong') >= 0 && statsWxml.indexOf('entries.favorite') >= 0,
  '复盘页缺少入口卡')
assert('入口归属 - 入口卡带 type 参数进对应页面',
  statsVmSource.indexOf('type=wrong') >= 0 && statsVmSource.indexOf('type=favorite') >= 0,
  '入口 URL 没带 type')

// 点了没反应最常见的原因就是路由没登记：url 写对了但 app.json 里没这个页面
{
  const appJson = JSON.parse(fs.readFileSync(path.join(MINIPROGRAM, 'app.json'), 'utf8'))
  const entries = require(path.join(MINIPROGRAM, 'viewmodels/stats-viewmodel.js'))
  const target = '/page/wrong-book/index'
  const registered = appJson.pages.some((page) => `/${page}` === target)

  assert('入口归属 - 错题本 / 收藏本页面已在 app.json 登记', registered, target)
  assert('入口归属 - 入口卡 URL 指向已登记页面',
    statsVmSource.indexOf(target) >= 0, '入口 URL 与路由不一致')
  assert('入口归属 - 错题本页把 options 交给 ViewModel 决定类型',
    fs.readFileSync(path.join(MINIPROGRAM, 'page/wrong-book/index.js'), 'utf8')
      .indexOf('this.viewModel.load(options)') >= 0,
    '页面没把 type 参数透传下去')
  assert('入口归属 - 入口模块可被页面直接引用', !!entries.StatsViewModel, '导出名不对')
}
assert('入口归属 - 我的页不再残留错题本处理函数',
  myWxml.indexOf('handleOpenWrongBook') < 0 && myJs.indexOf('handleOpenWrongBook') < 0,
  '我的页仍在引用 handleOpenWrongBook')
assert('入口归属 - 我的页不再有「学习工具」分组',
  myWxml.indexOf('学习工具') < 0,
  '「学习工具」分组仍留在我的页')

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
