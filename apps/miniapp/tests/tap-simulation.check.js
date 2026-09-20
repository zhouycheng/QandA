/**
 * 页面级点击模拟：不开开发者工具、不需要服务端口，在 Node 里把每个页面的 JS
 * 装进一个假运行时，按 WXML 里写的 bindtap 逐个触发，看它到底有没有「反应」。
 *
 * 「反应」的定义：调用了 setData、发起了跳转（navigateTo / switchTab / redirectTo）、
 * 弹了 Toast / Modal、或写了 storage。四者都没有 → 记为该次点击「无动作」。
 *
 * 为什么需要它：用户报「只有原生 tabBar 能点，页面里点哪儿都没反应」，而静态检查
 * （编译 / 绑定 / 组件注册）全绿。静态只能证明「函数存在」，证明不了「点了会动」，
 * 所以必须把页面真跑起来点一遍。
 *
 * 判定分三档：
 *   FAIL  MISSING（WXML 绑了函数但 JS 里没有）/ THROW（处理函数抛错）—— 真问题
 *   WARN  函数跑了但当前数据状态下提前 return —— 绝大多数是"空数据守卫"
 *         （错题本为空、已在第一题、没有上次练习记录…），需要人工确认不是逻辑写错
 *   OK    产生了 setData / 跳转 / storage / Toast
 *
 * 四个实现细节（都是踩过坑才补上的）：
 *   1. `{{item.id}}` 必须按 **最近的 wx:for 作用域** 解析。页面上往往有多个
 *      `{{item.value}}`（countOptions / durationOptions / modeOptions），
 *      不按作用域取就会拿错数组，产生大量假阳性。
 *   2. **`data-subject-id` 在运行时是 `dataset.subjectId`**（连字符转驼峰）。
 *      漏掉这一步，处理函数读到的全是 undefined，会把正常按钮全判成无反应。
 *   3. 嵌套 `wx:for` + `wx:for-item="option"` 时，`{{item.key}}` 指的是 **外层** 循环，
 *      内层要用 `{{option.value}}`。要按 itemName 分别回查对应的作用域。
 *   4. 同一个点击目标要在 wx:for 的 **多个下标** 上尝试：第 0 项常常正好是
 *      "当前选中项"或"不可用态"（如「上一题」在第一题是灰的）。
 *
 * 用法：node tests/tap-simulation.check.js
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(path.resolve(__dirname, '..'), 'miniprogram')

let pass = 0
let fail = 0
const warns = []
const ok = (t) => { pass += 1; console.log(`PASS  ${t}`) }
const bad = (t, d) => { fail += 1; console.log(`FAIL  ${t}`); if (d) console.log(`      ${d}`) }
const warn = (t) => { console.log(`WARN  ${t}`) }

const MAX_INDEX = 6

// ---------------------------------------------------------------------------
// 假运行时
// ---------------------------------------------------------------------------

function makeRuntime() {
  const store = {}
  const calls = []

  const wx = {
    getStorageSync(k) { return store[k] !== undefined ? store[k] : '' },
    setStorageSync(k, v) { store[k] = v; calls.push(`写storage(${k})`) },
    removeStorageSync(k) { delete store[k]; calls.push(`删storage(${k})`) },
    getStorageInfoSync() { return { keys: Object.keys(store), currentSize: 0, limitSize: 10240 } },
    navigateTo(o) { calls.push(`navigateTo(${o && o.url})`) },
    redirectTo(o) { calls.push(`redirectTo(${o && o.url})`) },
    reLaunch(o) { calls.push(`reLaunch(${o && o.url})`) },
    switchTab(o) { calls.push(`switchTab(${o && o.url})`) },
    navigateBack() { calls.push('navigateBack') },
    showToast(o) { calls.push(`toast(${o && o.title})`) },
    showLoading(o) { calls.push(`showLoading(${o && o.title})`) },
    hideLoading() { calls.push('hideLoading') },
    showModal(o) {
      calls.push(`modal(${o && o.title})`)
      if (o && o.success) o.success({ confirm: true, cancel: false })
    },
    showActionSheet(o) {
      calls.push('actionSheet()')
      if (o && o.success) o.success({ tapIndex: 0 })
    },
    setNavigationBarTitle(o) { calls.push(`标题(${o && o.title})`) },
    stopPullDownRefresh() { calls.push('stopPullDownRefresh') },
    getSystemInfoSync() { return { platform: 'devtools', windowWidth: 375, windowHeight: 667, SDKVersion: '3.15.2' } },
    getSystemInfo(o) { if (o && o.success) o.success({ platform: 'devtools' }) },
    vibrateShort() { calls.push('vibrateShort') },
    getAppBaseInfo() { return { SDKVersion: '3.15.2', theme: 'light' } },
    onThemeChange() {},
  }

  const app = {
    globalData: { version: 'v1-mock-snapshot', pendingSubjectId: '' },
    setPendingSubjectId(id) { this.globalData.pendingSubjectId = id || '' },
    consumePendingSubjectId() {
      const id = this.globalData.pendingSubjectId || ''
      this.globalData.pendingSubjectId = ''
      return id
    },
  }

  return { store, calls, wx, app }
}

// ---------------------------------------------------------------------------
// 极简 WXML 扫描：取出所有标签（支持 {{}} 内含 > 的表达式）并维护作用域栈
// ---------------------------------------------------------------------------

const VOIDISH = new Set(['image', 'input', 'slot', 'icon', 'progress', 'br'])

function scanTags(src) {
  const tags = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue }
    let j = lt + 1
    let quote = null
    while (j < src.length) {
      const c = src[j]
      if (quote) { if (c === quote) quote = null; j += 1; continue }
      if (c === '"' || c === "'") { quote = c; j += 1; continue }
      if (src.startsWith('{{', j)) {
        const e = src.indexOf('}}', j + 2)
        if (e < 0) { j += 2; continue }
        j = e + 2
        continue
      }
      if (c === '>') break
      j += 1
    }
    if (j >= src.length) break
    tags.push(src.slice(lt, j + 1))
    i = j + 1
  }
  return tags
}

function attrsOf(tag) {
  const out = {}
  for (const m of tag.matchAll(/([a-zA-Z][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

const tagNameOf = (tag) => (/^<\/?\s*([a-zA-Z][\w-]*)/.exec(tag) || ['', ''])[1]

/** 解析 WXML 里的点击目标；frames = 由内到外的 [{ itemName, wxFor }] 作用域链 */
function extractTaps(wxmlPath) {
  const src = fs.readFileSync(wxmlPath, 'utf8')
  const flat = src.replace(/\s+/g, ' ')
  const out = []
  const stack = []

  for (const tag of scanTags(src)) {
    const name = tagNameOf(tag)
    if (/^<\//.test(tag)) { stack.pop(); continue }

    const a = attrsOf(tag)
    const selfClosed = /\/>$/.test(tag)
    const ownFor = a['wx:for']
    const ownItemName = a['wx:for-item'] || 'item'
    if (!selfClosed && !VOIDISH.has(name)) stack.push({ name, wxFor: ownFor, itemName: ownItemName })

    const handler = a.bindtap || a['bind:tap'] || a.catchtap || a['catch:tap']
    if (!handler) continue

    // 由内到外的作用域链：自身优先，然后逐级向上（只保留真正带 wx:for 的层）
    const frames = []
    if (ownFor) frames.push({ itemName: ownItemName, wxFor: ownFor })
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      const f = stack[k]
      if (f.wxFor && !(f.wxFor === ownFor && f.itemName === ownItemName)) {
        frames.push({ itemName: f.itemName, wxFor: f.wxFor })
      }
    }

    const dataset = {}
    // ⚠️ `data-subject-id` 在运行时是 `dataset.subjectId`（连字符转驼峰）
    for (const [k, v] of Object.entries(a)) {
      if (!k.startsWith('data-')) continue
      dataset[k.slice(5).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())] = v
    }

    const line = flat === src ? src.split(/\r?\n/).findIndex((l) => l.includes(tag.slice(0, 30))) + 1 : 0
    out.push({ handler, dataset, line, frames, wxFor: frames.length ? frames[0].wxFor : '' })
  }
  return out
}

