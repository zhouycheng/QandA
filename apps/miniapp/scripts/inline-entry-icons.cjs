/**
 * 一次性脚本：把四宫格图标的 SVG 内联成 base64 填进 WXSS。
 *
 * 为什么不让 WXSS 直接引本地 .svg：微信的 background-image 不支持本地路径，
 * 必须 base64 或网络地址。而 base64 手写进去不可维护，所以用脚本生成。
 * 改图标时改这里的 SVG 源码，重跑一遍即可。
 */
const fs = require('fs')
const path = require('path')

const TARGET = path.join(__dirname, '..', 'miniprogram', 'page', 'subject-list', 'index.wxss')

/* 四个图标共用一套画布约定：96×96、圆角 26（≈27%，接近 iOS 圆角方块），
   背景走同色系浅→深渐变，字形一律纯白，保证压在任何一种底色上都读得清。 */

const ICONS = {
  // 最近练习：日历 + 铅笔，橙
  ICON_RECENT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g1" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#FAC48E"/><stop offset="1" stop-color="#EA8E42"/></linearGradient></defs>
<rect width="96" height="96" rx="26" fill="url(#g1)"/>
<rect x="26" y="33" width="44" height="35" rx="9" fill="#FFFFFF" opacity="0.96"/>
<rect x="26" y="33" width="44" height="11" rx="9" fill="#F9D5AF"/>
<rect x="26" y="40" width="44" height="4" fill="#F9D5AF"/>
<rect x="35" y="27" width="5" height="11" rx="2.5" fill="#FFFFFF"/>
<rect x="56" y="27" width="5" height="11" rx="2.5" fill="#FFFFFF"/>
<g transform="translate(60 62) rotate(-45)">
<path d="M-20.5 0 L-14 -4.2 H11 a2.1 2.1 0 0 1 0 8.4 H-14 Z" fill="#FFFFFF" stroke="#E1802F" stroke-width="2" stroke-linejoin="round"/>
<rect x="6" y="-4.2" width="5.5" height="8.4" rx="1.6" fill="#F3A35F"/>
</g>
</svg>`,

  // 模拟考试：答题板 + 对勾，绿
  ICON_MOCK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g2" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#8FE2C6"/><stop offset="1" stop-color="#54C69E"/></linearGradient></defs>
<rect width="96" height="96" rx="26" fill="url(#g2)"/>
<rect x="42" y="23" width="14" height="9" rx="4.5" fill="#FFFFFF" opacity="0.75"/>
<rect x="29" y="30" width="40" height="43" rx="10" fill="#FFFFFF" opacity="0.96"/>
<path d="M40 51.5 L46.5 58 L58 45.5" fill="none" stroke="#54C69E" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  // 我的错题：笔记本 + 叉，红
  ICON_WRONG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g3" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#F5938D"/><stop offset="1" stop-color="#E96A65"/></linearGradient></defs>
<rect width="96" height="96" rx="26" fill="url(#g3)"/>
<rect x="28" y="30" width="40" height="43" rx="9" fill="#FFFFFF" opacity="0.96"/>
<rect x="24" y="37" width="9" height="6" rx="3" fill="#FFFFFF"/>
<rect x="24" y="49" width="9" height="6" rx="3" fill="#FFFFFF"/>
<rect x="24" y="61" width="9" height="6" rx="3" fill="#FFFFFF"/>
<path d="M41 46 L55 60 M55 46 L41 60" fill="none" stroke="#E96863" stroke-width="5" stroke-linecap="round"/>
<rect x="41" y="66" width="16" height="3" rx="1.5" fill="#F7BBB7"/>
</svg>`,

  // 我的收藏：文件夹 + 星，蓝
  ICON_FAVORITE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g4" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#8CBCF9"/><stop offset="1" stop-color="#5A93EE"/></linearGradient></defs>
<rect width="96" height="96" rx="26" fill="url(#g4)"/>
<path d="M27 33 h13.5 l5.5 7 H69 a7 7 0 0 1 7 7 v19 a7 7 0 0 1 -7 7 H27 a7 7 0 0 1 -7 -7 V40 a7 7 0 0 1 7 -7 z" fill="#FFFFFF" opacity="0.96"/>
<path d="M48 46 L50.5 52.6 L57.5 52.9 L52 57.3 L53.9 64.1 L48 60.2 L42.1 64.1 L44 57.3 L38.5 52.9 L45.5 52.6 Z" fill="#5A93EE"/>
</svg>`
}

/** SVG 必须压成单行再 base64：换行在 data URI 里虽然能过，但会让 WXSS 变难读 */
function toDataUri(svg) {
  const compact = svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim()

  return `data:image/svg+xml;base64,${Buffer.from(compact, 'utf8').toString('base64')}`
}

let wxss = fs.readFileSync(TARGET, 'utf8')
const missing = []

Object.keys(ICONS).forEach((key) => {
  const dataUri = toDataUri(ICONS[key])
  // ICON_RECENT → recent，对应 WXSS 里的 .entry-icon-recent
  const slug = key.replace(/^ICON_/, '').toLowerCase()

  // 幂等：直接改写该规则里已有的 background-image 值。
  // 用占位符只能替换一次，改完图标想再调一次就得手工找 base64，容易出事。
  const pattern = new RegExp(
    `(\\.entry-icon-${slug}\\s*\\{[^}]*?background-image:\\s*url\\(")[^"]*(")`
  )

  if (!pattern.test(wxss)) {
    missing.push(slug)
    return
  }

  wxss = wxss.replace(pattern, `$1${dataUri}$2`)
})

if (missing.length) {
  console.error(`未找到对应规则：${missing.join(', ')}`)
  process.exit(1)
}

fs.writeFileSync(TARGET, wxss, 'utf8')

Object.keys(ICONS).forEach((key) => {
  console.log(`${key}: ${toDataUri(ICONS[key]).length} 字符`)
})
console.log(`\n已写入 ${TARGET}`)
