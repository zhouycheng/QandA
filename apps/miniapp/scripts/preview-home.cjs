/**
 * 首页整页预览：把真实 WXSS 里的 rpx 换算成 px（750rpx = 375px，系数 0.5）后
 * 渲染一份 HTML，用来在不开微信开发者工具的情况下核对布局。
 *
 * 只用真实样式、不手写尺寸 —— 预览和线上不一致就等于没验。
 * 仅开发期自查，不参与小程序构建。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

/** rpx → px：375px 宽的机型下 750rpx = 375px */
function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${Number(value) / 2}px`)
}

/** 组件 wxss 里没有变量定义，变量来自 app.wxss 的 page 选择器 */
function combineCss() {
  const app = read('app.wxss').replace(/^page\s*\{/m, 'body {')
  const home = read('page/subject-list/index.wxss')
  const tabbar = read('custom-tab-bar/index.wxss')
  const sheet = read('components/bottom-sheet/index.wxss')

  return rpxToPx(`${app}\n${home}\n${tabbar}\n${sheet}`)
}

const iconUri = (name, active) =>
  `data:image/png;base64,${fs
    .readFileSync(path.join(MP, `assets/tabbar/${name}${active ? '-active' : ''}.png`))
    .toString('base64')}`

// 封面按时段取图：直接读真实工具函数，避免这里写死某一张、改天又对不上
const { COVER_BY_DAY_PART, getDayPart, getGreetingText } = require(
  path.join(MP, 'utils/home-content.js')
)
const coverUri = `data:image/jpeg;base64,${fs
  .readFileSync(path.join(MP, COVER_BY_DAY_PART[getDayPart(Date.now())].replace(/^\//, '')))
  .toString('base64')}`
const liveGreeting = getGreetingText(Date.now())
const { getInitialHomeHeaderData } = require(path.join(MP, 'utils/home-header.js'))
const headerData = getInitialHomeHeaderData({ statusBarHeight: 44 }, { top: 50, height: 32 })

/** 从页面 wxss 里取四宫格图标的 data URI（和线上用的是同一份） */
const homeCss = read('page/subject-list/index.wxss')
const entryIcon = (key) => {
  const matched = homeCss.match(
    new RegExp(`\\.entry-icon-${key}\\s*\\{[^}]*?background-image:\\s*url\\("([^"]+)"\\)`)
  )

  return matched ? matched[1] : ''
}

const ENTRIES = [
  ['recent', '最近练习', ''],
  ['mock', '模拟考试', ''],
  ['wrong', '我的错题', '3'],
  ['favorite', '我的收藏', '12']
]

const entryHtml = ENTRIES.map(
  ([key, label, badge]) => `<div class="entry">
        <div class="entry-icon entry-icon-${key}">${badge ? `<div class="entry-badge">${badge}</div>` : ''}</div>
        <span class="entry-label">${label}</span>
      </div>`
).join('\n      ')

const TABS = [
  ['home', '首页', true],
  ['bank', '题库', false],
  // 第 3 个 tab 的文案与图标都已改成「复盘」（路由仍是 /page/stats/index）
  ['review', '复盘', false],
  ['my', '我的', false]
]

const tabHtml = TABS.map(
  ([key, text, active]) => `<div class="tab-item${active ? ' active' : ''}">
        <img class="tab-icon" src="${iconUri(key, active)}">
        <span class="tab-text">${text}</span>
      </div>`
).join('\n      ')

/**
 * 倒计时卡的四种状态各渲染一版，用来验「高度固定 + space-between」不会把
 * 内容少的几种状态拉散。
 *   node scripts/preview-home.cjs configured|today|past|empty
 */
const STATE = process.argv[2] || 'configured'
const { SubjectListViewModel } = require(path.join(MP, 'viewmodels/subject-list-viewmodel.js'))
const repository = require(path.join(MP, 'repositories/practice-repository.js'))
const previewAnnouncements = ['notice', 'modal'].includes(STATE)
  ? [{ id: 'preview', title: '联调公告示例', body: '公告发布后，首页喇叭会持续摇动。点击喇叭即可查看公告全文。' }]
  : []
const noticeData = new SubjectListViewModel({ repository: Object.assign({}, repository, { getRemoteAnnouncements: () => previewAnnouncements }) }).load().data
const megaphoneUri = `data:image/png;base64,${fs.readFileSync(path.join(MP, 'assets/home/announcement-megaphone.png')).toString('base64')}`

const MAIN_BLOCK = {
  configured: `<div class="exam-main">
            <span class="exam-text">距离 期末考试 还有</span>
            <span class="exam-days">51</span>
            <span class="exam-text">天</span>
          </div>`,
  today: `<div class="exam-main exam-main-today">
            <span class="exam-text">期末考试</span>
            <span class="exam-days exam-days-today">就在今天</span>
          </div>`,
  past: `<div class="exam-main">
            <span class="exam-text">期末考试 考试已结束</span>
          </div>`,
  empty: `<div class="exam-main exam-main-empty">
            <span class="exam-text">设置考试倒计时</span>
          </div>`
}[['notice', 'modal'].includes(STATE) ? 'configured' : STATE] || ''

