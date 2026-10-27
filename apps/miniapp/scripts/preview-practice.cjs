/**
 * 答题页静态预览：跑真实 PracticeViewModel 拿数据，按真实 WXSS 渲染 402x874 画板。
 *   node scripts/preview-practice.cjs
 * 输出 .tmp-preview/practice-preview.png
 *
 * 四态并排，对应设计稿的四个面板：
 *   即时模式·答对 / 即时模式·答错 / 答题卡弹层 / 答题结果
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402
const STAGE_H = 874

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)
}

// ---------- 真实数据 ----------

const { PracticeViewModel } = require(path.join(MP, 'viewmodels/practice-viewmodel.js'))

function createStorage() {
  const store = {}

  return {
    get: (key) => (store[key] === undefined ? '' : store[key]),
    set: (key, value) => {
      store[key] = value
    },
    keys: () => Object.keys(store),
    remove: (key) => {
      delete store[key]
    }
  }
}

/** elapsedMinutes：把开始时刻往前推，让预览里的用时不是 0:00（设计稿是 20:22） */
function createSession(elapsedMinutes) {
  const vm = new PracticeViewModel({ storage: createStorage() })
  vm.load({ subjectId: 'subject-chinese', bankId: 'chinese-ch001', mode: 'practice' })

  if (elapsedMinutes) {
    vm.session.startedAt = Date.now() - elapsedMinutes * 60 * 1000
  }

  return vm
}

// ① 练习模式态：还没作答，选项全露、无解析（设计稿面板 1）
const freshVm = createSession(20)
const freshData = freshVm.session.getViewData()

// ② 即时模式态：故意答错并打开解析，顺带把收藏 / 标记两个 pill 的选中态一起渲染出来
//    注意 getViewData 里的 isCorrectOption 在未作答时一律 false，靠题目自带的 answerKeys 反查
const wrongVm = createSession(20)
const wrongKeys = wrongVm.session.getViewData().currentQuestion.answerKeys || []
const wrongAnswerIndex = wrongVm.session
  .getViewData()
  .currentQuestion.options.findIndex((option) => wrongKeys.indexOf(option.key) < 0)
wrongVm.selectOption(wrongAnswerIndex >= 0 ? wrongAnswerIndex : 0)
wrongVm.session.toggleFavoriteQuestion()
wrongVm.session.toggleMarkQuestion()
const wrongData = wrongVm.session.getViewData()

/** 把整份题库答完；markFirst 给第一题打标记，wrongEvery 每 N 题故意答错一题 */
function answerAll(markFirst, wrongEvery) {
  const vm = createSession(20)

  vm.session.getViewData().questions.forEach((question, index) => {
    const view = vm.session.getViewData().currentQuestion
    const rightIndex = view.options.findIndex((option) => question.answerKeys.indexOf(option.key) >= 0)
    const wrongIndex = view.options.findIndex((option) => question.answerKeys.indexOf(option.key) < 0)
    const shouldWrong = !!wrongEvery && (index + 1) % wrongEvery === 0
    const pick = shouldWrong && wrongIndex >= 0 ? wrongIndex : rightIndex

    vm.selectOption(pick >= 0 ? pick : 0)
    if (markFirst && index === 0) {
      vm.session.toggleMarkQuestion()
    }
    vm.goNext()
  })

  return vm
}

// ④ 答题卡·还有未答：答掉 7 题留 1 题未答，第 1 题打标记
const sheetVm = createSession(20)
const sheetTotal = sheetVm.session.getViewData().total

for (let i = 0; i < Math.min(7, sheetTotal); i += 1) {
  const view = sheetVm.session.getViewData().currentQuestion
  const answerIndex = view.options.findIndex((option) => option.key === (view.answerKeys || [])[0])

  sheetVm.selectOption(answerIndex >= 0 ? answerIndex : 0)
  if (i === 0) {
    sheetVm.session.toggleMarkQuestion()
  }
  sheetVm.goNext()
}

sheetVm.session.jumpToQuestion(6)
const sheetData = sheetVm.session.getViewData()
const sheetItems = sheetVm.session.getOverviewItems(sheetData.answers, 6)

// ⑤ 答题卡·已答完但还有标记（设计稿面板 4）
const markedDoneVm = answerAll(true)
const markedDoneData = markedDoneVm.session.getViewData()
const markedDoneItems = markedDoneVm.session.getOverviewItems(markedDoneData.answers, -1)

