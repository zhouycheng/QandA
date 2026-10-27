/**
 * 首页（原型 552:1410）结构与交互 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/home-prototype.check.js
 *
 * 为什么单独成脚本：
 *   home-dashboard.check.js 只验 ViewModel 的统计口径，data-card / metric-grid 那套旧卡片
 *   被原型替换后它依然全绿 —— 它不读 WXML。这里直接对着页面源码断言结构，
 *   防止「改了 ViewModel 忘了改页面」或「改了页面又退回旧结构」。
 *
 * 三块内容：
 *   1. 页面结构：蓝头 / 搜索 / 圆钮 / 倒计时卡 / 四宫格 / 两个弹层
 *   2. 交互接线：bindtap 与 index.js 的处理函数一一对应，参数通过 data-* 传递
 *   3. 倒计时与搜索的纯计算：日期边界、打分排序、空态
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const read = (relative) => fs.readFileSync(path.join(MINIPROGRAM, relative), 'utf8')

const homeWxml = read('page/subject-list/index.wxml')
const homeWxss = read('page/subject-list/index.wxss')
const homeJs = read('page/subject-list/index.js')

const examCountdown = require(path.join(MINIPROGRAM, 'utils/exam-countdown.js'))
const questionSearch = require(path.join(MINIPROGRAM, 'utils/question-search.js'))
const { SubjectListViewModel, STUDY_ENTRIES } = require(path.join(MINIPROGRAM, 'viewmodels/subject-list-viewmodel.js'))

const results = []

function assert(name, condition, detail) {
  results.push({ name, passed: !!condition, detail: condition ? '' : detail || '' })
}

/** 从 WXML 里抽出所有事件绑定的处理函数名（含 bindtap / bindinput / bindconfirm / bind:close） */
function collectBindHandlers(source) {
  const names = new Set()
  const pattern = /\b(?:bind|catch):?[a-zA-Z]+\s*=\s*"([A-Za-z0-9_]+)"/g
  let match = pattern.exec(source)

  while (match) {
    names.add(match[1])
    match = pattern.exec(source)
  }

  return names
}

/** WXML 里只统计 bindtap，用于校验反馈属性；half 属性按元素判断 */
function collectTapTags(source) {
  return source.match(/<view[^>]*bindtap="[^"]*"[^>]*>/g) || []
}

/** 从 JPEG 头里读宽高（SOF0~SOF3 段），避免为了验比例引入图像库 */
function readJpegSize(filePath) {
  const buffer = fs.readFileSync(filePath)
  let offset = 2

  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]

    // SOF0~SOF3 承载尺寸；0xC4/0xC8/0xCC 是别的段，要排除
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }

    const length = buffer.readUInt16BE(offset + 2)

    if (length < 2) {
      return null
    }

    offset += 2 + length
  }

  return null
}

// ---------- 一、页面结构 ----------

