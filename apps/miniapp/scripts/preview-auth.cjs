/**
 * 认证页静态预览：把真实 WXSS 的 rpx 按 750rpx = 402px（设计稿画板宽）换算后渲染 HTML，
 * 三个页面并排出一张图，用来和 Figma 763:567 / 772:1036 / 772:1076 逐项比对。
 *
 * 只用真实样式，不手写任何尺寸 —— 预览和线上不一致就等于没验。
 * 仅开发期自查，不参与小程序构建。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402 // 设计稿画板宽度
const NAV_H = 91 // 状态栏 + 导航栏，设计稿的 116px 顶部留白里含这部分

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

/** rpx → px：按 750rpx = STAGE_W px 换算 */
function rpxToPx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)
}

/** @import 换成内联，预览里没有 wxss 解析器 */
function inlineImports(css) {
  return css.replace(/@import\s+["']([^"']+)["'];?/g, (_, rel) => {
    const target = path.resolve(MP, 'page/login', rel)

    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  })
}

function buildCss(pageDir) {
  const app = read('app.wxss').replace(/^page(?=\s*[,\{])/gm, 'body')
  const page = inlineImports(read(`${pageDir}/index.wxss`))
  const shared = read('styles/auth-form.wxss')

  return rpxToPx(`
body { margin: 0; background: #e9ebf0; font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; background: #fff; position: relative; overflow: hidden; }
.nav { height: ${NAV_H}px; background: #fff; }
.field-input::placeholder { color: #8a8a8a; font-size: 26rpx; font-weight: 500; }
.field-input { border: 0; outline: 0; font-family: inherit; }
.code-row .field-input { background: transparent; }
${app}
${shared}
${page}
`)
}

const brand = `
  <div class="brand"><span class="brand-name">QandA</span><span class="brand-sub">答题系统</span></div>
`

function field(label, placeholder, cls, extra) {
  return `
    <div class="field">
      <span class="field-label">${label}</span>
      ${extra || `<input class="field-input ${cls || ''}" placeholder="${placeholder}">`}
    </div>`
}

function codeField(cls) {
  return field('邮箱验证码', '', '', `
      <div class="code-row ${cls || ''}">
        <input class="field-input" placeholder="请输入验证码">
        <span class="code-btn">发送验证码</span>
      </div>`)
}

const agreeRow = (withForgot) => `
  <div class="agree-row">
    <div class="agree-left">
      <div class="checkbox checkbox-on"><div class="checkbox-tick"></div></div>
      <span class="agree-text">已阅读并同意用户协议和隐私政策</span>
    </div>
    ${withForgot ? '<span class="forgot-link">忘记密码？</span>' : ''}
  </div>`

const loginBody = `
  <div class="auth-page">
    ${brand}
    <span class="page-title">登录</span>
    <div class="form login-form">
      ${field('邮箱', '请输入邮箱')}
      ${field('密码', '请输入密码')}
    </div>
    ${agreeRow(true)}
    <div class="btn btn-primary login-submit">登录</div>
    <span class="or-text">或</span>
    <div class="btn btn-wechat wechat-btn">微信登录</div>
    <span class="entry-link">没有账号？立即注册</span>
  </div>`

const registerBody = `
  <div class="auth-page">
    ${brand}
    <span class="page-title">注册</span>
    <div class="form">
      ${field('邮箱', '请输入邮箱')}
      ${codeField()}
      ${field('设置密码', '请设置 8–20 位字母与数字组合')}
      ${field('确认密码', '请再次输入密码')}
    </div>
    <div class="agree-row register-agree">
      <div class="agree-left">
        <div class="checkbox checkbox-on"><div class="checkbox-tick"></div></div>
        <span class="agree-text">已阅读并同意用户协议和隐私政策</span>
      </div>
    </div>
    <div class="btn btn-primary">注册</div>
    <div class="back-row"><span class="back-tip">已有账号？</span><span class="back-link">返回登录</span></div>
  </div>`

const forgotBody = `
  <div class="auth-page">
    ${brand}
    <span class="page-title">找回密码</span>
    <div class="form">
      ${field('邮箱', '请输入注册邮箱')}
      ${codeField()}
      ${field('新密码', '请设置 8–20 位字母与数字组合')}
      ${field('确认密码', '请再次输入新密码')}
    </div>
    <span class="hint-line">重置成功后，请使用新密码登录</span>
    <div class="btn btn-primary">重置密码</div>
    <div class="back-row"><span class="back-link">返回登录</span></div>
  </div>`

const stages = [
  { dir: 'page/login', body: loginBody, tag: '登录 763:567' },
  { dir: 'page/register', body: registerBody, tag: '注册 772:1036' },
  { dir: 'page/forgot-password', body: forgotBody, tag: '找回密码 772:1076' }
]

function buildHtml() {
  const cells = stages
    .map((stage) => {
      const css = buildCss(stage.dir)

      return `
      <div class="cell">
        <div class="tag">${stage.tag}</div>
        <div class="stage">
          <style>${css}</style>
          <div class="nav"></div>
          ${stage.body}
        </div>
      </div>`
    })
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #e9ebf0; }
  .row { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  .cell { display: flex; flex-direction: column; }
  .tag { font: 12px/22px Consolas, monospace; color: #55606e; }
</style></head>
<body><div class="row">${cells}</div></body></html>`
}

function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ]

  return candidates.find((file) => fs.existsSync(file)) || ''
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'auth-preview.html')
const pngPath = path.join(OUT_DIR, 'auth-preview.png')

fs.writeFileSync(htmlPath, buildHtml())

const edge = findEdge()

if (!edge) {
  console.log(`未找到 Edge，HTML 已生成：${htmlPath}`)
  process.exit(0)
}

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=2000',
  `--window-size=${STAGE_W * 3 + 160},920`,
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

console.log(`预览已生成：${pngPath}`)