// ⑥ 答题卡·已答完且无标记（设计稿面板 5）
const plainDoneVm = answerAll(false)
const plainDoneData = plainDoneVm.session.getViewData()
const plainDoneItems = plainDoneVm.session.getOverviewItems(plainDoneData.answers, -1)

// ⑦ 结果页：全部答完交卷（第一题打标记、每 5 题错一题，让明细网格两种颜色都出现）
const resultVm = answerAll(true, 5)
resultVm.forceSubmit()
const resultData = resultVm.session.getViewData()

// ---------- 渲染 ----------

const PREVIEW_BASE = `
.stage { height: ${STAGE_H}px; display: flex; flex-direction: column; position: relative; }
.stage .page.practice-page { flex: 1; min-height: 0; height: auto; }
/* 弹层的 position:fixed 在预览里要相对画板，否则会跑出 .stage */
.stage .overview { position: absolute; }
/* 答题页是二级页，真机顶部有系统导航栏 + 返回钮，预览里画出来对齐效果 */
.pra-nav { flex: none; height: 91px; position: relative; background: #fff; }
.pra-nav .nav-back { position: absolute; left: 12px; bottom: 12px; font-size: 24px; line-height: 1; color: #141820; font-weight: 300; }
`

function buildCss() {
  const app = read('app.wxss').replace(/^page\s*\{/m, 'body {')
  const page = read('page/practice/index.wxss')
  const sheet = read('components/question-overview-sheet/index.wxss')

  return rpxToPx(`
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; background: #fff; overflow: hidden; }
${app}
${page}
${sheet}
${PREVIEW_BASE}
`)
}

/** 顶部：标题 + 副标题 + 进度条 + 信息行（返回走系统导航栏，页内不再自绘返回钮） */
function head(data, title) {
  return `
  <div class="pra-head">
    <div class="pra-head-text">
      <span class="pra-head-title">${title || data.practiceTitle}</span>
      <span class="pra-head-sub">${data.practiceSubtitle}</span>
    </div>
  </div>
  <div class="pra-progress"><div class="pra-progress-fill" style="width: ${data.progressPercent}%"></div></div>
  <div class="pra-meta">
    <span class="pra-meta-index">${data.currentNumber}/${data.total}</span>
    <span class="pra-meta-type">${data.currentQuestion.typeText}</span>
    <span class="pra-meta-timer">${data.elapsedText}</span>
  </div>`
}

function optionList(data) {
  return data.currentQuestion.options
    .map((option) => `
      <div class="pra-option ${option.selected ? 'is-selected' : ''} ${option.isCorrectOption ? 'is-correct' : ''} ${option.isWrongOption ? 'is-wrong' : ''}">
        <span class="pra-option-key">${option.label}</span>
        <span class="pra-option-text">${option.text}</span>
      </div>`)
    .join('')
}

function analysis(data, explanationOpen) {
  return `
  <div class="pra-analysis">
    <div class="pra-analysis-head">
      <span class="pra-result-tag ${data.isCurrentAnswerCorrect ? 'ok' : 'no'}">${data.isCurrentAnswerCorrect ? '答对啦' : '答错了'}</span>
      <span class="pra-analysis-answer">${data.currentCorrectAnswerText}</span>
    </div>
    <div class="pra-explanation ${explanationOpen ? 'is-open' : ''}">
      <span class="pra-side-title">解析</span>
      <span class="pra-explanation-text">${data.currentExplanation || '这道题考的是修辞格的辨析：比喻是把甲事物比作乙事物，本体与喻体之间要有相似点；借代是用相关事物代替本体，两者不能同时出现。判断时先看有没有「像、好像、仿佛」这类喻词，再看两个成分是不是同类事物。'}</span>
      <div class="pra-explanation-toggle">${explanationOpen ? '收起解析' : '展开全部解析'}</div>
    </div>
  </div>`
}

function tools(data) {
  return `
  <div class="pra-tools">
    <div class="pra-tool ${data.isCurrentQuestionFavorite ? 'on' : ''}">
      <div class="pra-tool-icon icon-star ${data.isCurrentQuestionFavorite ? 'on' : ''}"></div>
      <span class="pra-tool-text">收藏</span>
    </div>
    <div class="pra-tool">
      <div class="pra-tool-icon icon-grid"></div>
      <span class="pra-tool-text">答题卡</span>
    </div>
    <div class="pra-tool ${data.isCurrentQuestionMarked ? 'marked' : ''}">
      <div class="pra-tool-icon icon-pen ${data.isCurrentQuestionMarked ? 'on' : ''}"></div>
      <span class="pra-tool-text">${data.isCurrentQuestionMarked ? '已标记' : '标记'}</span>
    </div>
  </div>`
}

function footer(data) {
  return `
  <div class="pra-footer">
    ${tools(data)}
    <div class="pra-actions">
      <div class="pra-btn ${data.currentIndex === 0 ? 'is-disabled' : ''}">上一题</div>
      <div class="pra-btn primary">${data.primaryActionText}</div>
    </div>
  </div>`
}

function questionStage(data, explanationOpen) {
  // 未作答时不能渲染解析区（wxml 里是 wx:if="{{shouldRevealAnswer}}"），
  // 否则预览会摆出一个「未答却写着答错了」的假状态
  return `
  <div class="page practice-page font-${data.preferences.fontSize}">
    ${head(data)}
    <div class="pra-body">
      <div class="pra-content">
        <div class="pra-stem">${data.currentQuestion.stem}</div>
        <div class="pra-options">${optionList(data)}</div>
      </div>
      ${data.shouldRevealAnswer ? analysis(data, explanationOpen) : ''}
      <div class="pra-body-pad"></div>
    </div>
    ${footer(data)}
  </div>`
}

function sheetStage(data, items) {
  const cells = items
    .map((item) => `
      <div class="cell ${item.isCurrent ? 'cell-current' : ''} ${item.answered ? 'cell-answered' : 'cell-pending'}">
        <span class="cell-number">${item.number}</span>
        ${item.isMarked ? '<div class="cell-mark"></div>' : ''}
      </div>`)
    .join('')

  const answeredCount = items.filter((item) => item.answered).length
  const unansweredCount = items.filter((item) => !item.answered).length
  const markedCount = items.filter((item) => item.isMarked).length

  // 三态按钮，必须和组件 wxml 的 wx:if 分支一一对应
  let actions = ''

  if (unansweredCount > 0) {
    actions = `
      <div class="panel-row">
        <div class="panel-btn danger">确认结束</div>
        <div class="panel-btn primary">继续答题</div>
      </div>`
  } else if (markedCount > 0) {
    actions = `
      <div class="panel-row">
        <div class="panel-btn primary">继续答题</div>
        <div class="panel-btn accent">含标记，前往查看</div>
      </div>
      <div class="panel-btn danger panel-row-single">确认结束</div>`
  } else {
    actions = `
      <div class="panel-row">
        <div class="panel-btn primary">继续答题</div>
        <div class="panel-btn accent">确认结束</div>
      </div>`
  }

  return `
  <div class="page practice-page font-${data.preferences.fontSize}">
    ${head(data)}
    <div class="pra-body"><div class="pra-content"><div class="pra-stem">${data.currentQuestion.stem}</div></div></div>
    ${footer(data)}

    <div class="overview">
      <div class="mask"></div>
      <div class="panel">
        <div class="panel-grip"></div>
        <div class="panel-header"><span class="panel-title">答题卡</span></div>
        <div class="panel-stats">
          <div class="stat-item"><div class="stat-dot dot-answered"></div><span class="stat-text">已答 ${answeredCount}题</span></div>
          <span class="stat-sep">·</span>
          <div class="stat-item"><div class="stat-dot dot-pending"></div><span class="stat-text">未答 ${unansweredCount}题</span></div>
          <span class="stat-sep">·</span>
          <div class="stat-item"><div class="stat-dot dot-mark"></div><span class="stat-text">标记 ${markedCount}题</span></div>
        </div>
        <div class="legend">
          <div class="legend-item"><div class="dot dot-answered"></div><span class="legend-text">已答</span></div>
          <div class="legend-item"><div class="dot dot-pending"></div><span class="legend-text">未答</span></div>
          <div class="legend-item"><div class="dot dot-current"></div><span class="legend-text">当前</span></div>
          <div class="legend-item"><div class="dot dot-mark"></div><span class="legend-text">标记</span></div>
        </div>
        <div class="grid-scroll"><div class="grid">${cells}</div></div>
        <div class="panel-actions">${actions}</div>
      </div>
    </div>
  </div>`
}

function resultStage(data) {
  const cells = data.overviewItems
    .map((item) => `
      <div class="res-cell ${item.answered ? (item.isCorrect ? 'cell-correct' : 'cell-wrong') : 'cell-pending'}">
        <span class="res-cell-number">${item.number}</span>
        ${item.isMarked ? '<div class="res-cell-mark"></div>' : ''}
      </div>`)
    .join('')

  const answered = data.total - data.unansweredCount

  return `
  <div class="page practice-page font-${data.preferences.fontSize}">
    <div class="pra-result">
      <div class="pra-head pra-head-result">
        <div class="pra-head-text">
          <span class="pra-head-title">练习结果</span>
          <span class="pra-head-sub">${data.practiceTitle} · ${data.practiceSubtitle}</span>
        </div>
      </div>

      <div class="res-card">
        <div class="res-card-cell"><span class="res-card-value">${data.elapsedText}</span><span class="res-card-label">总用时</span></div>
        <div class="res-card-split"></div>
        <div class="res-card-cell"><span class="res-card-value">${answered}/${data.total}</span><span class="res-card-label">已答/总题</span></div>
        <div class="res-card-split"></div>
        <div class="res-card-cell"><span class="res-card-value">${data.score}%</span><span class="res-card-label">正确率</span></div>
      </div>

      <div class="res-detail">
        <div class="res-detail-head">
          <span class="res-detail-title">答题明细</span>
          <span class="res-detail-sub">历史最佳 ${data.bestScore}</span>
        </div>
        <div class="res-legend">
          <div class="res-legend-item"><div class="res-dot dot-correct"></div><span class="res-legend-text">答对</span></div>
          <div class="res-legend-item"><div class="res-dot dot-wrong"></div><span class="res-legend-text">答错</span></div>
          <div class="res-legend-item"><div class="res-dot dot-pending"></div><span class="res-legend-text">未答</span></div>
          <div class="res-legend-item"><div class="res-mark-dot"></div><span class="res-legend-text">标记</span></div>
        </div>
        <div class="res-grid">${cells}</div>
      </div>

      <div class="res-actions">
        <div class="pra-btn">返回题库</div>
        <div class="pra-btn primary">再来一次</div>
      </div>
      <div class="pra-body-pad"></div>
    </div>
  </div>`
}

const stages = [
  { tag: '答题页 · 练习模式（未作答）', body: questionStage(freshData, false) },
  { tag: '答题页 · 即时模式（答错 + 已收藏已标记）', body: questionStage(wrongData, true) },
  { tag: '答题页 · 答题卡（还有未答）', body: sheetStage(sheetData, sheetItems) },
  { tag: '答题页 · 答题卡（已答完 · 有标记）', body: sheetStage(markedDoneData, markedDoneItems) },
  { tag: '答题页 · 答题卡（已答完 · 无标记）', body: sheetStage(plainDoneData, plainDoneItems) },
  { tag: '答题页 · 答题结果', body: resultStage(resultData) }
]
  .map((stage) => `
    <div class="panel-col">
      <div class="panel-tag">${stage.tag}</div>
      <div class="stage"><style>${buildCss()}</style><div class="pra-nav"><span class="nav-back">‹</span></div>${stage.body}</div>
    </div>`)
  .join('')

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #e9ebf0; }
  .board { padding: 24px; display: flex; gap: 24px; align-items: flex-start; }
  /* ⚠️ 外层容器不能用 .cell / .row / .tag 这类页面里已有的类名：
     会命中真实样式，把预览整张图撑歪 */
  .panel-col { display: flex; flex-direction: column; }
  .panel-tag { font: 12px/22px Consolas, monospace; color: #55606e; }
</style></head>
<body><div class="board">${stages}</div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'practice-preview.html')
const pngPath = path.join(OUT_DIR, 'practice-preview.png')

fs.writeFileSync(htmlPath, html)

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))

if (!edge) {
  console.log(`未找到 Edge，HTML 已生成：${htmlPath}`)
  process.exit(0)
}

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--virtual-time-budget=2000',
  `--window-size=${STAGE_W * 6 + 170},${STAGE_H + 70}`,
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

const count = (items, key) => items.filter((item) => item[key]).length
console.log(`答题卡·未答完：已答 ${count(sheetItems, 'answered')}/${sheetItems.length}，标记 ${count(sheetItems, 'isMarked')}`)
console.log(`答题卡·已答完：标记 ${count(markedDoneItems, 'isMarked')}`)
console.log(`结果页：${resultData.correctCount}/${resultData.total} 正确，${resultData.score}%`)
console.log(`预览已生成：${pngPath}`)
