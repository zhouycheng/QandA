/**
 * 交互静态审计：把「点不动 / 点了没反馈」能离线查出来的都查一遍。
 *
 * 查四件事：
 *   1. WXML 里每个 bindtap / bind:xxx / catchtap 的处理函数，在对应 JS 里是否真的定义了
 *   2. WXML 里每个 hover-class 的类名，在同页面可达的 WXSS 里是否有定义
 *      （app.wxss 全局 + 页面自己的 wxss + 该页声明的组件 wxss）
 *   3. 带 bindtap 的元素是否被 wx:if 挡住（提示性，不算失败）
 *   4. 是否存在「隐藏但仍占位」的全屏浮层（opacity:0 / visibility 而非 wx:if）——这类会吃掉全部点击
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(path.resolve(__dirname, '..'), 'miniprogram')

let pass = 0
let fail = 0
const notes = []

function ok(t) {
  pass += 1
  console.log(`PASS  ${t}`)
}
function bad(t, detail) {
  fail += 1
  console.log(`FAIL  ${t}`)
  if (detail) console.log(`      ${detail}`)
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const all = walk(SRC)
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/')
const wxmls = all.filter((p) => p.endsWith('.wxml'))
const wxsss = all.filter((p) => p.endsWith('.wxss'))

// --- 收集全部 WXSS 里定义的类名 -------------------------------------------
const definedClasses = new Set()
const classOwner = new Map()
for (const f of wxsss) {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    definedClasses.add(m[1])
    if (!classOwner.has(m[1])) classOwner.set(m[1], rel(f))
  }
}

// --- 收集组件可见性实现方式 ------------------------------------------------
console.log('=== 1) bindtap 处理函数是否都有定义 ===\n')
const missingHandlers = []
const usedHoverClasses = new Map() // class -> [files]
const zeroGuard = []

for (const f of wxmls) {
  const src = fs.readFileSync(f, 'utf8')
  const jsPath = f.replace(/\.wxml$/, '.js')
  const jsSrc = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''

  // 动态事件绑定：排除 bind:xxx 里被组件 emit 的自定义事件（交由子组件处理）
  const handlers = new Set()
  for (const m of src.matchAll(/\bbind:?([a-zA-Z]+)\s*=\s*"([^"'{}]+)"/g)) {
    const kind = m[1].toLowerCase()
    if (['tap', 'longpress', 'longtap', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'input', 'change', 'confirm', 'submit', 'blur', 'focus', 'scroll', 'scrolltolower', 'load', 'error'].includes(kind)) {
      handlers.add(m[2].trim())
    }
  }
  for (const m of src.matchAll(/\bcatch:?([a-zA-Z]+)\s*=\s*"([^"'{}]+)"/g)) handlers.add(m[2].trim())

  const defined = new Set()
  // 方法定义：page 顶层 `foo() {}`、`foo: function () {}`，
  // 以及组件 methods 块内的 `foo() {}`（缩进是 4 空格，别再写死 2 空格）
  // ⚠️ 参数表要用 `\([^)\n]*\)` 而不是 `\([^)]*\)`：后者会跨行贪婪吞掉，
  //    让 `Component({ ... handleMaskTap() {` 里的方法名被当成前一个匹配的一部分而漏掉。
  for (const m of jsSrc.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*\([^)\n]*\)\s*\{/gm)) defined.add(m[1])
  for (const m of jsSrc.matchAll(/([a-zA-Z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function|\()/g)) defined.add(m[1])

  for (const h of handlers) {
    if (!defined.has(h)) missingHandlers.push(`${rel(f)} → ${h}()`)
  }

  // hover-class 收集
  for (const m of src.matchAll(/hover-class\s*=\s*"([^"{}]+)"/g)) {
    for (const cls of m[1].trim().split(/\s+/)) {
      if (!cls) continue
      if (!usedHoverClasses.has(cls)) usedHoverClasses.set(cls, [])
      usedHoverClasses.get(cls).push(rel(f))
    }
  }

  // 带点击但被 wx:if 关联的元素（提示）
  const lines = src.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/bind:?tap=/.test(line) && /wx:if=/.test(line)) {
      zeroGuard.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`)
    }
  })
}

if (missingHandlers.length === 0) ok('所有 bindtap / catchtap 的处理函数都能在对应 JS 里找到')
else bad(`${missingHandlers.length} 个处理函数找不到定义`, missingHandlers.join('\n      '))

console.log('\n=== 2) hover-class 类名是否都有样式定义 ===\n')
const missingHover = []
for (const [cls, files] of usedHoverClasses) {
  if (!definedClasses.has(cls)) missingHover.push(`.${cls}  ← 被引用于 ${[...new Set(files)].join(', ')}`)
}
if (missingHover.length === 0) {
  ok(`${usedHoverClasses.size} 个 hover 类名全部有样式定义`)
  console.log('      用到的类名：' + [...usedHoverClasses.keys()].join(', '))
} else {
  bad(`${missingHover.length} 个 hover 类名没有对应样式（点了不会有任何视觉变化）`, missingHover.join('\n      '))
}

console.log('\n=== 3) 是否存在「隐藏但仍占位」的全屏浮层 ===\n')
const riskyOverlay = []
for (const f of all.filter((p) => p.endsWith('.wxss'))) {
  const src = fs.readFileSync(f, 'utf8')
  const blocks = src.split('}')
  blocks.forEach((b, i) => {
    if (!/position\s*:\s*fixed/.test(b)) return
    const body = (blocks[i + 1] || '') + (blocks[i + 2] || '')
    const sel = b.slice(b.lastIndexOf('}') + 1).trim()
    if (/opacity\s*:\s*0(?!\.)/.test(body) || /visibility\s*:\s*hidden/.test(body)) {
      riskyOverlay.push(`${rel(f)} → ${sel.slice(0, 60)}`)
    }
  })
}
if (riskyOverlay.length === 0) ok('没有用 opacity:0/visibility:hidden 来藏全屏浮层（不会吃掉点击）')
else bad(`${riskyOverlay.length} 处可疑浮层`, riskyOverlay.join('\n      '))

console.log('\n=== 4) 浮层组件的显隐方式 ===\n')
for (const name of ['bottom-sheet', 'route-loading', 'question-overview-sheet']) {
  const f = path.join(SRC, 'components', name, 'index.wxml')
  if (!fs.existsSync(f)) continue
  const src = fs.readFileSync(f, 'utf8')
  const root = src.trim().split(/\r?\n/)[0]
  const usesIf = /wx:if=/.test(root)
  if (usesIf) ok(`${name} 根节点用 wx:if 控制显隐（隐藏时不占位、不吃点击）`)
  else bad(`${name} 根节点可能是常驻占位（隐藏时仍会拦截点击）`, root.slice(0, 120))
}

console.log('\n=== 附）带条件渲染的点击元素（非失败，供排查参考）===')
zeroGuard.forEach((l) => console.log(`      · ${l}`))

console.log('\n=== 5) 点击链路探针接入是否正确 ===\n')
// 起因：用脚本把 `Page({...})` 改成 `Page(wrapTaps({...}, '页名'))` 时，
// 很容易把收尾写成 `}), '页名')` —— 那样 '页名' 是传给 Page 的第二个参数，
// wrapTaps 根本收不到，日志里所有页面都会显示成默认的 `page`，
// 而语法完全合法、页面也能跑，属于「静默失效」。
const probeProblems = []
for (const f of all.filter((p) => p.endsWith('index.js') && p.includes(path.sep + 'page' + path.sep))) {
  const js = fs.readFileSync(f, 'utf8')
  if (!js.includes('wrapTaps(')) { probeProblems.push(`${rel(f)} 没接入 wrapTaps`); continue }
  if (!/Page\(\s*wrapTaps\(\{/.test(js)) probeProblems.push(`${rel(f)} 的 Page(wrapTaps({ 写法不对`)
  if (!/\},\s*'[^']+'\s*\)\s*\)/.test(js)) {
    probeProblems.push(`${rel(f)} 的页名没传给 wrapTaps（应为 Page(wrapTaps({...}, '页名')) ）`)
  }
}
if (probeProblems.length === 0) ok('7 个页面的点击探针接入正确，页名都传给了 wrapTaps')
else bad(`${probeProblems.length} 处探针接入有问题`, probeProblems.join('\n      '))

// --- 6) scroll-view 内的 hover 类不得带 transform --------------------------
// 起因：给全宽卡片 / 滚动区域内的元素加 scale 后，用户反馈「整个画面在抖动」——
// 一张接近满屏宽的卡片缩 3.5%，等于半屏内容同时位移；在 scroll-view 里
// 还会被基础库当成内容尺寸变化，滚动位置跟着跳。
// 这类反馈必须改用「背景色 + inset 描边」，几何上完全不动。
console.log('\n=== 6) scroll-view 内的按压反馈是否会产生位移 ===')
const shaking = []
for (const f of wxmls) {
  const src = fs.readFileSync(f, 'utf8')
  const lines = src.split('\n')
  // 逐行定位 <scroll-view ...> ... </scroll-view>（本工程无嵌套，按出现顺序配对即可）
  let inScroll = 0
  const scrollLines = new Set()
  lines.forEach((line, i) => {
    const opens = (line.match(/<scroll-view\b/g) || []).length
    const closes = (line.match(/<\/scroll-view>/g) || []).length
    if (inScroll > 0) scrollLines.add(i)
    if (opens) scrollLines.add(i)
    inScroll += opens - closes
    if (inScroll < 0) inScroll = 0
  })

  for (const i of scrollLines) {
    for (const m of lines[i].matchAll(/hover-class="([^"]+)"/g)) {
      const cls = m[1]
      const owner = classOwner.get(cls)
      if (!owner) continue
      const css = fs
        .readFileSync(path.join(SRC, owner), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // 取该类的规则体
      const idx = css.indexOf(`.${cls}`)
      if (idx < 0) continue
      const open = css.indexOf('{', idx)
      const close = css.indexOf('}', open)
      if (open < 0 || close < 0) continue
      const body = css.slice(open + 1, close)
      if (/transform\s*:/.test(body)) {
        shaking.push(`${rel(f)}:${i + 1} 的 hover-class="${cls}"（定义于 ${owner}）含 transform`)
      }
    }
  }
}
if (shaking.length === 0) {
  ok('滚动区域内的按压反馈都不产生几何位移（只改 opacity / 可插值属性）')
} else {
  bad(`${shaking.length} 处滚动区域内的按压反馈会让画面抖动`, shaking.join('\n      '))
  console.log('      改法：去掉 transform，改用 background-color + box-shadow: inset 描边')
}

// ---------------------------------------------------------------------------

console.log(`\n总计 ${pass + fail} 项，通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail ? 1 : 0)
