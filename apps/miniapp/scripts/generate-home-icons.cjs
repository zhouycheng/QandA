#!/usr/bin/env node
/**
 * 生成首页的内联 SVG 图标并注入 wxss。
 *
 * 项目约定：小程序图标用 base64 内联 SVG 写在 wxss 的 background-image 里，
 * 不引入图片文件、不依赖字体图标。这样图标能跟随 CSS 尺寸、无额外请求。
 *
 * 脚本是幂等的：按 class 名定位，把 background-image 的值替换为新生成的 data URI，
 * 因此可以反复执行，不会产生重复规则。
 *
 * 用法：node scripts/generate-home-icons.cjs
 */

const fs = require('fs')
const path = require('path')

const WXSS_PATH = path.resolve(__dirname, '../miniprogram/page/subject-list/index.wxss')

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke-linecap="round" stroke-linejoin="round"'

/** class 名 → SVG 内容 */
const ICONS = [
  {
    className: 'tip-badge-icon',
    // 喇叭：公告条左侧
    svg:
      `<svg ${SVG_ATTRS} stroke="#d97706" stroke-width="2">` +
      '<path d="M3.5 9.8h3.2L12 6.2v11.6L6.7 14.2H3.5z"/>' +
      '<path d="M15.6 9.4a4 4 0 0 1 0 5.2"/>' +
      '<path d="M18.2 7a7.6 7.6 0 0 1 0 10"/>' +
      '</svg>'
  },
  {
    className: 'data-head-icon',
    // 2×2 网格：学习数据卡标题
    svg:
      `<svg ${SVG_ATTRS} stroke="#ffffff" stroke-width="2.4">` +
      '<rect x="3.4" y="3.4" width="7" height="7" rx="2.2"/>' +
      '<rect x="13.6" y="3.4" width="7" height="7" rx="2.2"/>' +
      '<rect x="3.4" y="13.6" width="7" height="7" rx="2.2"/>' +
      '<rect x="13.6" y="13.6" width="7" height="7" rx="2.2"/>' +
      '</svg>'
  },
  {
    className: 'metric-icon-done',
    // 对勾圆圈：已完成
    svg:
      `<svg ${SVG_ATTRS} stroke="#17b26a" stroke-width="2">` +
      '<circle cx="12" cy="12" r="9"/>' +
      '<polyline points="7.8 12.3 10.7 15.2 16.2 9.4"/>' +
      '</svg>'
  },
  {
    className: 'metric-icon-wrong',
    // 叉号圆圈：错题
    svg:
      `<svg ${SVG_ATTRS} stroke="#f04438" stroke-width="2">` +
      '<circle cx="12" cy="12" r="9"/>' +
      '<line x1="9.2" y1="9.2" x2="14.8" y2="14.8"/>' +
      '<line x1="14.8" y1="9.2" x2="9.2" y2="14.8"/>' +
      '</svg>'
  },
  {
    className: 'metric-icon-accuracy',
    // 百分号圆圈：正确率
    svg:
      `<svg ${SVG_ATTRS} stroke="#f79009" stroke-width="2">` +
      '<circle cx="12" cy="12" r="9"/>' +
      '<line x1="9" y1="15" x2="15" y2="9"/>' +
      '<circle cx="9.6" cy="9.6" r="1.6" fill="#f79009" stroke="none"/>' +
      '<circle cx="14.4" cy="14.4" r="1.6" fill="#f79009" stroke="none"/>' +
      '</svg>'
  },
  {
    className: 'quote-mark',
    // 双引号：每日一句。实心填充，作为视觉标记而非可点按钮
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f79009" stroke="none">' +
      '<path d="M9.4 5.6C6.4 7 4.6 9.6 4.6 12.8c0 3 1.8 5 4.2 5 1.9 0 3.3-1.4 3.3-3.3 0-1.8-1.3-3.1-3.1-3.1-.3 0-.6 0-.9.1.3-1.7 1.4-3.2 2.9-4.2L9.4 5.6z"/>' +
      '<path d="M19 5.6c-3 1.4-4.8 4-4.8 7.2 0 3 1.8 5 4.2 5 1.9 0 3.3-1.4 3.3-3.3 0-1.8-1.3-3.1-3.1-3.1-.3 0-.6 0-.9.1.3-1.7 1.4-3.2 2.9-4.2L19 5.6z"/>' +
      '</svg>'
  },
  {
    className: 'metric-icon-time',
    // 时钟：学习时长
    svg:
      `<svg ${SVG_ATTRS} stroke="#2b7ffc" stroke-width="2">` +
      '<circle cx="12" cy="12" r="9"/>' +
      '<polyline points="12 6.8 12 12.4 16 14.6"/>' +
      '</svg>'
  }
]

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

/**
 * 把某个 class 的 background-image 换成新的 data URI。
 * 规则块里已有 background-image 就替换，没有就在块尾补一行。
 */
function injectIcon(css, className, dataUri) {
  const escaped = className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const withImage = new RegExp(
    `(\\.${escaped}\\s*\\{[^}]*background-image:\\s*)url\\("data:image\\/svg\\+xml;base64,[^"]*"\\)`
  )

  if (withImage.test(css)) {
    return { css: css.replace(withImage, `$1url("${dataUri}")`), mode: 'replace' }
  }

  const block = new RegExp(`(\\.${escaped}\\s*\\{)([^}]*)(\\})`)

  if (block.test(css)) {
    return {
      css: css.replace(block, (match, head, body, tail) => `${head}${body}  background-image: url("${dataUri}");\n${tail}`),
      mode: 'insert'
    }
  }

  return { css, mode: 'missing' }
}

function main() {
  if (!fs.existsSync(WXSS_PATH)) {
    console.error(`找不到样式文件：${WXSS_PATH}`)
    process.exit(1)
  }

  let css = fs.readFileSync(WXSS_PATH, 'utf8')
  let failed = 0

  ICONS.forEach((icon) => {
    const dataUri = toDataUri(icon.svg)
    const result = injectIcon(css, icon.className, dataUri)

    css = result.css

    if (result.mode === 'missing') {
      failed++
      console.error(`✗ .${icon.className} 未在 wxss 中找到，已跳过`)
    } else {
      console.log(`✓ .${icon.className}（${result.mode === 'replace' ? '替换' : '插入'}，${dataUri.length} 字节）`)
    }
  })

  if (failed) {
    process.exit(1)
  }

  fs.writeFileSync(WXSS_PATH, css)
  console.log(`\n已写入 ${path.relative(process.cwd(), WXSS_PATH)}，共 ${ICONS.length} 个图标`)
}

main()