const ACTION_TEXT = STATE === 'empty' ? '去设置' : '修改'

/* modal 状态：公告弹窗打开时的样子。底栏此时应被藏起来（.tabbar-hidden）。 */
const SHOW_MODAL = STATE === 'modal'
const TABBAR_CLASS = SHOW_MODAL ? 'tabbar-wrap tabbar-hidden' : 'tabbar-wrap'

const MODAL_HTML = !SHOW_MODAL ? '' : `
  <div class="bottom-sheet">
    <div class="mask"></div>
    <div class="panel panel-center">
      <div class="panel-header">
        <span class="panel-title">公告</span>
        <span class="panel-close">关闭</span>
      </div>
      <div class="panel-body">
        <div class="notice-sheet">
          <div class="notice-badge"><img class="notice-badge-icon" src="${megaphoneUri}"></div>
          ${noticeData.announcements.map((item) => `<div class="notice-item"><span class="notice-title">${item.title}</span><span class="notice-body">${item.body}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: 375px; }
  .stage { position: relative; width: 375px; height: 812px; overflow: hidden; background: #f4f7fb; }

  /* 状态栏和系统胶囊叠在自定义页头上，品牌标题与胶囊同行。 */
  .chrome { position: absolute; left: 0; right: 0; top: 0; height: ${headerData.homeStatusBarHeight + headerData.homeNavigationBarHeight}px;
            color: #fff; z-index: 5; pointer-events: none; }
  .chrome-status { height: ${headerData.homeStatusBarHeight}px; display: flex; align-items: center;
                   justify-content: space-between; padding: 0 22px; font-size: 13px; font-weight: 600; }
  .chrome-bar { height: ${headerData.homeNavigationBarHeight}px; display: flex; align-items: center;
                justify-content: flex-end; padding: 0 10px; }
  .capsule { width: 87px; height: 32px; border-radius: 16px;
             border: 1px solid rgba(255, 255, 255, 0.35);
             background: rgba(0, 0, 0, 0.12); }

  .scroller { position: absolute; left: 0; right: 0; top: 0; bottom: 0; overflow: hidden; }
  .page { min-height: 0; }
${combineCss()}

  /* 预览专用修正：headless Edge 会把窗口宽度钳到 ~504，position:fixed 于是按那个
     错误的视口宽度铺开（截图却还是 375），底栏会整体右移、第 4 个 tab 跑出画面。
     真机上视口宽度就等于设备宽度，所以这里改成 absolute 对齐 375 宽的舞台即可等价。 */
  .tabbar-wrap { position: absolute !important; }
  .hero-notice-icon, .notice-badge-icon { object-fit: contain; }
  .search-input { border: 0; outline: 0; background: transparent; padding: 0; }

  .bottom-sheet { position: absolute !important; top: 0 !important; bottom: auto !important; height: 812px; }
</style></head>
<body><div class="stage">
<div class="chrome">
  <div class="chrome-status"><span>23:54</span><span>····  81%</span></div>
  <div class="chrome-bar"><div class="capsule"></div></div>
</div>
<div class="scroller">
  <div class="page home-page">
    <div class="hero" style="padding-top: ${headerData.homeStatusBarHeight}px;">
      <div class="hero-navigation" style="height: ${headerData.homeNavigationBarHeight}px;"><div class="hero-brand">QandA</div></div>
      <div class="hero-search">
        <div class="search-box">
          <input class="search-input" placeholder="搜索题目、关键词">
          <div class="search-icon"></div>
        </div>
        <div class="hero-notice-btn" role="button" aria-label="查看公告"><img class="hero-notice-icon${noticeData.hasAnnouncements ? ' hero-notice-icon-active' : ''}" src="${megaphoneUri}"><span class="hero-notice-label">公告</span></div>
      </div>
    </div>

    <div class="sheet">
      <div class="exam-card">
        <img class="exam-cover" src="${coverUri}">
        <div class="exam-veil"></div>
        <div class="exam-body">
          <div class="exam-head">
            <span class="exam-greeting">${liveGreeting}</span>
            <span class="exam-date">10 月 25 日 周日</span>
          </div>
          ${MAIN_BLOCK}
          <div class="exam-foot">
            <span class="exam-quote">与其焦虑结果，不如专注眼前这道题。</span>
            <span class="exam-action">${ACTION_TEXT}</span>
          </div>
        </div>
      </div>

      <div class="section-head"><span class="section-title">我的学习空间</span></div>

      <div class="entry-grid">
      ${entryHtml}
      </div>

      <div class="home-foot"><span class="home-foot-text">已做 12 / 234 题 · 正确率 75%</span></div>
    </div>

    <div class="${TABBAR_CLASS}">
      <div class="tabbar">
      ${tabHtml}
      </div>
      <div class="continue-btn"><div class="continue-icon"></div></div>
      <span class="continue-label">继续答题</span>
    </div>

    ${MODAL_HTML}
  </div>
</div></div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })
const outFile = path.join(OUT_DIR, STATE === 'configured' ? 'home.html' : `home-${STATE}.html`)
fs.writeFileSync(outFile, html, 'utf8')
console.log(outFile)
