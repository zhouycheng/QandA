/**
 * 题库页静态预览：跑真实 BankDetailViewModel 拿数据，按真实 WXSS 渲染 402x874 画板。
 *   node scripts/preview-bank-detail.cjs
 * 输出 .tmp-preview/bank-detail-preview.png
 *
 * 三态并排，对应设计稿的两个面板 + 答题配置抽屉：
 *   章节列表 / 搜索结果 / 答题配置
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402
const STAGE_H = 874
const header = require('../miniprogram/utils/home-header.js').getInitialHomeHeaderData({ statusBarHeight: 47 }, { top: 51, height: 32 })

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)
}

// ---------- 真实数据 ----------

const { BankDetailViewModel } = require(path.join(MP, 'viewmodels/bank-detail-viewmodel.js'))
const catalog = require(path.join(MP, 'utils/question-bank-catalog.js'))

function createStorage(initial) {
  const store = Object.assign({}, initial || {})

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

/** 造一份「刷了一半」的进度：统计卡与章节行都有数字可看，不做假数据 */
function seedProgress() {
  const progress = {}
  const subjects = catalog.getSubjectSummaries()

  subjects.forEach((subject, subjectIndex) => {
    const detail = catalog.getSubjectDetail(subject.id)

    ;(detail.banks || []).forEach((bank, bankIndex) => {
      const questions = catalog.getBankQuiz(subject.id, bank.id).questions
      // 第一章刷满、第二章一半、第三章没动；其它科目给个中等进度
      let answeredCount = 0

      if (subjectIndex === 0) {
        answeredCount = bankIndex === 0 ? questions.length : (bankIndex === 1 ? Math.round(questions.length / 2) : 0)
      } else {
        answeredCount = Math.round(questions.length * 0.6)
      }

      const answers = {}

      questions.slice(0, answeredCount).forEach((question, index) => {
        answers[question.id] = index % 10 === 9 ? 0 : 1
      })

      if (answeredCount) {
        progress[bank.id] = {
          total: questions.length,
          answers,
          updatedAt: 1758000000000 + subjectIndex * 1000 + bankIndex
        }
      }
    })
  })

  return progress
}

const storage = createStorage({ qandaProgress: seedProgress() })
const firstSubjectId = catalog.getSubjectSummaries()[0].id
const firstDetail = catalog.getSubjectDetail(firstSubjectId)

// ① 章节列表（「最近在刷」选中）
const recentVm = new BankDetailViewModel({ storage })
const recentData = recentVm.enterRecent().data

// ② 搜索态
const searchVm = new BankDetailViewModel({ storage })
searchVm.load(firstSubjectId)
const searchKeyword = '英语'
const searchData = Object.assign({}, recentData, searchVm.updateSearch(searchKeyword).data)

// ③ 答题配置：第二章 + 打开限时
const sheetVm = new BankDetailViewModel({ storage })
sheetVm.load(firstSubjectId)
const targetBank = firstDetail.banks[1]
const sheetOpened = sheetVm.openBankConfig(firstSubjectId, targetBank.id)
sheetVm.setSheetTimed(true)
const sheetData = Object.assign({}, sheetOpened.data, sheetVm.buildSheetData(), {
  configSheetVisible: true
})

// ---------- 渲染 ----------

const PREVIEW_BASE = `
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; height: ${STAGE_H}px; position: relative; overflow: hidden; background: #fff; }
/* 页面高度按画板算：100vh 在预览里是整个浏览器窗口，不是这块画板 */
.stage .bank-detail-page { height: ${STAGE_H}px; }
/* 底栏与抽屉都是 position:fixed，预览里要相对画板 */
.stage .tabbar-wrap { position: absolute; bottom: 0; }
.stage .config-sheet { position: absolute; }
.pv-ph { font-size: 26rpx; color: #a0a5af; }
.pv-keyword { font-size: 26rpx; color: #141820; }
img.tab-icon { object-fit: contain; }
.pv-switch { position: relative; width: 84rpx; height: 48rpx; border-radius: 999rpx; background: #e5e7eb; }
.pv-switch::after { content: ""; position: absolute; top: 4rpx; left: 4rpx; width: 40rpx; height: 40rpx; border-radius: 50%; background: #fff; box-shadow: 0 2rpx 6rpx rgba(16, 24, 40, 0.18); }
.pv-switch.is-on { background: #466bff; }
.pv-switch.is-on::after { left: auto; right: 4rpx; }
`

