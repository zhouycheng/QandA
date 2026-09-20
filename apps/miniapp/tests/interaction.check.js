/**
 * 交互完整性自检。
 *
 * 起因：用户反馈「每个页面的交互都不起作用、点击很生硬」。真因不是逻辑坏了，
 * 而是答题页 / 题库页 / 错题本页的大量可点元素压根没写 hover-class——
 * 点下去界面毫无反应，用户自然判定为「功能失效」。
 *
 * 这类问题在开发者工具里**不会报错也不日志**：WXML 少写一个 hover-class 属性，
 * 编译照过、功能照走，只是没有视觉反馈。所以必须静态扫。
 *
 * 这里守住三件事：
 *   1. 每个可点元素必须有按压反馈（遮罩层除外）
 *   2. 引用的 hover-class 必须在 wxss 里真的有定义（写错类名同样静默失效）
 *   3. 开了 enablePullDownRefresh 的页面必须实现 onPullDownRefresh（否则下拉只弹回、不刷新）
 */

const fs = require('fs')
const path = require('path')

const MINIPROGRAM_ROOT = path.resolve(__dirname, '..', 'miniprogram')

let passed = 0
let failed = 0

function assert(title, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS  ${title}`)
    return
  }

  failed += 1
  console.log(`FAIL  ${title}${detail ? ` -> ${detail}` : ''}`)
}

function walk(dir, extensions, collected) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      walk(fullPath, extensions, collected)
      return
    }

    if (extensions.some((extension) => entry.name.endsWith(extension))) {
      collected.push(fullPath)
    }
  })

  return collected
}

/** 去掉注释，避免注释里的示例代码被当成真实标签 */
function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 取出所有带事件的开标签。
 * 只处理 <view>，因为本项目所有可点元素都是 view 实现的。
 */
function extractClickableTags(wxmlPath) {
  const source = stripComments(fs.readFileSync(wxmlPath, 'utf8'))
  const tags = []
  const tagPattern = /<view\b[\s\S]*?>/g
  let matched = tagPattern.exec(source)

  while (matched) {
    const tag = matched[0]

    if (/bindtap=|catchtap=/.test(tag)) {
      tags.push(tag)
    }

    matched = tagPattern.exec(source)
  }

  return tags
}

function getAttribute(tag, name) {
  const matched = tag.match(new RegExp(`${name}="([^"]*)"`))

  return matched ? matched[1] : ''
}

/** 遮罩层不需要按压反馈：给它加缩放会让背景抖，观感更差 */
function isMask(tag) {
  const className = getAttribute(tag, 'class')

  return /mask|overlay|backdrop/.test(className)
}

function collectWxssClasses() {
  const files = [
    path.join(MINIPROGRAM_ROOT, 'app.wxss'),
    ...walk(path.join(MINIPROGRAM_ROOT, 'page'), ['.wxss'], []),
    ...walk(path.join(MINIPROGRAM_ROOT, 'components'), ['.wxss'], [])
  ]

  const classes = new Set()

  files.forEach((file) => {
    if (!fs.existsSync(file)) {
      return
    }

    const source = fs.readFileSync(file, 'utf8')
    // 匹配选择器里出现的任意 .class，够用且不依赖格式化风格
    const classPattern = /\.([a-zA-Z][\w-]*)/g
    let matched = classPattern.exec(source)

    while (matched) {
      classes.add(matched[1])
      matched = classPattern.exec(source)
    }
  })

  return classes
}

console.log('=== 按压反馈覆盖 ===')

const wxmlFiles = [
  ...walk(path.join(MINIPROGRAM_ROOT, 'page'), ['.wxml'], []),
  ...walk(path.join(MINIPROGRAM_ROOT, 'components'), ['.wxml'], [])
]

const missingFeedback = []
const referencedHoverClasses = new Set()

wxmlFiles.forEach((file) => {
  const relative = path.relative(MINIPROGRAM_ROOT, file)

  extractClickableTags(file).forEach((tag) => {
    const hoverClass = getAttribute(tag, 'hover-class')

    if (hoverClass) {
      referencedHoverClasses.add(hoverClass)
      return
    }

    if (!isMask(tag)) {
      missingFeedback.push(`${relative} :: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`)
    }
  })
})

assert(
  '所有可点元素都有 hover-class（遮罩层除外）',
  missingFeedback.length === 0,
  missingFeedback.join(' | ')
)

console.log('\n=== hover-class 定义存在性 ===')

const definedClasses = collectWxssClasses()
const undefinedHovers = []

referencedHoverClasses.forEach((hoverClass) => {
  if (!definedClasses.has(hoverClass)) {
    undefinedHovers.push(hoverClass)
  }
})

assert(
  `引用的 ${referencedHoverClasses.size} 个 hover 类都在 wxss 中有定义`,
  undefinedHovers.length === 0,
  `未定义：${undefinedHovers.join(', ')}`
)

console.log('\n=== 下拉刷新闭环 ===')

const pageDirs = walk(path.join(MINIPROGRAM_ROOT, 'page'), [], [])
  .map((file) => path.dirname(file))
  .filter((dir, index, all) => all.indexOf(dir) === index)

const brokenPullDown = []

pageDirs.forEach((dir) => {
  const jsonPath = path.join(dir, 'index.json')
  const jsPath = path.join(dir, 'index.js')
  const name = path.basename(dir)

  if (!fs.existsSync(jsonPath) || !fs.existsSync(jsPath)) {
    return
  }

  const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

  if (!config.enablePullDownRefresh) {
    return
  }

  const source = fs.readFileSync(jsPath, 'utf8')

  if (!/onPullDownRefresh\s*\(/.test(source)) {
    brokenPullDown.push(`${name}（开了下拉刷新但没实现 onPullDownRefresh）`)
  }

  if (!/stopPullDownRefresh/.test(source)) {
    brokenPullDown.push(`${name}（没调用 stopPullDownRefresh，刷新指示器不会收回去）`)
  }
})

assert(
  '开启下拉刷新的页面都有完整实现',
  brokenPullDown.length === 0,
  brokenPullDown.join(' | ')
)

console.log('\n=== 过渡动画基础 ===')

const appWxss = fs.readFileSync(path.join(MINIPROGRAM_ROOT, 'app.wxss'), 'utf8')

assert(
  '全局基类上挂了 transition（保证按下与回弹都是连续曲线）',
  /transition:\s*transform/.test(appWxss),
  'app.wxss 缺少 transition 兜底'
)

assert(
  '定义了入场动画 keyframes',
  /@keyframes\s+qanda-fade-up/.test(appWxss) && /@keyframes\s+qanda-pop-in/.test(appWxss)
)

assert('定义了错峰延迟 stagger', /\.stagger\s*>/.test(appWxss))

console.log(`\n总计 ${passed + failed} 项，通过 ${passed} 项，失败 ${failed} 项`)

process.exit(failed ? 1 : 0)
