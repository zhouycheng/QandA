/**
 * 复盘 / 错题本 / 收藏本 三面板静态预览。
 *
 * 全部数据跑真实 ViewModel（含真实 SVG 图表），HTML 结构照抄 WXML，
 * 样式用页面真实 WXSS（rpx 按 402 画板换算）——预览与线上不一致就等于没验。
 *   node scripts/preview-review.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402
const STAGE_H = 874
const NAV_H = 91
const header = require('../miniprogram/utils/home-header.js').getInitialHomeHeaderData({ statusBarHeight: 47 }, { top: 51, height: 32 })

const requireMP = (relative) => require(path.join(MP, relative))
const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

/** rpx → px：预览画板就是设计稿宽度 402，和真机 750 是同一个比例 */
function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)
}

/** wxss 的 @import 是相对该页目录的，浏览器不吃这套，先摊平 */
function inlineImports(css, pageDir) {
  return css.replace(/@import\s+["']([^"']+)["'];?/g, (_, rel) => {
    const target = path.resolve(MP, pageDir, rel)

    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  })
}

// ---------- 造一份有代表性的本地数据 ----------

const { buildEmailAuth, AUTH_STORAGE_KEY } = requireMP('utils/auth-session.js')
const { DAILY_LOG_STORAGE_KEY, formatDateKey, shiftDays } = requireMP('utils/daily-log.js')
const { StatsViewModel } = requireMP('viewmodels/stats-viewmodel.js')
const { WrongBookViewModel } = requireMP('viewmodels/wrong-book-viewmodel.js')
const repository = requireMP('repositories/practice-repository.js')
const catalog = requireMP('utils/question-bank-catalog.js')

const today = new Date()
const todayTs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

// 近半年：越近越密，量在 0~26 之间起伏，热力图才有层次
const dailyLog = {}
const RECENT = [
  { answered: 18, correct: 15, seconds: 1500 },
  { answered: 12, correct: 9, seconds: 960 },
  { answered: 0, correct: 0, seconds: 0 },
  { answered: 22, correct: 18, seconds: 1800 },
  { answered: 26, correct: 21, seconds: 2160 },
  { answered: 14, correct: 12, seconds: 1140 },
  { answered: 38, correct: 29, seconds: 3240 }
]

for (let offset = 181; offset >= 0; offset -= 1) {
  const ts = shiftDays(todayTs, -offset)
  const key = formatDateKey(ts)

  if (offset < 7) {
    dailyLog[key] = RECENT[6 - offset]
    continue
  }

  const seed = (offset * 37) % 11
  const answered = seed > 6 ? (seed - 5) * 5 : 0

  if (answered) {
    dailyLog[key] = {
      answered,
      correct: Math.round(answered * 0.76),
      seconds: answered * 70
    }
  }
}

// 进度：104/130 已答，其中五分之一答错（正确率 80%）
const progress = {
  'chinese-ch001': {
    total: 130,
    answers: Array.from({ length: 104 }).reduce((map, item, index) => {
      map[`q${index}`] = index % 5 === 0 ? 0 : 1

      return map
    }, {}),
    updatedAt: Date.now()
  }
}

const storageData = {
  [DAILY_LOG_STORAGE_KEY]: dailyLog,
  [AUTH_STORAGE_KEY]: buildEmailAuth({ userId: 'preview-user', token: 'preview-token', email: 'preview@example.com', nickname: '小同学', college: '计算机科学与技术学院' }),
  qandaProgress: progress,
  qandaStudyTime: { totalSeconds: 10800, sessionCount: 12 }
}

const storage = {
  get(key) {
    const value = storageData[key]

    return value === undefined ? '' : value
  },
  set(key, value) {
    storageData[key] = value
  },
  remove(key) {
    delete storageData[key]
  },
  keys() {
    return Object.keys(storageData)
  }
}

// 错题本：跨两个章节铺 9 条，其中 3 条连对两次（已掌握），剩下 6 条待复习
const bankTap = catalog.getBankQuiz('subject-chinese', 'chinese-ch001')
const bankUp = catalog.getBankQuiz('subject-chinese', 'chinese-ch002')
const tapIds = (bankTap.questions || []).slice(0, 6).map((question) => question.id)
const upIds = (bankUp.questions || []).slice(0, 3).map((question) => question.id)

