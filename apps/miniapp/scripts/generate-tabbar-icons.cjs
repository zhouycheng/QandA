/**
 * 生成 tabBar 图标（微信要求本地图片，不支持 SVG / base64）。
 *
 * 运行：
 *   NODE_PATH="C:/Users/curry/.workbuddy/binaries/node/workspace/node_modules" \
 *     node apps/miniapp/scripts/generate-tabbar-icons.cjs
 *
 * 依赖 @resvg/resvg-js（只在生成时用，小程序运行时不依赖任何 npm 包）。
 * 输出：miniprogram/assets/tabbar/*.png，共 4 组 × 2 态。
 */
const fs = require('node:fs')
const path = require('node:path')
const { Resvg } = require('@resvg/resvg-js')

const OUT_DIR = path.resolve(__dirname, '../miniprogram/assets/tabbar')
const SIZE = 81
const STROKE = 2

const COLOR_NORMAL = '#8a94a6'
const COLOR_ACTIVE = '#2b7ffc'

// 与项目内联图标同一套 24×24 描边网格，保证视觉语言一致
const ICONS = {
  home: [
    '<path d="M3.5 10.3 12 3.7l8.5 6.6V20a.9.9 0 0 1-.9.9H4.4a.9.9 0 0 1-.9-.9z"/>',
    '<path d="M9.6 20.9v-5.4h4.8v5.4"/>'
  ].join(''),
  bank: [
    '<path d="M11.2 2.9a2 2 0 0 1 1.6 0l8 3.6a1 1 0 0 1 0 1.8l-8 3.6a2 2 0 0 1-1.6 0l-8-3.6a1 1 0 0 1 0-1.8z"/>',
    '<path d="M3.2 12.4 11.2 16a2 2 0 0 0 1.6 0l8-3.6"/>',
    '<path d="M3.2 16.9 11.2 20.5a2 2 0 0 0 1.6 0l8-3.6"/>'
  ].join(''),
  stats: [
    '<path d="M4.2 20.4h15.6"/>',
    '<path d="M8 20.4v-5.6"/>',
    '<path d="M12 20.4V8.4"/>',
    '<path d="M16 20.4v-8.4"/>'
  ].join(''),
  my: [
    '<circle cx="12" cy="7.6" r="4.1"/>',
    '<path d="M4.7 20.9a7.3 7.3 0 0 1 14.6 0"/>'
  ].join('')
}

function buildSvg(body, color) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}"`,
    ` fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
    body,
    '</svg>'
  ].join('')
}

function render(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: SIZE }
  })

  return resvg.render().asPng()
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const written = []

Object.keys(ICONS).forEach((name) => {
  const variants = [
    { suffix: '', color: COLOR_NORMAL },
    { suffix: '-active', color: COLOR_ACTIVE }
  ]

  variants.forEach((variant) => {
    const fileName = `${name}${variant.suffix}.png`
    const target = path.join(OUT_DIR, fileName)
    const png = render(buildSvg(ICONS[name], variant.color))

    fs.writeFileSync(target, png)
    written.push({ fileName, bytes: png.length, color: variant.color })
  })
})

written.forEach((item) => {
  console.log(`${item.fileName.padEnd(18)} ${String(item.bytes).padStart(6)} bytes  ${item.color}`)
})

console.log(`\n共生成 ${written.length} 个图标，输出目录：${OUT_DIR}`)