function buildCss() {
  const app = read('app.wxss').replace(/^page(?=\s*[,\{])/gm, 'body')
  const page = read('page/bank-detail/index.wxss')
  const row = read('components/bank-list-item/index.wxss')
  const tabBar = read('custom-tab-bar/index.wxss')

  return rpxToPx(`
${app}
${page}
${row}
${tabBar}
${PREVIEW_BASE}
`)
}

/** 页头：标题 + 搜索框 + 筛选钮 */
function head(data) {
  const keyword = data.searchActive
    ? `<span class="pv-keyword">${data.searchKeyword}</span>`
    : '<span class="pv-ph">搜索题库 / 章节</span>'
  const clear = data.searchActive ? '<div class="bk-search-clear">×</div>' : ''

  return `
  <div class="bk-head" style="padding-top:${header.homeStatusBarHeight}px">
    <div class="bk-navigation" style="height:${header.homeNavigationBarHeight}px"><div class="bk-title">题库</div></div>
    <div class="bk-tools">
      <div class="bk-search">
        <div class="bk-search-icon"></div>
        <div class="bk-search-input">${keyword}</div>
        ${clear}
      </div>
      <div class="bk-filter ${data.filterUnfinished ? 'is-on' : ''}">
        <div class="bk-filter-icon"></div>
      </div>
    </div>
  </div>`
}

function rail(data) {
  const item = (name, count, active) => `
    <div class="rail-item ${active ? 'is-active' : ''}">
      <div class="rail-bar"></div>
      <div class="rail-body">
        <span class="rail-name">${name}</span>
        ${count ? `<span class="rail-count">${count}</span>` : ''}
      </div>
    </div>`

  const subjects = data.subjects.map((subject) => item(subject.name, 0, subject.active)).join('')

  return `
  <div class="rail">
    <div class="rail-inner">
      ${item('最近在刷', 0, data.railMode === 'recent')}
      ${item('我的错题', data.wrongCount, false)}
      ${item('我的收藏', data.favoriteCount, false)}
      <div class="rail-divider"></div>
      ${subjects}
      <div class="rail-divider"></div>
      ${item('导入题库', 0, false)}
    </div>
  </div>`
}

function statCard(data) {
  return `
  <div class="stat-card">
    <div class="stat-top">
      <span class="stat-scope">${data.railMode === 'recent' ? '最近在刷 · ' : ''}${data.subject.name}</span>
      <span class="stat-more">整科 ›</span>
    </div>
    <div class="stat-row">
      <div class="stat-item"><span class="stat-value">${data.stats.total}</span><span class="stat-label">题目总数</span></div>
      <div class="stat-line"></div>
      <div class="stat-item"><span class="stat-value">${data.stats.answered}</span><span class="stat-label">已答题数</span></div>
      <div class="stat-line"></div>
      <div class="stat-item"><span class="stat-value">${data.stats.accuracyText}</span><span class="stat-label">正确率</span></div>
    </div>
  </div>`
}

function chapterRow(bank) {
  return `
  <div class="chapter-row ${bank.isComplete ? 'is-done' : ''}">
    <div class="chapter-body"><span class="chapter-title">${bank.title}</span></div>
    <span class="chapter-meta">${bank.metaText}</span>
    <span class="chapter-arrow">›</span>
  </div>`
}

function listPanel(data) {
  const rows = data.rows.map(chapterRow).join('')

  return `
  <div class="panel">
    <div class="panel-inner">
      ${statCard(data)}
      <div class="chapter-list">${rows}</div>
    </div>
  </div>`
}

function searchPanel(data) {
  const rows = data.searchResults.map((item) => `
    <div class="search-row">
      <div class="search-row-main">
        <span class="search-row-title">${item.chapterTitle}</span>
        <span class="search-row-sub">${item.subjectName} · ${item.metaText}</span>
      </div>
      <span class="search-row-arrow">›</span>
    </div>`).join('')

  return `
  <div class="panel">
    <div class="panel-inner">
      <div class="search-head">
        <span class="search-title">搜索结果</span>
        <span class="search-sub">${data.searchResults.length} 条</span>
      </div>
      ${rows}
    </div>
  </div>`
}

/** 静态底栏：只为预览还原位置与比例，图标用真实 PNG */
function tabBar() {
  const icons = [
    { text: '首页', icon: 'home', active: false },
    { text: '题库', icon: 'bank', active: true },
    { text: '复盘', icon: 'review', active: false },
    { text: '我的', icon: 'my', active: false }
  ]

  const items = icons.map((item) => `
    <div class="tab-item ${item.active ? 'active' : ''}">
      <img class="tab-icon" src="../miniprogram/assets/tabbar/${item.icon}${item.active ? '-active' : ''}.png" />
      <span class="tab-text">${item.text}</span>
    </div>`).join('')

  return `
  <div class="tabbar-wrap">
    <div class="tabbar">${items}</div>
    <div class="continue-btn"><div class="continue-icon"></div></div>
    <div class="continue-label">继续答题</div>
  </div>`
}

function stage(data, panel, options) {
  const settings = options || {}

  return `
  <div class="stage">
    <div class="bank-detail-page">
      ${head(data)}
      <div class="workbench">
        ${rail(data)}
        ${panel}
      </div>
    </div>
    ${settings.sheet ? configSheet(data) : ''}
    ${settings.tabBar === false ? '' : tabBar()}
  </div>`
}

function segChips(options, active, disabled) {
  return options.map((option) => `
    <div class="seg-chip ${option.value === active ? 'is-active' : ''} ${disabled ? 'is-muted' : ''}">${option.label}</div>`).join('')
}

function configSheet(data) {
  const durationChips = data.sheetTimed
    ? `<div class="config-row config-row-chips"><div class="seg-group seg-group-end">
        ${segChips(data.durationOptions, data.sheetDuration, false)}
      </div></div>`
    : ''

  const wrongHint = data.sheetWrongCount ? '' : '<span class="config-inline-hint">暂无错题</span>'

  return `
  <div class="config-sheet portal-theme">
    <div class="config-mask"></div>
    <div class="config-panel">
      <div class="config-grip"></div>
      <div class="config-head">
        <span class="config-title">${data.configTitle}</span>
        <span class="config-sub">${data.configSubtitle}</span>
      </div>
      <div class="config-rows">
        <div class="config-row">
          <span class="config-label">模式</span>
          <div class="seg-group">${segChips(data.modeOptions, data.sheetMode, false)}</div>
        </div>
        <div class="config-row">
          <span class="config-label">顺序</span>
          <div class="seg-group">${segChips(data.orderOptions, data.sheetOrder, data.sheetOrderDisabled)}</div>
        </div>
        <div class="config-row">
          <span class="config-label">是否限时</span>
          <div class="pv-switch ${data.sheetTimed ? 'is-on' : ''}"></div>
        </div>
        ${durationChips}
        <div class="config-row">
          <span class="config-label">只答错题</span>
          <div class="config-row-tail">
            ${wrongHint}
            <div class="pv-switch ${data.sheetOnlyWrong ? 'is-on' : ''}"></div>
          </div>
        </div>
      </div>
      <div class="config-actions">
        <div class="config-btn ghost">取消</div>
        <div class="config-btn primary">${data.sheetStartText}</div>
      </div>
    </div>
  </div>`
}

const stages = [
  { tag: '题库 · 最近在刷', body: stage(recentData, listPanel(recentData)) },
  { tag: '题库 · 搜索', body: stage(searchData, searchPanel(searchData)) },
  { tag: '答题配置', body: stage(sheetData, listPanel(sheetData), { sheet: true, tabBar: false }) }
]

const panels = stages
  .map((item) => `
    <div class="panel-col">
      <div class="panel-tag">${item.tag}</div>
      <div class="panel-frame"><style>${buildCss()}</style>${item.body}</div>
    </div>`)
  .join('')

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #e9ebf0; }
  .board { padding: 24px; display: flex; gap: 24px; align-items: flex-start; }
  /* ⚠️ 外层容器不能用 .cell / .row / .stat-card 这类页面里已有的类名：
     会命中真实样式，把预览整张图撑歪 */
  .panel-col { display: flex; flex-direction: column; }
  .panel-tag { font: 12px/22px Consolas, monospace; color: #55606e; }
</style></head>
<body><div class="board">${panels}</div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'bank-detail-preview.html')
const pngPath = path.join(OUT_DIR, 'bank-detail-preview.png')

fs.writeFileSync(htmlPath, html)

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))

if (!edge) {
  console.error('未找到 Edge，无法截图。HTML 已生成：' + htmlPath)
  process.exit(0)
}

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--virtual-time-budget=2500',
  '--window-size=' + (STAGE_W * stages.length + 24 * (stages.length + 1) + 16 * (stages.length - 1)) + ',' + (STAGE_H + 70),
  '--screenshot=' + pngPath,
  'file:///' + htmlPath.replace(/\\/g, '/')
], { stdio: 'ignore' })

console.log(`章节数：${recentData.rows.length}，搜索命中：${searchData.searchResults.length} 条`)
console.log(`预览已生成：${pngPath}`)
