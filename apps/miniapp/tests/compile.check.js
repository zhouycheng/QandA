/**
 * 真实编译校验（离线跑微信官方编译器）。
 *
 * 起因：开发者工具报「编译 .wxss 文件错误，错误信息如上」，模拟器整屏白掉，
 * 但详情根本看不到——控制台里只有无关的游客模式警告。真因是 app.wxss 里用了
 * **通配符选择器 `*`**（`.stagger > *:nth-child(n)`），而 WXSS 编译器压根不支持 `*`：
 *
 *     ERR: app.wxss(143:12): error at token `*`
 *
 * 关键在于：**微信开发者工具的 wcsc / wcc 就是两个独立可执行文件**，直接命令行调用即可，
 * 不需要打开工具、不需要模拟器，几毫秒就能拿到带文件行列号的精确报错。
 * 这条路把「WXSS/WXML 编译错误」从"只能靠开发者工具黑盒提示"变成了可断言的自检项。
 *
 *     微信开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/
 *       wcsc.exe   → WXSS 编译器（-lc 开启 lint）
 *       wcc.exe    → WXML 编译器
 *
 * 本脚本守住两件事：
 *   1. 全部 .wxss 能被 wcsc 编译通过（含 lint）
 *   2. 全部 .wxml 能被 wcc 编译通过
 * 另外附两条不依赖编译器的兜底断言：
 *   - 源码里不得出现通配符选择器 `*`；
 *   - WXML 闭合标签里不得夹带属性（`</view hover-start-time="0">`）。
 *
 * 找不到编译器时打印 SKIP 并正常退出（换机器 / CI 上不该因此失败）。
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')

let passed = 0
let failed = 0

function assert(title, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS  ${title}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${title}`)
  if (detail) console.log(`      ${detail}`)
}

/** 找到微信开发者工具自带的编译器目录（wcc-exec） */
function locateWcc() {
  const fromEnv = process.env.WX_WCC_DIR
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  const candidates = [
    'D:/Program Files x86/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec',
    'C:/Program Files (x86)/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec',
    'C:/Program Files/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec',
    'D:/Program Files/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec',
    '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec',
    path.join(process.env.HOME || '', 'Library/Application Support/微信web开发者工具/wcc-exec'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'wcsc.exe')) || fs.existsSync(path.join(dir, 'wcsc'))) {
      return dir
    }
  }
  return null
}

/** 递归收集指定扩展名的文件，返回相对 SRC 的 posix 路径 */
function collect(dir, ext) {
  const out = []
  ;(function walk(current) {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name)
      if (fs.statSync(full).isDirectory()) {
        walk(full)
      } else if (name.endsWith(ext)) {
        out.push(path.relative(SRC, full).split(path.sep).join('/'))
      }
    }
  })(dir)
  return out.sort()
}

/** 兼容 Windows 与 *nix 的可执行文件名 */
function exePath(dir, base) {
  const win = path.join(dir, `${base}.exe`)
  return fs.existsSync(win) ? win : path.join(dir, base)
}

/** 跑一个编译器，返回 stdout（出错也不抛） */
function runCompiler(bin, args) {
  try {
    return execFileSync(bin, args, {
      cwd: SRC,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`
  }
}

// ---------------------------------------------------------------------------

console.log('=== 离线编译校验（wcsc / wcc）===\n')

const wccDir = locateWcc()

if (!wccDir) {
  console.log('SKIP  未找到微信开发者工具自带的编译器（wcc-exec 目录）')
  console.log('      可用环境变量 WX_WCC_DIR 指定，例如：')
  console.log('      WX_WCC_DIR="/d/Program Files x86/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec"')
  console.log('\n跳过离线编译校验，退出码 0。')
  process.exit(0)
}

console.log(`编译器目录：${wccDir}\n`)

const wxssFiles = collect(SRC, '.wxss')
const wxmlFiles = collect(SRC, '.wxml')

console.log('--- WXSS ---')
const wxssOut = runCompiler(exePath(wccDir, 'wcsc'), ['-lc', ...wxssFiles])
const wxssErrs = wxssOut
  .split(/\r?\n/)
  .filter((line) => /^ERR[:\s]/.test(line) || /error at token/.test(line))

assert(
  `${wxssFiles.length} 个 .wxss 全部编译通过`,
  wxssErrs.length === 0,
  wxssErrs.slice(0, 10).join('\n      ')
)

console.log('\n--- WXML ---')
const wxmlOut = runCompiler(exePath(wccDir, 'wcc'), wxmlFiles)
// wcc 把报错写在一行 JSON 里，形如 {"error": ...} / "errMsg"
const wxmlErrs = wxmlOut
  .split(/\r?\n/)
  .filter((line) => /WXML_ERR|"errMsg"\s*:|Compile\s*error/i.test(line))

assert(
  `${wxmlFiles.length} 个 .wxml 全部编译通过`,
  wxmlErrs.length === 0,
  wxmlErrs.slice(0, 10).join('\n      ')
)

// ---------------------------------------------------------------------------
// 兜底：不依赖编译器的静态断言，报错信息比「编译失败」友好得多

console.log('\n--- 通配符选择器兜底扫描 ---')

/** 抽出所有规则的「选择器部分」，检查是否出现 WXSS 不支持的通配符 `*` */
function findUniversalSelector(src) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const hits = []
  const re = /(^|[{};])\s*([^{};]*?)\{/g
  let m
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[2].trim()
    if (!selector) continue
    if (/(^|[\s>+~])\*/.test(selector)) hits.push(selector.slice(0, 70))
  }
  return hits
}

const badSelectors = []
for (const rel of wxssFiles) {
  const hits = findUniversalSelector(fs.readFileSync(path.join(SRC, rel), 'utf8'))
  hits.forEach((sel) => badSelectors.push(`${rel} → ${sel}`))
}

assert(
  '没有使用通配符选择器 `*`（WXSS 会在该 token 处直接编译失败）',
  badSelectors.length === 0,
  `${badSelectors.join('\n      ')}\n      改法：写成 .parent > view:nth-child(n)，显式列出子元素标签`
)

// ---------------------------------------------------------------------------
// 兜底：WXML 闭合标签里夹带属性
//
// 起因：批量给元素补 `hover-start-time="0" hover-stay-time="200"` 时，脚本没判断上一行
// 是否以 `>` 结尾，把属性写到了 <view ...>内容</view 后面，变成：
//
//     <view class="confirm-btn" bindtap="handleConfigConfirm">确认</view hover-start-time="0" hover-stay-time="200">
//
// wcc 的报错只有一句「unexpected token, near 'hover-s'」，不给上下文；模拟器则直接白屏，
// 页面里所有绑定全部失效——表现出来就是「只有原生 tabBar 能点，页面内点哪儿都没反应」。
// 合法的闭合标签必须严格是 `</tag>`，内部不允许出现任何空白。

console.log('\n--- WXML 闭合标签夹带属性扫描 ---')

const misclosed = []
for (const rel of wxmlFiles) {
  const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/<\/[a-zA-Z][\w-]*\s[^>]*>/.test(line)) {
      misclosed.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`)
    }
  })
}

assert(
  '没有属性被写到闭合标签里（会导致整页 WXML 编译失败、页面内事件全部失效）',
  misclosed.length === 0,
  `${misclosed.join('\n      ')}\n      改法：把属性挪到开标签的 \`>\` 之前，闭合标签只保留 </tag>`
)

// ---------------------------------------------------------------------------

console.log(`\n总计 ${passed + failed} 项，通过 ${passed} 项，失败 ${failed} 项`)

process.exit(failed ? 1 : 0)
