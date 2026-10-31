/**
 * 首页倒计时卡 × 三时段封面：同一张卡换底图，验证切换后书本/时钟不跳位、白字都读得清。
 *   node scripts/preview-home-covers.cjs
 * 输出 .tmp-preview/home-covers.png
 *
 * 只渲染卡片本身（不铺整页）：要判断的是「三张图在同一块区域里是否稳定」，
 * 铺整页会把下方四宫格也画出来，反而看不清卡片。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT_DIR = path.join(ROOT, '.tmp-preview')
const STAGE_W = 402
const CARD_H = 320 // rpx，与 .exam-card 保持一致

const read = (relative) => fs.readFileSync(path.join(MP, relative), 'utf8')

const rpxToPx = (css) =>
  css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, value) => `${(Number(value) * STAGE_W) / 750}px`)

const { COVER_BY_DAY_PART } = require(path.join(MP, 'utils/home-content.js'))

const coverUri = (part) =>
  `data:image/jpeg;base64,${fs
    .readFileSync(path.join(MP, COVER_BY_DAY_PART[part].replace(/^\//, '')))
    .toString('base64')}`

const PART_LABELS = {
  morning: '早 · 05:00–11:00',
  noon: '中 · 11:00–18:00',
  evening: '晚 · 18:00–05:00'
}

const GREETINGS = {
  morning: '早上好',
  noon: '下午好',
  evening: '晚上好'
}

function buildCss() {
  const app = read('app.wxss').replace(/^page(?=\s*[,\{])/gm, 'body')
  const page = read('page/subject-list/index.wxss')

  return rpxToPx(`
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.stage { width: ${STAGE_W}px; background: #fff; position: relative; overflow: hidden; padding: 24px 16px 28px; box-sizing: border-box; }
${app}
${page}
`)
}

const card = (part) => `
  <div class="exam-card">
    <div class="exam-cover" style="background-image:url('${coverUri(part)}');background-size:cover;background-position:center"></div>
    <div class="exam-veil"></div>
    <div class="exam-body">
      <div class="exam-head">
        <span class="exam-greeting">${GREETINGS[part]}</span>
        <span class="exam-date">10 月 27 日 周二</span>
      </div>
      <div class="exam-main">
        <span class="exam-text">距离 期末考试 还有</span>
        <span class="exam-days">51</span>
        <span class="exam-text">天</span>
      </div>
      <div class="exam-foot">
        <span class="exam-quote">把每天的十分钟攒起来，考场上就是底气。</span>
        <span class="exam-action">修改</span>
      </div>
    </div>
  </div>`

const panels = Object.keys(PART_LABELS)
  .map((part) => `
    <div class="cell">
      <div class="cell-tag">${PART_LABELS[part]}</div>
      <div class="stage"><style>${buildCss()}</style>${card(part)}</div>
    </div>`)
  .join('')

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #e9ebf0; }
  .board { padding: 20px; display: flex; gap: 16px; align-items: flex-start; }
  .cell { display: flex; flex-direction: column; }
  .cell-tag { font: 12px/22px Consolas, monospace; color: #55606e; }
</style></head>
<body><div class="board">${panels}</div></body></html>`

fs.mkdirSync(OUT_DIR, { recursive: true })

const htmlPath = path.join(OUT_DIR, 'home-covers.html')
const pngPath = path.join(OUT_DIR, 'home-covers.png')

fs.writeFileSync(htmlPath, html)

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))

if (!edge) {
  console.log(`未找到 Edge，HTML 已生成：${htmlPath}`)
  process.exit(0)
}

// 画板宽 = 3 张卡 + 间距 + 内边距；高度按卡片实际像素高加标签行
const cardPx = Math.round((CARD_H * STAGE_W) / 750) + 52 + 40

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=1500',
  `--window-size=${(STAGE_W + 32) * 3 + 40},${cardPx}`,
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
], { stdio: 'ignore' })

console.log(`预览已生成：${pngPath}`)
