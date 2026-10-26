/**
 * 图标预览：把 WXSS 里内联的四个图标抠出来，渲染成一张 HTML 便于截图核对。
 * 仅开发期自查用，不参与小程序构建。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const WXSS = path.join(ROOT, 'miniprogram/page/subject-list/index.wxss')
const OUT_DIR = path.join(ROOT, '.tmp-preview')

// 第三项是示例徽标数字：带徽标才看得出「红徽标压在红图标上」读不读得清
const ITEMS = [
  ['recent', '最近练习', ''],
  ['mock', '模拟考试', ''],
  ['wrong', '我的错题', '3'],
  ['favorite', '我的收藏', '12']
]

function pickBase64(source, key) {
  const pattern = new RegExp(`\\.entry-icon-${key}\\s*\\{[^}]*?base64,([A-Za-z0-9+/=]+)`)
  const matched = source.match(pattern)

  return matched ? matched[1] : null
}

const css = fs.readFileSync(WXSS, 'utf8')
const cells = ITEMS.map(([key, label, badge]) => {
  const base64 = pickBase64(css, key)

  if (!base64) {
    console.error(`未找到 ${key} 的图标`)
    process.exitCode = 1
  }

  const badgeHtml = badge ? `<div class="bd">${badge}</div>` : ''

  return `<div class="it">
  <div class="icon-wrap">
    <div class="ic" style="background-image:url(data:image/svg+xml;base64,${base64 || ''})"></div>
    ${badgeHtml}
  </div>
  <div class="lb">${label}</div>
</div>`
}).join('\n')

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; padding: 20px; background: #f7f9fc;
         font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { display: flex; justify-content: space-around; align-items: flex-start;
          width: 640px; padding: 22px 6px; background: #fff; border-radius: 22px; }
  .it { display: flex; flex-direction: column; align-items: center; }
  .icon-wrap { position: relative; }
  .ic { width: 88px; height: 88px; border-radius: 24px;
        background-repeat: no-repeat; background-position: center; background-size: 100% 100%; }
  /* 与 .entry-badge 同参数：34rpx→17px、白边 1.5px、压在右上角 */
  .bd { position: absolute; top: -5px; right: -7px; min-width: 17px; height: 17px;
        padding: 0 4.5px; display: flex; align-items: center; justify-content: center;
        border-radius: 999px; background: #f04438; border: 1.5px solid #fff;
        font-size: 10px; font-weight: 600; color: #fff; }
  .lb { margin-top: 12px; font-size: 22px; color: #1f2a37; }
</style></head>
<body><div class="wrap">
${cells}
</div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'preview.html'), html, 'utf8')
console.log(path.join(OUT_DIR, 'preview.html'))