repository.saveWrongResults(storage, tapIds.concat(upIds).map((id) => ({ id, answered: true, correct: false })))
repository.saveWrongResults(storage, tapIds.slice(0, 3).map((id) => ({ id, answered: true, correct: true })))

// 收藏本：11 条，其中一部分已经练过（「待练习」才有数字）
const favoriteIds = tapIds.concat(upIds).slice(0, 11)
favoriteIds.forEach((id) => repository.addQuestionFavorite(storage, id))

const reviewData = new StatsViewModel({ storage }).load().data
const guestReviewData = new StatsViewModel({ storage: { get: () => null } }).load().data
const wrongVm = new WrongBookViewModel({ storage })
const favoriteVm = new WrongBookViewModel({ storage })
const wrongData = wrongVm.load({ type: 'wrong' }).data
const favoriteData = favoriteVm.load({ type: 'favorite' }).data

// ---------- 样式拼装 ----------

const PREVIEW_BASE = `
.stage { height: ${STAGE_H}px; }
/* 预览里 100vh 是浏览器窗口而不是 402x874 画板，页面的 min-height:100vh 必须按画板重算 */
.stage .list-page { min-height: ${STAGE_H}px; }
.stage .review-page-locked { height: ${STAGE_H}px; }
.stage .review-login { border: 0; }
/* 底栏与「开始练习」都是 position:fixed，预览里要相对画板，否则会横穿整个看板 */
.stage .tabbar-wrap { position: absolute; bottom: 0; }
.stage .wb-footer { position: absolute; }
.nav { height: ${NAV_H}px; position: relative; }
/* 真机二级页的系统返回箭头，预览里画出来对齐效果 */
.nav-back { position: absolute; left: 12px; bottom: 8px; font-size: 24px; line-height: 1; color: #141820; font-weight: 300; }
`

