/**
 * 「我的 / 账号管理 / 邮箱提醒」静态预览：把真实 WXSS 的 rpx 按 750rpx = 402px
 * （设计稿画板宽）换算后渲染 HTML，包含「我的」静止与按压状态，
 * 用来和 Figma 781:1922 / 781:2123 / 781:2043 逐项比对。
 *
 * 只用真实样式，不手写任何尺寸 —— 预览和线上不一致就等于没验。
 * 仅开发期自查，不参与小程序构建：
 *   node scripts/preview-my.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402 // 设计稿画板宽度
const STAGE_H = 874 // 设计稿画板高度
const NAV_H = 91 // 状态栏 + 导航栏，画板的顶部留白里含这部分
const header = require('../miniprogram/utils/home-header.js').getInitialHomeHeaderData({ statusBarHeight: 47 }, { top: 51, height: 32 })

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

/** rpx → px：按 750rpx = STAGE_W px 换算 */
function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)
}

/** @import 换成内联，预览里没有 wxss 解析器 */
function inlineImports(css, pageDir) {
  return css.replace(/@import\s+["']([^"']+)["'];?/g, (_, rel) => {
    const target = path.resolve(MP, pageDir, rel)

    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  })
}

/**
 * 预览专用兜底层。放最后，靠同权重后写覆盖真实样式：
 * - 原生组件（switch / input）在 HTML 里没有，得自己画；
 * - 底部固定按钮在预览里是相对画板的 absolute，不是相对视口。
 */
const PREVIEW_BASE = `
.stage { height: ${STAGE_H}px; }
.stage .bottom-bar { position: absolute; left: 41rpx; right: 41rpx; }

.field-input {
  display: block;
  width: 100%;
  border: 0;
  outline: 0;
  font-family: inherit;
  box-sizing: border-box;
}

/* 原生 switch 52x32 缩到 0.78 ≈ 40x25，这里直接画 40x24 */
.switch {
  flex: none;
  position: relative;
  width: 40px;
  height: 24px;
  border-radius: 12px;
  background: #d9dce3;
  transform: none;
  transition: none;
}
.switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}
.switch-on { background: #466bff; }
.switch-on::after { left: auto; right: 2px; }

/* 非「我的」页：设计稿是货真价实的导航栏（返回箭头 + 居中标题） */
.nav-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: ${NAV_H}px;
  background: #fff;
}
.nav-title { font-size: 34rpx; font-weight: 600; color: #141820; }
.nav-back {
  position: absolute;
  left: 24px;
  top: 50%;
  width: 11px;
  height: 11px;
  margin-top: -6px;
  border-left: 2px solid #141820;
  border-bottom: 2px solid #141820;
  transform: rotate(45deg);
}
`

