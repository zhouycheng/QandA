/**
 * 一次性脚本：把 utils/tap-trace.js 的 wrapTaps 接进 7 个页面。
 * 结构是确定的（页面 JS 一律「require 头 + Page({...})」），所以可以安全改写：
 *   1. 在 require 头部之后插入 wrapTaps 的 require
 *   2. `Page({`            → `Page(wrapTaps({`
 *   3. 文件中最后一个 `})` → `}), '<pageName>')`
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(path.resolve(__dirname, '..'), 'miniprogram')
const BACKUP = path.join(path.resolve(__dirname, '..'), '.tap-trace-backup')

const PAGES = ['subject-list', 'bank-detail', 'stats', 'practice', 'my', 'wrong-book', 'settings']

fs.mkdirSync(BACKUP, { recursive: true })

const report = []

for (const name of PAGES) {
  const file = path.join(SRC, 'page', name, 'index.js')
  const original = fs.readFileSync(file, 'utf8')

  fs.writeFileSync(path.join(BACKUP, `${name}.index.js`), original)

  if (original.includes('tap-trace.js')) {
    report.push(`${name}: 已接入，跳过`)
    continue
  }

  const lines = original.split('\n')

  // 1) 插到 require 头部之后
  let lastRequireAt = -1
  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    if (/^\s*const\b.*require\(/.test(lines[i])) lastRequireAt = i
  }
  if (lastRequireAt < 0) {
    report.push(`${name}: !! 找不到 require 头部，跳过`)
    continue
  }
  lines.splice(lastRequireAt + 1, 0, "const { wrapTaps } = require('../../utils/tap-trace.js')")

  const text = lines.join('\n')

  // 2) 包住 Page({ ... })
  const pageIdx = text.indexOf('Page({')
  if (pageIdx < 0) {
    report.push(`${name}: !! 找不到 Page({，跳过`)
    continue
  }
  let patched = text.slice(0, pageIdx) + 'Page(wrapTaps({' + text.slice(pageIdx + 'Page({'.length)

  // 3) 收尾：最后一个顶格 `})` 要改成 `}, '<name>'))`
  //    ⚠️ 不能写成 `}), '<name>')` —— 那样页名会被当成 Page() 的第二个参数，
  //    wrapTaps 收不到，日志里所有页面都显示默认名，且完全静默。
  const outLines = patched.split('\n')
  let done = false
  for (let i = outLines.length - 1; i >= 0; i -= 1) {
    if (/^\}\)\s*$/.test(outLines[i])) {
      outLines[i] = `}, '${name}'))`
      done = true
      break
    }
  }
  if (!done) {
    report.push(`${name}: !! 找不到收尾的 }) ，未写入`)
    continue
  }
  patched = outLines.join('\n')

  fs.writeFileSync(file, patched)
  report.push(`${name}: 已接入 wrapTaps`)
}

console.log(report.join('\n'))
console.log(`\n备份目录：${BACKUP}`)
