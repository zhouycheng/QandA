/**
 * 生成菜单图标（我的页 / 设置页共用）。
 *
 * 与 generate-tabbar-icons.cjs 的区别：
 *   - tabBar 用真 PNG（微信只接受位图）；
 *   - 页面内图标沿用项目既有的内联 SVG 方案，直接内联进 WXSS 当背景图。
 *
 * 由于「我的」与「设置」两个页面都要用，图标类写进 app.wxss（全局样式），
 * 而不是各页各写一份 —— 改图标只改本脚本的 ICONS 再重跑。
 *
 * 用法：node scripts/generate-menu-icons.cjs
 * 输出直接写回 miniprogram/app.wxss 的 ICON-BLOCK 标记之间，可重复执行。
 */

const fs = require('fs')
const path = require('path')

const TARGET = path.join(__dirname, '..', 'miniprogram', 'app.wxss')
const START_MARK = '/* === ICON-BLOCK-START：由 scripts/generate-menu-icons.cjs 生成，勿手工编辑 === */'
const END_MARK = '/* === ICON-BLOCK-END === */'

const ICONS = [
  {
    name: 'switch',
    label: '学习偏好',
    color: '#2b7ffc',
    body: '<rect x="3" y="7" width="18" height="10" rx="5"/>' +
      '<circle cx="8.6" cy="12" r="2.6" fill="#2b7ffc" stroke="none"/>'
  },
  {
    name: 'shield',
    label: '账户与安全',
    color: '#17b26a',
    body: '<path d="M12 3.2l7 2.9v5.4c0 4.2-2.9 7.7-7 8.6-4.1-.9-7-4.4-7-8.6V6.1z"/>' +
      '<path d="M9.1 12.1l2 2 3.8-3.9"/>'
  },
  {
    name: 'info',
    label: '版本信息',
    color: '#7c5cff',
    body: '<circle cx="12" cy="12" r="8.8"/>' +
      '<line x1="12" y1="11" x2="12" y2="16.4"/>' +
      '<circle cx="12" cy="7.9" r="1.2" fill="#7c5cff" stroke="none"/>'
  },
  {
    name: 'wrong',
    label: '错题本',
    color: '#f04438',
    body: '<circle cx="12" cy="12" r="8.8"/>' +
      '<line x1="9.2" y1="9.2" x2="14.8" y2="14.8"/>' +
      '<line x1="14.8" y1="9.2" x2="9.2" y2="14.8"/>'
  },
  {
    name: 'star',
    label: '我的收藏',
    color: '#f79009',
    body: '<polygon points="12 3.2 14.9 9 21.2 9.9 16.6 14.4 17.7 20.6 12 17.7 6.3 20.6 7.4 14.4 2.8 9.9 9.1 9"/>'
  },
  {
    name: 'trash',
    label: '清空学习数据',
    color: '#f04438',
    body: '<path d="M4 7h16"/>' +
      '<path d="M9.2 7V5.2h5.6V7"/>' +
      '<path d="M6.6 7l1 12.2h8.8L17.4 7"/>' +
      '<line x1="10.6" y1="10.4" x2="10.6" y2="16.2"/>' +
      '<line x1="13.4" y1="10.4" x2="13.4" y2="16.2"/>'
  },
  {
    name: 'lock',
    label: '修改密码',
    color: '#2b7ffc',
    body: '<rect x="4.6" y="10" width="14.8" height="9.8" rx="2.6"/>' +
      '<path d="M8.3 10V8.1a3.7 3.7 0 0 1 7.4 0V10"/>' +
      '<circle cx="12" cy="14.9" r="1.4" fill="#2b7ffc" stroke="none"/>'
  },
  {
    name: 'mail',
    label: '更换邮箱',
    color: '#7c5cff',
    body: '<rect x="3" y="5.6" width="18" height="12.8" rx="2.6"/>' +
      '<path d="M3.8 7.4L12 12.9l8.2-5.5"/>'
  },
  {
    name: 'logout',
    label: '退出登录',
    color: '#f04438',
    body: '<path d="M14.2 4.6H7.6A2.6 2.6 0 0 0 5 7.2v9.6a2.6 2.6 0 0 0 2.6 2.6h6.6"/>' +
      '<path d="M17.4 8.6L20.8 12l-3.4 3.4"/>' +
      '<line x1="10.6" y1="12" x2="20.6" y2="12"/>'
  },
  {
    name: 'user',
    label: '用户',
    color: '#ffffff',
    body: '<circle cx="12" cy="8.6" r="3.9"/>' +
      '<path d="M4.9 20c.7-3.6 3.6-5.7 7.1-5.7s6.4 2.1 7.1 5.7"/>'
  }
]

function buildSvg(icon) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${icon.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${icon.body}</svg>`
}

function encodeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function buildBlock() {
  const rules = ICONS.map((icon, index) => {
    const url = `url("data:image/svg+xml;base64,${encodeBase64(buildSvg(icon))}")`
    const lines = [
      `/* ${icon.label} */`,
      `.mi-${icon.name} {`,
      `  background-image: ${url};`,
      `}`
    ]

    // 白色图标（头像）不需要浅色底，跳过底色块
    if (icon.name !== 'user') {
      lines.push('', `.mi-tile-${icon.name} {`, `  background: ${hexToRgba(icon.color, 0.12)};`, '}')
    }

    return lines.join('\n')
  })

  return [
    START_MARK,
    '/* 图标本体：24×24 描边网格，图形 40rpx，容器 68rpx 作为可点圆角方块 */',
    '.mi-icon {',
    '  width: 40rpx;',
    '  height: 40rpx;',
    '  background-repeat: no-repeat;',
    '  background-position: center;',
    '  background-size: 100% 100%;',
    '}',
    '',
    '.mi-tile {',
    '  flex: none;',
    '  width: 68rpx;',
    '  height: 68rpx;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  border-radius: 20rpx;',
    '}',
    '',
    rules.join('\n\n'),
    END_MARK
  ].join('\n')
}

function main() {
  const source = fs.readFileSync(TARGET, 'utf8')
  const block = buildBlock()
  const startIndex = source.indexOf(START_MARK)
  const endIndex = source.indexOf(END_MARK)
  let next = ''

  if (startIndex >= 0 && endIndex > startIndex) {
    next = source.slice(0, startIndex) + block + source.slice(endIndex + END_MARK.length)
  } else {
    next = `${source.replace(/\s+$/, '')}\n\n${block}\n`
  }

  fs.writeFileSync(TARGET, next, 'utf8')

  const bytes = ICONS.reduce((sum, icon) => sum + encodeBase64(buildSvg(icon)).length, 0)

  console.log(`已写入 ${ICONS.length} 个菜单图标 → ${path.relative(process.cwd(), TARGET)}`)
  console.log(`base64 总量约 ${(bytes / 1024).toFixed(1)} KB`)
  ICONS.forEach((icon) => {
    console.log(`  .mi-${icon.name}`.padEnd(20), icon.label)
  })
}

main()