function buildCss(pageDir) {
  const app = read('app.wxss').replace(/^page(?=\s*[,\{])/gm, 'body')
  const page = inlineImports(read(`${pageDir}/index.wxss`), pageDir)

  return rpxToPx(`
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; background: #fff; position: relative; overflow: hidden; }
${app}
${page}
${PREVIEW_BASE}
`)
}

const chevron = '<div class="chevron"></div>'
const sw = (on) => `<div class="switch ${on ? 'switch-on' : ''}"></div>`
const check = (on) => `
  <div class="checkbox ${on ? 'checkbox-checked' : ''}">${on ? '<div class="checkbox-check"></div>' : ''}</div>`

const profileHead = `
  <div class="profile">
    <div class="profile-avatar"><div class="avatar-icon"></div></div>
    <div class="profile-main">
      <span class="profile-name">curry</span>
      <span class="profile-sub">计算机科学与技术学院</span>
      <span class="profile-meta">cu***@qq.com</span>
    </div>
  </div>`

function row(title, value) {
  return `
    <div class="row">
      <span class="row-label">${title}</span>
      <span class="row-value">${value}</span>
      ${chevron}
    </div>`
}

const myBody = `
  <div class="list-page" style="padding-top:${header.homeStatusBarHeight}px">
    <div class="page-head" style="height:${header.homeNavigationBarHeight}px"><span class="page-head-title">我的</span></div>
    ${profileHead}
    <div class="pill-row">
      <span class="pill-row-label">账号管理</span>
      <span class="pill-row-value">个人信息与安全</span>
      ${chevron}
    </div>
    <div class="group">
      <span class="group-title">学习设置</span>
      ${row('答题偏好', '即时答案')}
      ${row('自定义布局', '默认布局')}
      ${row('邮箱提醒', '已开启')}
      ${row('关于QandA', '')}
    </div>
    <div class="bottom-btn logout-button">退出登录</div>
    <div class="links">
      <span class="link">用户协议</span>
      <div class="link-divider"></div>
      <span class="link">隐私政策</span>
    </div>
  </div>`

const accountBody = `
  <div class="nav-bar"><div class="nav-back"></div><span class="nav-title">账号管理</span></div>
  <div class="list-page page-with-bottom-bar">
    <div class="section">
      <span class="group-title">个人信息</span>
      <div class="avatar-row">
        <div class="profile-avatar avatar-sm"><div class="avatar-icon"></div></div>
        <span class="avatar-label">头像</span>
        <div class="link-btn"><span class="info-action">更换头像</span>${chevron}</div>
      </div>
      <div class="field">
        <span class="field-label">昵称</span>
        <input class="field-input" value="curry" />
      </div>
      <div class="field">
        <span class="field-label">学院 / 单位</span>
        <input class="field-input" value="计算机科学与技术学院" />
      </div>
    </div>
    <div class="group">
      <span class="group-title">账号信息</span>
      <div class="info-item">
        <span class="info-label">绑定邮箱</span>
        <div class="info-line">
          <span class="info-value">cu***@qq.com</span>
          <span class="info-action">更换</span>
          ${chevron}
        </div>
      </div>
      <div class="info-item">
        <span class="info-label">微信绑定</span>
        <div class="info-line">
          <span class="info-value">已绑定</span>
          <span class="info-action">管理</span>
          ${chevron}
        </div>
      </div>
      <div class="info-item">
        <span class="info-label">登录密码</span>
        <div class="info-line">
          <span class="info-value">已设置</span>
          <span class="info-action">修改</span>
          ${chevron}
        </div>
      </div>
      <span class="section-note">邮箱用于登录、找回密码与接收提醒。</span>
    </div>
  </div>
  <div class="bottom-bar"><div class="bottom-btn">保存资料</div></div>`

function examRow(name, date, status, tone) {
  return `
    <div class="exam-row">
      <span class="row-label">${name}</span>
      <span class="exam-date">${date}</span>
      <div class="status-pill status-pill-${tone}">${status}</div>
    </div>`
}

function checkItem(label, on) {
  return `<div class="checkbox-item">${check(on)}<span class="checkbox-label">${label}</span></div>`
}

const reminderBody = `
  <div class="nav-bar"><div class="nav-back"></div><span class="nav-title">邮箱提醒</span></div>
  <div class="list-page page-with-bottom-bar">
    <div class="switch-row switch-row-tall">
      <div class="row-main">
        <span class="row-label">允许邮箱提醒</span>
        <span class="row-desc">发送至 cu***@qq.com</span>
      </div>
      ${sw(true)}
    </div>
    <div class="group">
      <span class="group-title">定时复习</span>
      <div class="switch-row">
        <span class="row-label">定时复习</span>
        ${sw(true)}
      </div>
      ${row('提醒时间', '20:00')}
      ${row('重复频率', '每天')}
    </div>
    <div class="group">
      <div class="switch-row">
        <span class="row-label">考试提醒</span>
        ${sw(true)}
      </div>
      <span class="exam-title">我的考试</span>
      ${examRow('大学语文', '2026/12/26', '24天后', 'upcoming')}
      ${examRow('期末考试', '2027/01/09', '38天后', 'upcoming')}
      <div class="add-btn">+ 添加考试</div>
      <div class="advance">
        <span class="advance-label">提前提醒</span>
        <div class="checkbox-row">
          ${checkItem('7天前', true)}
          ${checkItem('3天前', false)}
          ${checkItem('当天', true)}
        </div>
        <span class="checkbox-hint">已结束的考试不再发送提醒</span>
      </div>
    </div>
  </div>
  <div class="bottom-bar"><div class="bottom-btn">保存设置</div></div>`

const stages = [
  { dir: 'page/my', body: myBody, tag: '我的 781:1922' },
  { dir: 'page/my', body: myBody.replace('class="row"', 'class="row row-hover"'), tag: '我的 · 按压反馈' },
  { dir: 'page/account', body: accountBody, tag: '账号管理 781:2123' },
  { dir: 'page/reminder', body: reminderBody, tag: '邮箱提醒 781:2043' }
]

function buildHtml() {
  const cells = stages
    .map((stage) => {
      const css = buildCss(stage.dir)

      return `
      <div class="cell">
        <div class="cell-tag">${stage.tag}</div>
        <div class="stage">
          <style>${css}</style>
          ${stage.body}
        </div>
      </div>`
    })
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  /* 外层容器不能叫 .row / .tag 这类名字：会和页面里真实的 .row 撞上，
     把 54px 的行高撑成 80px，预览就白做了 */
  body { margin: 0; background: #e9ebf0; }
  .board { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  .cell { display: flex; flex-direction: column; }
  .cell-tag { font: 12px/22px Consolas, monospace; color: #55606e; }
</style></head>
<body><div class="board">${cells}</div></body></html>`
}

function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ]

  return candidates.find((file) => fs.existsSync(file)) || ''
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'my-preview.html')
const pngPath = path.join(OUT_DIR, 'my-preview.png')

fs.writeFileSync(htmlPath, buildHtml())

const edge = findEdge()

if (!edge) {
  console.log(`未找到 Edge，HTML 已生成：${htmlPath}`)
  process.exit(0)
}

const WINDOW_H = STAGE_H + 96

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=2000',
  `--window-size=${STAGE_W * stages.length + 160},${WINDOW_H}`,
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

console.log(`预览已生成：${pngPath}`)