/** `{{banks}}` → 'banks'；`{{item.value}}` / `{{option.value}}` → null（依赖作用域） */
function arrayExprOf(expr) {
  const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(String(expr || '').trim())
  if (!m) return null
  const e = m[1]
  if (e === 'item' || e === 'index') return null
  return e
}

function pickByPath(data, dotted) {
  let cur = data
  for (const seg of dotted.split('.')) cur = cur == null ? undefined : cur[seg]
  return cur
}

function firstArrayItem(data) {
  const arr = Object.values(data || {}).find((v) => Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object')
  return arr || []
}

/** 按作用域链解析 data-* 的值；ctxMap 形如 { item: {...}, option: {...} } */
function resolveDataset(dataset, data, ctxMap) {
  const out = {}
  for (const [k, raw] of Object.entries(dataset)) {
    const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(String(raw).trim())
    if (!m) { out[k] = raw; continue }
    const expr = m[1]
    const dot = expr.indexOf('.')
    if (dot > 0 && ctxMap[expr.slice(0, dot)]) {
      out[k] = ctxMap[expr.slice(0, dot)][expr.slice(dot + 1)]
      continue
    }
    const v = pickByPath(data, expr)
    out[k] = v === undefined ? '' : v
  }
  return out
}

/** 该点击目标最内层作用域对应的数组（用于决定遍历多少个下标） */
function innerList(data, tap) {
  if (!tap.frames.length) return firstArrayItem(data)
  const path0 = arrayExprOf(tap.frames[0].wxFor)
  const arr = path0 ? pickByPath(data, path0) : null
  return Array.isArray(arr) && arr.length ? arr : firstArrayItem(data)
}

// ---------------------------------------------------------------------------

const PAGE_DIRS = fs
  .readdirSync(path.join(SRC, 'page'))
  .filter((d) => fs.existsSync(path.join(SRC, 'page', d, 'index.js')))

console.log('=== 页面点击模拟（离线，逐个触发 WXML 里的 bindtap）===\n')

const perPage = []

for (const dir of PAGE_DIRS) {
  const jsPath = path.join(SRC, 'page', dir, 'index.js')
  const wxmlPath = path.join(SRC, 'page', dir, 'index.wxml')
  const { wx, app, calls } = makeRuntime()

  for (const key of Object.keys(require.cache)) if (key.startsWith(SRC)) delete require.cache[key]

  let options = null
  global.Page = (o) => { options = o }
  global.Component = (o) => o
  global.App = (o) => o
  global.wx = wx
  global.getApp = () => app

  try { require(jsPath) } catch (e) { bad(`${dir} 页面 JS 加载失败`, e.message); continue }
  if (!options) { bad(`${dir} 没有调用 Page()`); continue }

  const data = JSON.parse(JSON.stringify(options.data || {}))
  const setDataLog = []
  const inst = Object.assign(Object.create(null), options, {
    data,
    setData(patch) {
      setDataLog.push(Object.keys(patch || {}).join(','))
      Object.assign(data, patch || {})
    },
  })

  try {
    if (typeof options.onLoad === 'function') options.onLoad.call(inst, {})
    if (typeof options.onShow === 'function') options.onShow.call(inst, {})
  } catch (e) {
    bad(`${dir} onLoad/onShow 抛错`, e.message)
    continue
  }

  const taps = fs.existsSync(wxmlPath) ? extractTaps(wxmlPath) : []
  const results = []

  for (const tap of taps) {
    const fn = inst[tap.handler]
    if (typeof fn !== 'function') { results.push({ tap, state: 'MISSING' }); continue }

    const list = innerList(data, tap)
    const attempts = Math.min(Math.max(list.length, 1), MAX_INDEX)
    let hit = null
    let threw = null

    for (let idx = 0; idx < attempts; idx += 1) {
      const ctxMap = {}
      for (const f of tap.frames) {
        const p = arrayExprOf(f.wxFor)
        const arr = p ? pickByPath(data, p) : null
        if (Array.isArray(arr) && arr[idx]) ctxMap[f.itemName] = arr[idx]
        else if (Array.isArray(arr) && arr[0]) ctxMap[f.itemName] = arr[0]
      }
      const dataset = resolveDataset(tap.dataset, data, ctxMap)
      const detail = {}
      for (const key of ['banks', 'items', 'subjects']) {
        if (Array.isArray(data[key]) && data[key].length) detail[key.slice(0, -1)] = data[key][0]
      }
      const before = { s: setDataLog.length, c: calls.length }
      try {
        fn.call(inst, { currentTarget: { dataset }, detail, target: { dataset } })
      } catch (e) {
        threw = e.message
        continue
      }
      if (setDataLog.length > before.s || calls.length > before.c) {
        hit = { idx, diff: setDataLog.slice(before.s).join(' | '), calls: calls.slice(before.c).join(' | ') }
        break
      }
    }

    if (hit) results.push({ tap, state: 'OK', ...hit })
    else if (threw) results.push({ tap, state: 'THROW', msg: threw })
    else results.push({ tap, state: 'GUARDED' })
  }

  const hard = results.filter((r) => r.state === 'MISSING' || r.state === 'THROW')
  const soft = results.filter((r) => r.state === 'GUARDED')
  perPage.push({ dir, results })

  if (results.length === 0) ok(`${dir} 没有可点击元素`)
  else if (hard.length === 0 && soft.length === 0) ok(`${dir} —— ${results.length} 个点击目标全部有反应`)
  else if (hard.length === 0) {
    pass += 1
    console.log(`PASS  ${dir} —— ${results.length - soft.length}/${results.length} 个有反应，${soft.length} 个被空数据守卫拦住`)
    soft.forEach((r) => {
      warns.push(`${dir}/index.wxml:${r.tap.line} ${r.tap.handler}()`)
      console.log(`      · ${r.tap.handler}()  当前数据下提前 return`)
    })
  } else {
    bad(`${dir} —— ${hard.length} 个点击目标接不上`)
    hard.forEach((r) => console.log(`      · ${r.tap.handler}()  [${r.state}]${r.msg ? ' ' + r.msg : ''}`))
  }
}

console.log('\n=== 明细（触发后的实际动作；#n 表示命中的 wx:for 下标）===')
for (const p of perPage) {
  console.log(`\n--- ${p.dir} (${p.results.length} 个) ---`)
  for (const r of p.results) {
    if (r.state !== 'OK') {
      console.log(`  !!  ${r.tap.handler}()  →  [${r.state}] ${r.msg || '空数据下提前 return'}`)
      continue
    }
    const short = (s) => {
      if (!s) return ''
      const parts = s.split(' | ')
      return parts.length > 3 ? `${parts.slice(0, 3).join(' | ')} … (+${parts.length - 3})` : s
    }
    const act = [r.diff && `setData: ${short(r.diff)}`, short(r.calls)].filter(Boolean).join('  ')
    console.log(`  ok  ${r.tap.handler}()#${r.idx}  →  ${act}`)
  }
}

if (warns.length) {
  console.log('\n=== 需要人工确认的「空数据守卫」（WARN）===')
  warns.forEach((w) => console.log(`  · ${w}`))
  console.log('  说明：这些是 WXML 里接好的点击，只是在全新数据下会提前 return。')
  console.log('        多半是合理守卫（错题本为空 / 已在第一题 / 没有上次练习记录），')
  console.log('        但也要排除"条件永远为假导致按钮永远点不动"的写法。')
}

console.log(`\n总计 ${pass + fail} 项，通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail ? 1 : 0)