function buildCss(pageWxss, pageDir) {
  const app = read('app.wxss').replace(/^page(?=\s*[,\{])/gm, 'body')
  const page = inlineImports(read(pageWxss), pageDir)
  const tabBar = read('custom-tab-bar/index.wxss')

  return rpxToPx(`
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; background: #fff; position: relative; overflow: hidden; }
${app}
${page}
${tabBar}
${PREVIEW_BASE}
`)
}

// ---------- 面板一：复盘 ----------

function reviewStage(data) {
  const metric = (label, value, unit) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <div class="metric-value"><span class="metric-num">${value}</span><span class="metric-unit">${unit}</span></div>
      </div>`

  const entry = (key) => {
    const item = data.entries[key]

    return `
      <div class="entry-card entry-${key}">
        <div class="entry-head">
          <div class="entry-icon entry-icon-${key}"></div>
          <span class="entry-title">${item.title}</span>
        </div>
        <div class="entry-value">
          <span class="entry-num">${item.value}</span>
          <span class="entry-unit">${item.unit}</span>
        </div>
        <span class="entry-caption">${item.caption}</span>
      </div>`
  }

  const legend = data.activity.legend
    .map((cls) => `<div class="legend-cell ${cls}"></div>`)
    .join('')

  return `
  <div class="list-page review-page ${data.requiresLogin ? 'review-page-locked' : ''}" style="padding-top:${header.homeStatusBarHeight}px">
    <div class="page-head" style="height:${header.homeNavigationBarHeight}px">
      <div class="page-head-main">
        <span class="page-head-title">复盘</span>
      </div>
    </div>
    <div class="review-stage">
    <div class="review-content ${data.requiresLogin ? 'is-locked' : ''}">
    <span class="review-sub">${data.identity.subtitle}</span>

    <div class="segmented">
      ${data.rangeOptions.map((option) => `<div class="seg ${data.range === option.value ? 'seg-active' : ''}">${option.label}</div>`).join('')}
    </div>

    <div class="metric-row">
      ${metric('题量', data.metrics.answered, '道')}
      ${metric('正确率', data.metrics.accuracy, '%')}
      ${metric('学习时长', data.metrics.duration, '分')}
    </div>

    <div class="entry-row">
      ${entry('wrong')}
      ${entry('favorite')}
    </div>

    <div class="block">
      <div class="block-head">
        <span class="block-title">学习活动</span>
        <span class="block-caption">近半年</span>
      </div>
      <img class="heatmap" src="${data.activity.dataUri}" />
      <div class="legend-row"><span class="legend-text">少</span>${legend}<span class="legend-text">多</span></div>
    </div>

    <div class="block">
      <div class="block-head">
        <span class="block-title">答题趋势</span>
        <span class="block-caption">${data.trend.caption}</span>
      </div>
      ${data.trend.hasData
    ? `<img class="trend-chart" src="${data.trend.dataUri}" />`
    : '<div class="chart-empty"><span>这段时间还没有练习记录，做一套题就有曲线了</span></div>'}
    </div>
    </div>
    </div>
    ${data.requiresLogin ? `<div class="review-access" style="padding-top:calc(${32 * STAGE_W / 750}px + ${header.homeStatusBarHeight + header.homeNavigationBarHeight}px)">
      <div class="review-lock"><div class="mi-icon mi-lock"></div></div>
      <span class="review-access-title">登录后查看学习复盘</span>
      <span class="review-access-desc">查看学习趋势，回顾错题与收藏</span>
      <button class="review-login">登录查看复盘</button>
    </div>` : ''}
  </div>
  ${tabbar('review')}`
}

// ---------- 面板二 / 三：错题本 / 收藏本 ----------

function bookStage(data) {
  const statItems = data.stats
    .map((item) => `
      <div class="stat-item">
        <span class="stat-label">${item.label}</span>
        <div class="stat-value"><span class="stat-num">${item.value}</span><span class="stat-unit">${item.unit}</span></div>
      </div>`)
    .join('')

  const dist = data.hasDist ? `
      <div class="dist">
        <div class="dist-bar">
          ${data.dist.map((item) => `<div class="dist-seg ${item.tone}" style="width: ${item.percent}%"></div>`).join('')}
        </div>
        <div class="dist-legend">
          ${data.dist.map((item) => `<div class="dist-item"><span class="dist-name">${item.name}</span><span class="dist-count">${item.count}</span></div>`).join('')}
        </div>
      </div>` : ''

  const cards = data.items.map((item) => `
      <div class="q-card">
        <div class="q-accent ${item.badgeTone}"></div>
        <div class="q-body">
          <div class="q-top">
            <span class="q-title">${item.title}</span>
            <div class="q-chevron"></div>
          </div>
          <span class="q-stem">${item.stem}</span>
          <div class="q-meta">
            <span class="q-badge ${item.badgeTone}">${item.badgeText}</span>
            <span class="q-type">${item.typeText}</span>
            ${item.dateText ? `<span class="q-date">${item.dateText}</span>` : ''}
          </div>
        </div>
      </div>`).join('')

  return `
  <div class="nav" style="background:#fff"><span class="nav-back">‹</span></div>
  <div class="list-page wb-page">
    <div class="wb-head">
      <div class="wb-head-spacer"></div>
      <span class="wb-title">${data.title}</span>
      <div class="wb-manage">${data.manage ? '完成' : '管理'}</div>
    </div>

    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-title-box">
          <div class="stat-icon ${data.type}"></div>
          <span class="stat-title">${data.statTitle}</span>
        </div>
        <span class="stat-hint">${data.statHint}</span>
      </div>
      <div class="stat-row">${statItems}</div>
      ${dist}
    </div>

    <div class="filter-wrap">
      <div class="filter-row">
        <div class="filter-subject">
          <span class="filter-strong">${data.subjectFilterText}</span>
          <div class="filter-caret"></div>
          <span class="filter-sep">·</span>
          <span class="filter-weak">${data.totalCount} 题</span>
        </div>
        <div class="filter-sort">
          <div class="filter-sort-icon"></div>
          <span class="filter-weak">${data.sortText}</span>
        </div>
      </div>
    </div>

    <div class="chips">
      ${data.chips.map((chip) => `<div class="chip ${data.activeChip === chip.key ? 'is-active' : ''}">${chip.text}</div>`).join('')}
    </div>

    <div class="wb-list">${cards}</div>
    ${data.items.length ? '' : `<div class="wb-empty"><span class="wb-empty-text">${data.emptyText}</span></div>`}

    ${data.items.length ? `
    <div class="pager">
      <div class="pager-btn">‹</div>
      <span class="pager-text">${data.pageText}</span>
      <span class="pager-index">${data.page} / ${data.pageCount}</span>
      <div class="pager-btn">›</div>
    </div>` : ''}

    <div class="wb-footer">
      <div class="wb-footer-btn">${data.footerText}</div>
      <span class="wb-footer-hint">${data.footerHint}</span>
    </div>
  </div>`
}

// ---------- 底栏：直接用真实结构与真实 PNG 图标 ----------

function tabbar(active) {
  const tabs = [
    { key: 'home', text: '首页', icon: 'home' },
    { key: 'bank', text: '题库', icon: 'bank' },
    { key: 'review', text: '复盘', icon: 'review' },
    { key: 'my', text: '我的', icon: 'my' }
  ]

  const items = tabs.map((tab) => `
    <div class="tab-item ${tab.key === active ? 'active' : ''}">
      <img class="tab-icon" src="../miniprogram/assets/tabbar/${tab.icon}${tab.key === active ? '-active' : ''}.png" />
      <span class="tab-text">${tab.text}</span>
    </div>`).join('')

  return `
  <div class="tabbar-wrap">
    <div class="tabbar">${items}</div>
    <div class="continue-btn"><div class="continue-icon"></div></div>
    <div class="continue-label">继续答题</div>
  </div>`
}

// ---------- 出图 ----------

const stages = [
  { tag: '游客复盘', css: buildCss('page/stats/index.wxss', 'page/stats'), body: reviewStage(guestReviewData) },
  { tag: '复盘（tab 文案；路由 page/stats）', css: buildCss('page/stats/index.wxss', 'page/stats'), body: reviewStage(reviewData) },
  { tag: '错题本（点复盘页入口卡进入）', css: buildCss('page/wrong-book/index.wxss', 'page/wrong-book'), body: bookStage(wrongData) },
  { tag: '收藏本（同一页面 type=favorite）', css: buildCss('page/wrong-book/index.wxss', 'page/wrong-book'), body: bookStage(favoriteData) }
]

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #e9ebf0; }
  .board { padding: 24px; display: flex; gap: 28px; }
  .cell { display: flex; flex-direction: column; }
  .cell-tag { font: 12px/22px Consolas, monospace; color: #55606e; }
  img.tab-icon { object-fit: contain; }
</style></head>
<body><div class="board">
${stages.map((stage) => `
  <div class="cell">
    <div class="cell-tag">${stage.tag}</div>
    <div class="stage"><style>${stage.css}</style>${stage.body}</div>
  </div>`).join('')}
</div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'review-preview.html')
const pngPath = path.join(OUT_DIR, 'review-preview.png')

fs.writeFileSync(htmlPath, html)

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))

if (!edge) {
  console.log(`未找到 Edge，HTML 已生成：${htmlPath}`)
  process.exit(0)
}

const boardWidth = STAGE_W * stages.length + 48 + (stages.length - 1) * 28 + 28

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=2500',
  `--window-size=${boardWidth},${STAGE_H + 96}`,
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

// 再出一张 1:1 的单画板（看细节用）：$$.png 是整页宽，摊到三个画板会糊
execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--virtual-time-budget=2500',
  `--window-size=${STAGE_W + 48},${STAGE_H + 96}`,
  `--screenshot=${path.join(OUT_DIR, 'review-detail.png')}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

console.log(`复盘：${reviewData.metrics.answered} 道 / ${reviewData.metrics.accuracy}% / ${reviewData.metrics.duration} 分`)
console.log(`入口：错题本 ${reviewData.entries.wrong.value} 道（${reviewData.entries.wrong.caption}）`)
console.log(`      收藏本 ${reviewData.entries.favorite.value} 道（${reviewData.entries.favorite.caption}）`)
console.log(`错题本：${wrongData.totalCount} 题 / ${wrongData.statHint} / ${wrongData.footerText}`)
console.log(`收藏本：${favoriteData.totalCount} 题 / ${favoriteData.statHint} / ${favoriteData.footerText}`)
console.log(`三面板已生成：${pngPath}`)