function checkStructure() {
  assert('结构 - 品牌区显示 QandA', /class="hero-brand"[^>]*>QandA</.test(homeWxml))
  assert('结构 - 头部含搜索框', homeWxml.indexOf('class="search-box"') >= 0)
  assert('结构 - 搜索框为真实 input', /<input[\s\S]{0,400}?class="search-input"/.test(homeWxml))
  // 右上角小喇叭是「公告」入口，不是每日一句——每日一句已挪进蓝色倒计时卡
  assert('结构 - 头部圆钮是公告入口', homeWxml.indexOf('class="hero-notice-btn"') >= 0)
  assert('结构 - 公告圆钮绑定公告处理函数', homeWxml.indexOf('handleAnnouncementTap') >= 0)
  assert('结构 - 不再有「每日一句」圆钮', homeWxml.indexOf('hero-quote-btn') < 0)

  // 倒计时卡四种状态互斥，顺序必须是「已结束 → 就在今天 → 还有 N 天 → 未设置」。
  // 把「就在今天」并进「还有 N 天」会渲染成「距离 X 考试还有 就是今天 天」。
  assert('结构 - 倒计时卡存在', homeWxml.indexOf('class="exam-card"') >= 0)
  assert('结构 - 分支一：已结束',
    /wx:if="\{\{exam\.configured && exam\.isPast\}\}"/.test(homeWxml))
  assert('结构 - 分支二：考试当天',
    /wx:elif="\{\{exam\.configured && exam\.isExamDay\}\}"/.test(homeWxml))
  assert('结构 - 分支三：还有 N 天', /wx:elif="\{\{exam\.configured\}\}"/.test(homeWxml))
  assert('结构 - 分支四：未设置', /wx:else/.test(homeWxml) && homeWxml.indexOf('exam-main-empty') >= 0)
  assert('结构 - 天数独立成块（字号要放大）', homeWxml.indexOf('class="exam-days"') >= 0)
  assert('结构 - 「就在今天」不套用天数的大号字',
    homeWxml.indexOf('exam-days-today') >= 0 && /\.exam-days-today\s*\{[^}]*font-size/.test(homeWxss))
  assert('结构 - 已设置时底部是「修改」而非重复的状态字',
    /\{\{exam\.configured \? '修改' : exam\.statusText\}\}/.test(homeWxml))

  assert('结构 - 出现「我的学习空间」标题', homeWxml.indexOf('我的学习空间') >= 0)
  assert('结构 - 四宫格按 entries 渲染', /wx:for="\{\{entries\}\}"/.test(homeWxml))
  assert('结构 - 四宫格有计数徽标', homeWxml.indexOf('class="entry-badge"') >= 0)

  assert('结构 - 搜索结果面板存在', homeWxml.indexOf('class="search-panel"') >= 0)
  assert('结构 - 搜索空态区分「已搜无果」与「未搜索」',
    homeWxml.indexOf('searchSearched && searchResultCount === 0') >= 0 &&
    homeWxml.indexOf('!searchSearched') >= 0)
  assert('结构 - 公告复用 bottom-sheet', /<bottom-sheet[\s\S]{0,200}?announcementSheetVisible/.test(homeWxml))
  assert('结构 - 保留 route-loading 遮罩', homeWxml.indexOf('route-loading') >= 0)

  // 公告必须是居中弹窗：底部升起的形态会被自定义 tabBar 压住（用户截图投诉过）
  assert('公告 - 用居中的弹窗形态', /announcementSheetVisible[\s\S]{0,200}?placement="center"/.test(homeWxml),
    '底部升起会被 tabBar 压住')
  assert('公告 - 弹窗顶部带喇叭徽标', homeWxml.indexOf('notice-badge') >= 0)

  // 小喇叭：大号 + 入场晃动
  assert('公告 - 图标是喇叭且放大到 52rpx',
    /\.hero-notice-icon\s*\{[^}]*width:\s*52rpx/.test(homeWxss))
  assert('公告 - 图标带晃动动画', /\.hero-notice-icon\s*\{[^}]*animation:\s*notice-shake/.test(homeWxss))
  assert('公告 - 定义了 notice-shake 关键帧', /@keyframes\s+notice-shake/.test(homeWxss))

  // 顶部导航栏必须和头部同色，否则会出现用户截图里那条白色带
  const homeJson = JSON.parse(fs.readFileSync(path.join(MINIPROGRAM, 'page/subject-list/index.json'), 'utf8'))

  assert('顶部 - 导航栏背景改为品牌蓝', String(homeJson.navigationBarBackgroundColor).toLowerCase() === '#4a7bfb',
    homeJson.navigationBarBackgroundColor)
  assert('顶部 - 导航栏文字改为白色', homeJson.navigationBarTextStyle === 'white')
  assert('顶部 - 下拉刷新背景也是蓝的（否则下拉时闪白）',
    String(homeJson.backgroundColor).toLowerCase() === '#4a7bfb')
  // 头部渐变必须从同一个色开始且是垂直方向，否则和导航栏接缝处有色差
  assert('顶部 - 头部渐变与导航栏同色衔接',
    /\.hero\s*\{[^}]*linear-gradient\(180deg,\s*#4a7bfb/.test(homeWxss))

  // ---------- 蓝色倒计时卡：配图 + 金句 ----------
  assert('卡片 - 封面图由时段决定（早/中/晚三张）',
    /<image class="exam-cover" src="\{\{home\.coverImage\}\}"/.test(homeWxml))
  assert('卡片 - 封面图使用 aspectFill（避免拉伸变形）',
    /exam-cover"[\s\S]{0,120}?mode="aspectFill"/.test(homeWxml))
  assert('卡片 - 有压暗层（否则白字压在插画上读不清）',
    homeWxml.indexOf('exam-veil') >= 0)
  assert('卡片 - 内容包在 exam-body 里（压在图片之上）',
    /class="exam-body"/.test(homeWxml))
  assert('卡片 - 每日一句显示在卡内', /class="exam-quote">\{\{home\.quote\}\}/.test(homeWxml))
  assert('卡片 - 不再把「考试」二字拼在名称后面',
    homeWxml.indexOf('examName}} 考试还有') < 0,
    '名称常自带「考试」，拼上去会变成「距离 期末考试 考试还有」')

  // ---------- 早 / 中 / 晚三张封面 ----------
  const { COVER_BY_DAY_PART, getDayPart } = require(path.join(MINIPROGRAM, 'utils/home-content.js'))
  const dayParts = ['morning', 'noon', 'evening']

  assert('封面 - 三个时段都有映射', dayParts.every((key) => !!COVER_BY_DAY_PART[key]),
    JSON.stringify(COVER_BY_DAY_PART))
  assert('封面 - 三张路径互不相同',
    new Set(dayParts.map((key) => COVER_BY_DAY_PART[key])).size === 3)

  // 时段边界必须首尾相接、不留缝：漏一小时就会落到别的图
  const hourToPart = (hour) => getDayPart(new Date(2026, 9, 27, hour, 30, 0).getTime())

  assert('封面 - 05~11 点用清晨图', [5, 7, 10].every((h) => hourToPart(h) === 'morning'),
    [5, 7, 10].map((h) => `${h}→${hourToPart(h)}`).join(' '))
  assert('封面 - 11~18 点用正午图', [11, 13, 17].every((h) => hourToPart(h) === 'noon'),
    [11, 13, 17].map((h) => `${h}→${hourToPart(h)}`).join(' '))
  assert('封面 - 18~次日 5 点用黄昏图', [18, 21, 23, 0, 3, 4].every((h) => hourToPart(h) === 'evening'),
    [18, 21, 23, 0, 3, 4].map((h) => `${h}→${hourToPart(h)}`).join(' '))

  // 问候语与封面图必须同时段切换，不能「说晚上好、却显示正午图」
  const { buildHomeContent } = require(path.join(MINIPROGRAM, 'utils/home-content.js'))
  const contentPairs = [
    { hour: 7, part: 'morning', greeting: '早上好' },
    { hour: 12, part: 'noon', greeting: '中午好' },
    { hour: 15, part: 'noon', greeting: '下午好' },
    { hour: 20, part: 'evening', greeting: '晚上好' },
    { hour: 2, part: 'evening', greeting: '夜深了' }
  ]

  contentPairs.forEach((item) => {
    const content = buildHomeContent({}, new Date(2026, 9, 27, item.hour, 0, 0).getTime())

    assert(`封面 - ${item.hour} 点问候语与封面同为「${item.part}」`,
      content.greeting === item.greeting && content.dayPart === item.part,
      `${content.greeting} / ${content.dayPart}`)
  })

  // 三张图必须真实存在、体积可控、比例与卡片一致
  const sheetPadding = homeWxss.match(/\.sheet\s*\{[^}]*padding:\s*(\d+)rpx\s+(\d+)rpx/)
  const cardHeight = Number((homeWxss.match(/\.exam-card\s*\{[^}]*?height:\s*(\d+)rpx/) || [])[1] || 0)
  const cardWidth = sheetPadding ? 750 - Number(sheetPadding[2]) * 2 : 0
  let coverTotal = 0

  dayParts.forEach((key) => {
    const coverPath = path.join(MINIPROGRAM, COVER_BY_DAY_PART[key].replace(/^\//, ''))

    assert(`封面 - ${key} 图不存在`, fs.existsSync(coverPath), coverPath)

    if (!fs.existsSync(coverPath)) {
      return
    }

    const coverSize = fs.statSync(coverPath).size
    coverTotal += coverSize

    // 主包只剩约 300KB 余量，三张合计必须压住
    assert(`封面 - ${key} 图不超过 90KB`, coverSize <= 90 * 1024, `实际 ${Math.round(coverSize / 1024)}KB`)

    // 比例必须和卡片完全一致：不一致时 aspectFill 会裁边，右边缘的时钟会被切掉半个
    const size = readJpegSize(coverPath)

    assert(`封面 - ${key} 图可读出尺寸`, !!size)

    if (size && cardHeight && cardWidth) {
      const imageRatio = size.width / size.height
      const cardRatio = cardWidth / cardHeight

      assert(`封面 - ${key} 图比例与卡片一致（否则 aspectFill 会裁边）`,
        Math.abs(imageRatio - cardRatio) < 0.02,
        `图 ${imageRatio.toFixed(3)} vs 卡 ${cardRatio.toFixed(3)}（图片 ${size.width}x${size.height}，卡片 ${cardWidth}x${cardHeight}rpx）`)
    }
  })

  // 主包 2MB 上限、当前约 1.8MB：三张写实插画合计必须压在 230KB 内
  assert('封面 - 三张合计不超过 230KB', coverTotal <= 230 * 1024, `实际 ${Math.round(coverTotal / 1024)}KB`)

  // 旧单张封面必须退场：留着会让人误以为可以改回去
  assert('封面 - 旧的单张 exam-cover.jpg 已移除',
    !fs.existsSync(path.join(MINIPROGRAM, 'assets/home/exam-cover.jpg')))

  // 旧原型（插画横幅 + 学习数据卡 + 公告条）必须彻底退场，避免两套卡片并存
  const legacy = ['banner-study.png', 'data-card', 'metric-grid', 'tip-bar', 'continue-card']
  const remained = legacy.filter((token) => homeWxml.indexOf(token) >= 0)

  assert('结构 - 旧版首页卡片已移除', remained.length === 0, `仍存在：${remained.join(', ')}`)

  assert('结构 - 四宫格顺序与原型一致',
    STUDY_ENTRIES.map((item) => item.key).join(',') === 'recent,mock,wrong,favorite',
    STUDY_ENTRIES.map((item) => item.key).join(','))
  assert('结构 - 四个入口都有中文标签',
    STUDY_ENTRIES.every((item) => item.label && item.label.length >= 2))

  // 用户反馈过「配色风格太统一了，不容易识别」——四个图标必须各是一种颜色。
  // 只要有一条规则漏了 background-image（或都指向同一张图），这里就会红。
  const iconImages = STUDY_ENTRIES.map((item) => {
    const pattern = new RegExp(`\\.entry-icon-${item.key}\\s*\\{[^}]*?background-image:\\s*url\\("([^"]+)"\\)`)
    const matched = homeWxss.match(pattern)

    return matched ? matched[1] : ''
  })

  assert('图标 - 四个入口都配了图标', iconImages.every(Boolean),
    `缺失：${STUDY_ENTRIES.filter((item, i) => !iconImages[i]).map((item) => item.key).join(', ')}`)
  assert('图标 - 四个图标互不相同（否则又变成「太统一」）',
    new Set(iconImages).size === 4, `实际只有 ${new Set(iconImages).size} 种`)
  assert('图标 - 全部内联为 SVG（WXSS 不支持本地图片路径）',
    iconImages.every((uri) => uri.indexOf('data:image/svg+xml;base64,') === 0))
  assert('图标 - 不再依赖 ::after 叠字形', homeWxss.indexOf('.entry-icon::after') < 0)
}

// ---------- 二、交互接线 ----------

function checkWiring() {
  const handlers = collectBindHandlers(homeWxml)
  const missing = [...handlers].filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(homeJs))

  assert('接线 - WXML 事件都有对应处理函数', missing.length === 0,
    `缺少：${missing.join(', ')}（共 ${handlers.size} 个事件）`)

  const expected = [
    'handleExamTap',
    'handleEntryTap',
    'handleOpenSearch',
    'handleSearchInput',
    'handleSearchResultTap',
    'handleSearchClose',
    'handleAnnouncementTap',
    'handleAnnouncementClose',
    'handleAnnouncementAction'
  ]
  const absent = expected.filter((name) => handlers.has(name) === false)

  assert('接线 - 首页全部交互都在 WXML 上挂载', absent.length === 0, `未挂载：${absent.join(', ')}`)

  assert('接线 - 四宫格通过 data-key 传参', /data-key="\{\{item\.key\}\}"/.test(homeWxml))
  assert('接线 - 搜索结果通过 data-id 传参', /data-id="\{\{item\.questionId\}\}"/.test(homeWxml))
  assert('接线 - 搜索用 bindinput 边打边搜', /bindinput="handleSearchInput"/.test(homeWxml))
  assert('接线 - 页面统一经 applyViewModelResult 收口',
    (homeJs.match(/applyViewModelResult\(/g) || []).length >= 10,
    `实际 ${(homeJs.match(/applyViewModelResult\(/g) || []).length} 处`)

  // 交互反馈：可点元素必须带 hover-class，且不能是默认 50ms 的 hover-start-time。
  // 遮罩（.search-mask）豁免：它铺满整屏，加按压态会让「点空白处关闭」时整屏闪一下。
  const tappableBlocks = collectTapTags(homeWxml)
  const noHover = tappableBlocks.filter((tag) => tag.indexOf('hover-class') < 0 && tag.indexOf('search-mask') < 0)

  assert('反馈 - 所有可点 view 都有 hover-class（遮罩除外）', noHover.length === 0,
    `${noHover.length} 处缺失：${noHover.slice(0, 2).map((t) => t.slice(0, 60)).join(' | ')}`)
  assert('反馈 - hover-start-time 统一为 0（默认 50ms 会吞掉快按）',
    /bindtap="[^"]*"[\s\S]{0,200}?hover-start-time="0"/.test(homeWxml))
  assert('反馈 - 大色块只改 opacity，不写 transform',
    /\.exam-card-hover\s*\{[^}]*opacity/.test(homeWxss) && /\.exam-card-hover\s*\{[^}]*transform/.test(homeWxss) === false)
}

// ---------- 三、倒计时纯计算 ----------

function checkExamCountdown() {
  const at = (y, m, d) => new Date(y, m - 1, d, 10, 0, 0, 0).getTime()

  assert('倒计时 - 未设置时返回引导态',
    examCountdown.buildExamCountdown(null, at(2026, 12, 1)).configured === false)
  assert('倒计时 - 未设置时状态文案为「去设置」',
    examCountdown.buildExamCountdown({}, at(2026, 12, 1)).statusText === '去设置')

  const tenDays = examCountdown.buildExamCountdown(
    { examName: '研究生入学考试', examDate: '2026-12-10' }, at(2026, 11, 30))
  assert('倒计时 - 剩余天数按日历天算（跨月）', tenDays.daysLeft === 10, `实际 ${tenDays.daysLeft}`)
  assert('倒计时 - 天数与状态文案分离', tenDays.dayText === '10' && tenDays.statusText === '天')

  // 关键回归：晚上 23:59 与次日 00:01 不能对「明天考试」给出不同结论
  const lateNight = examCountdown.buildExamCountdown(
    { examName: '期末考试', examDate: '2026-12-11' },
    new Date(2026, 11, 10, 23, 59, 0, 0).getTime())
  const earlyMorning = examCountdown.buildExamCountdown(
    { examName: '期末考试', examDate: '2026-12-11' },
    new Date(2026, 11, 11, 0, 1, 0, 0).getTime())

  assert('倒计时 - 23:59 时「明天考试」仍是 1 天', lateNight.daysLeft === 1, `实际 ${lateNight.daysLeft}`)
  assert('倒计时 - 00:01 时「今天考试」变 0 天', earlyMorning.daysLeft === 0, `实际 ${earlyMorning.daysLeft}`)
  assert('倒计时 - 考试当天给出「今天考试」', earlyMorning.isExamDay && earlyMorning.statusText === '今天考试')

  const past = examCountdown.buildExamCountdown(
    { examName: '期末考试', examDate: '2026-12-01' }, at(2026, 12, 10))
  assert('倒计时 - 过期后标记 isPast 且进度归零', past.isPast && past.progressPercent === 0)
  assert('倒计时 - 过期后不显示负数天', past.dayText === '已结束', past.dayText)

  assert('倒计时 - 非法日期视为未设置',
    examCountdown.buildExamCountdown({ examName: 'X', examDate: '2026-02-31' }, at(2026, 1, 1)).configured === false)
  assert('倒计时 - 只有名称没有日期时提示待设置日期',
    examCountdown.buildExamCountdown({ examName: '面试', examDate: '' }, at(2026, 1, 1)).title.indexOf('待设置日期') >= 0)

  assert('倒计时 - 名称超长被截断',
    examCountdown.buildExamCountdown(
      { examName: 'a'.repeat(40), examDate: '2026-12-10' }, at(2026, 11, 1)).examName.length ===
      examCountdown.EXAM_NAME_MAX_LENGTH)

  assert('校验 - 名称为空不通过', examCountdown.validateExamInput('', '2026-12-10', at(2026, 1, 1)).ok === false)
  assert('校验 - 日期早于今天不通过',
    examCountdown.validateExamInput('考试', '2025-12-10', at(2026, 1, 1)).ok === false)
  assert('校验 - 合法输入返回可直接落盘的值',
    examCountdown.validateExamInput(' 考试 ', '2026-12-10', at(2026, 1, 1)).value.examName === '考试')
}

// ---------- 四、搜索纯计算 ----------

function makeIndex(list) {
  const index = {}

  list.forEach((item) => {
    index[item.id] = {
      id: item.id,
      question: { stem: item.stem, options: item.options || [], typeText: '单选题' },
      subjectName: item.subjectName || '语文',
      bankName: item.bankName || '题库一'
    }
  })

  return index
}

function checkSearch() {
  const index = makeIndex([
    { id: 'q1', stem: '行政法规定，公民对行政行为不服可以提起复议。' },
    { id: 'q2', stem: '不涉及行政管理的民事纠纷由法院受理。' },
    { id: 'q3', stem: '行政复议的受理机关是上一级行政机关。' },
    { id: 'q4', stem: '完全无关的题目。', options: [{ text: '政' }, { text: '行' }] }
  ])

  assert('搜索 - 空关键词返回空数组', questionSearch.searchQuestions(index, '   ').length === 0)
  assert('搜索 - 不存在的关键词返回空数组', questionSearch.searchQuestions(index, '量子力学').length === 0)

  // 4 条都命中：q1/q3 题干开头命中（100 分），q2 题干中段命中（67 分），
  // q4 只在选项里散落着「行」「政」两字（拆字兜底 20 分）
  const hits = questionSearch.searchQuestions(index, '行政')
  assert('搜索 - 命中数量正确', hits.length === 4, `实际 ${hits.length}`)
  assert('搜索 - 题干开头命中排最前', ['q1', 'q3'].indexOf(hits[0].questionId) >= 0, hits[0].questionId)
  assert('搜索 - 同分短题干优先（q3 比 q1 短，排第一）', hits[0].questionId === 'q3', hits[0].questionId)
  assert('搜索 - 拆字兜底的结果排在最后', hits[hits.length - 1].questionId === 'q4',
    `最后一条是 ${hits[hits.length - 1].questionId}`)
  assert('搜索 - 结果带来源信息', hits[0].sourceText.indexOf('语文') >= 0)
  assert('搜索 - 关键词超过 40 字被截断',
    questionSearch.normalizeKeyword('一'.repeat(60)).length === questionSearch.MAX_KEYWORD_LENGTH)

  // 短语命中必须优先于「拆字命中」：否则搜「行政」会被选项里散落的两个字挤到后面
  const phraseFirst = questionSearch.searchQuestions(index, '复议')
  assert('搜索 - 短语命中优先于拆字命中', phraseFirst.length === 2, `实际 ${phraseFirst.length}`)
  assert('搜索 - 短题干同分时优先（q3 比 q1 短）', phraseFirst[0].questionId === 'q3', phraseFirst[0].questionId)

  assert('搜索 - 题干只在选项里命中也能搜到',
    questionSearch.searchQuestions(index, '民事').some((item) => item.questionId === 'q2'))
}

// ---------- 五、不因搜索把整卷读崩 ----------

function checkViewModelResilience() {
  // 仓储没有 getQuestionIndex 时（老版本 / 注入的假仓储）搜索必须安全返回空，不能抛错
  const bare = new SubjectListViewModel({ repository: {
    getSubjectSummaries: () => [],
    getProgress: () => ({}),
    getPreferences: () => ({})
  }, storage: null })

  let threw = false
  let result = null

  try {
    result = bare.searchQuestions('行政')
  } catch (error) {
    threw = true
  }

  assert('健壮性 - 无索引时搜索不抛错', threw === false)
  assert('健壮性 - 无索引时返回空结果', result && result.data.searchResultCount === 0)

  const emptyLoaded = bare.load()
  assert('健壮性 - 空题库也能完整渲染首页', emptyLoaded.data.overall.total === 0)
  assert('健壮性 - 空题库的搜索提示不写死数字',
    emptyLoaded.data.searchTotalText.indexOf('0 道题') < 0, emptyLoaded.data.searchTotalText)
}

// ---------- 输出 ----------

checkStructure()
checkWiring()
checkExamCountdown()
checkSearch()
checkViewModelResilience()

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  if (!item.passed) {
    console.log(`FAIL  ${item.name}${item.detail ? ` —— ${item.detail}` : ''}`)
  }
})

console.log(`\n首页原型自检：总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exitCode = 1
}
