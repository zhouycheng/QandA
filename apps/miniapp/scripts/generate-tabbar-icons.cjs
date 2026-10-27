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

/**
 * 四个图标统一按「光学重心」校准过：都在 24×24 网格里占 16~17.6 的宽度、
 * 笔画出头方向也一致（上圆下方），这样在 50rpx 的盒子里看起来一样大。
 * 早期版本「统计」是柱状图（只占中间一小块），和房子的体量差太多，
 * 换成一整圈时钟之后四个图标的视觉重量才齐。现在这个位置叫「复盘」。
 */
const ICONS = {
  home: [
    '<path d="M3.9 10.3 12 3.8l8.1 6.5v9.1a.9.9 0 0 1-.9.9h-4.5v-5.6H9.3v5.6H4.8a.9.9 0 0 1-.9-.9z"/>'
  ].join(''),
  bank: [
    '<rect x="4" y="3.9" width="7" height="7" rx="1.7"/>',
    '<rect x="13" y="3.9" width="7" height="7" rx="1.7"/>',
    '<rect x="4" y="13.1" width="7" height="7" rx="1.7"/>',
    '<rect x="13" y="13.1" width="7" height="7" rx="1.7"/>'
  ].join(''),
  // 复盘 = 时钟：整圈圆弧撑满网格，视觉分量和其他三个持平
  review: [
    '<circle cx="12" cy="12" r="8.2"/>',
    '<path d="M12 7.2V12l3.5 2.1"/>'
  ].join(''),
  my: [
    '<circle cx="12" cy="7.7" r="4.3"/>',
    '<path d="M4.5 20.8a7.5 7.5 0 0 1 15 0"/>'
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
