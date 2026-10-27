/**
 * 自定义 tabBar（胶囊 + 中央「继续答题」） —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/custom-tabbar.check.js
 *
 * 自定义 tabBar 有三个只有它能踩、内置 tabBar 不会踩的坑，这里逐条锁死：
 *   1. **选中态不会自动跟随页面**。改成 custom 之后基础库不再维护 selected，
 *      必须由每个 tab 页的 onShow 主动调 getTabBar().setSelected()。
 *      少一个页面就会出现「人在题库、底栏高亮首页」。
 *   2. **中央按钮的去向必须与首页一致**。首页「继续上次练习」和底部按钮都读
 *      getResumableSession，不能一个说有半场练习、另一个直接跳题库。
 *   3. **中央按钮会挤占 tab 宽度**。它是绝对定位浮在胶囊上，
 *      必须给第 3 个 tab 让出右边距，否则 4 个 tab 被压成不等宽。
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const read = (relative) => fs.readFileSync(path.join(MINIPROGRAM, relative), 'utf8')
const readJson = (relative) => JSON.parse(read(relative))

/**
 * 读 wxss 并把 @import 的内容就地展开。
 * 页面把公共尺寸抽到 styles/*.wxss 之后，只读页面文件会漏掉真正的留白值。
 */
function readWithImports(relative, depth) {
  const source = read(relative)
  const level = Number(depth) || 0

  if (level > 3) {
    return source
  }

  return source.replace(/@import\s+"([^"]+)";/g, (whole, target) => {
    const resolved = path.relative(MINIPROGRAM, path.resolve(path.join(MINIPROGRAM, path.dirname(relative)), target))

    try {
      return readWithImports(resolved, level + 1)
    } catch (error) {
      return ''
    }
  })
}

const tabBarJs = read('custom-tab-bar/index.js')
const tabBarWxml = read('custom-tab-bar/index.wxml')
const tabBarWxss = read('custom-tab-bar/index.wxss')
const appJson = readJson('app.json')

const results = []

function assert(name, condition, detail) {
  results.push({ name, passed: !!condition, detail: condition ? '' : detail || '' })
}

// ---------- 一、配置 ----------

function checkConfig() {
  const tabBar = appJson.tabBar || {}

  assert('配置 - app.json 声明 custom:true', tabBar.custom === true)
  assert('配置 - 仍保留 4 个 tab 的 list', Array.isArray(tabBar.list) && tabBar.list.length === 4,
    `实际 ${tabBar.list ? tabBar.list.length : 0} 个`)

  const pagePaths = appJson.pages
  const notRegistered = tabBar.list.filter((item) => pagePaths.indexOf(item.pagePath) < 0)

  assert('配置 - 所有 tab 页都在 pages 中注册', notRegistered.length === 0,
    notRegistered.map((item) => item.pagePath).join(', '))

  const missingIcons = tabBar.list.filter((item) =>
    !fs.existsSync(path.join(MINIPROGRAM, item.iconPath)) ||
    !fs.existsSync(path.join(MINIPROGRAM, item.selectedIconPath)))

  assert('配置 - 图标文件都真实存在', missingIcons.length === 0,
    missingIcons.map((item) => item.iconPath).join(', '))

  // custom-tab-bar 必须四件套齐全且放在小程序根目录（不在 miniprogram 子目录下）
  assert('配置 - custom-tab-bar 位于小程序根目录',
    fs.existsSync(path.join(MINIPROGRAM, 'custom-tab-bar/index.js')))
  ;['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    assert(`配置 - custom-tab-bar/index.${ext} 存在`,
      fs.existsSync(path.join(MINIPROGRAM, `custom-tab-bar/index.${ext}`)))
  })

  assert('配置 - 组件开启样式共享（才能吃到 app.wxss 的通用类）',
    tabBarJs.indexOf('styleIsolation') >= 0)
}

// ---------- 二、选中态同步（最易漏） ----------

function checkSelectionSync() {
  const tabPaths = appJson.tabBar.list.map((item) => item.pagePath)
  const notSynced = []

  tabPaths.forEach((pagePath) => {
    // app.json 里的 'page/subject-list/index' 指的就是 page/subject-list/index.js，
    // 不是 page/subject-list/index/index.js —— 拼错会全部误报「缺少 index.js」
    const jsPath = path.join(MINIPROGRAM, `${pagePath}.js`)

    if (!fs.existsSync(jsPath)) {
      notSynced.push(`${pagePath} 缺少 index.js`)
      return
    }

    const source = fs.readFileSync(jsPath, 'utf8')
    const withoutSlash = pagePath.replace(/^\//, '')

    // 三个条件缺一不可：onShow 里调、调的是 syncTabBar、路由参数与自己在 list 里的路径一致
    const hasOnShow = /\bonShow\s*\(/.test(source)
    const getsTabBar = /getTabBar\(\)/.test(source)
    const setsRoute = source.indexOf(`'${withoutSlash}'`) >= 0 || source.indexOf(`"${withoutSlash}"`) >= 0

    if (!hasOnShow || !getsTabBar || !setsRoute) {
      notSynced.push(`${pagePath}（onShow:${hasOnShow} getTabBar:${getsTabBar} route:${setsRoute}）`)
    }
  })

  assert('选中态 - 4 个 tab 页都在 onShow 同步底栏', notSynced.length === 0, notSynced.join(' | '))

  assert('选中态 - 组件暴露 setSelected', /\bsetSelected\s*\([^)\n]*\)\s*\{/.test(tabBarJs))
  assert('选中态 - 组件在 attached 时先同步一次', /attached\(\)/.test(tabBarJs))

  // findTabIndexByRoute 要能同时吃 'page/xx/index' 与 '/page/xx/index'
  assert('选中态 - 路由匹配兼容有无前导斜杠',
    tabBarJs.indexOf("charAt(0) === '/'") >= 0)
  assert('选中态 - 路由匹配忽略 query 参数', tabBarJs.indexOf("split('?')[0]") >= 0)
  assert('选中态 - 重复点击当前 tab 不重复 switchTab',
    /index === this\.data\.selected[\s\S]{0,160}?return/.test(tabBarJs))
}

// ---------- 二·补、底部留白（custom 最容易漏的一条） ----------

/**
 * 原生 tabBar 由系统预留底部空间，页面写 100vh / 小 padding 都没事。
 * 改成 custom 之后底栏变成页面内的 fixed 组件，**不再预留任何空间** ——
 * 这一条只有改 custom 才会踩，所以放在这里而不是各页面自己的测试里。
 */
function checkBottomSpace() {
  // 与 custom-tab-bar/index.wxss 的 .tabbar-wrap height 对应：
  // 底栏整体 232rpx + 40rpx 呼吸位。改底栏尺寸必须同步这里和四个页面，否则内容会被压住。
  // 底栏在 2026-10-27 整体下移 24rpx（胶囊离底 40→16），实际需要的高度反而变小了，
  // 预留值维持 272rpx 不动 —— 多留 60rpx 只会让内容更早结束，不会压住任何东西。
  const reserved = 272

  assert('留白 - tabBar 组件自身声明了高度',
    /\.tabbar-wrap\s*\{[^}]*height:\s*(\d+)rpx/.test(tabBarWxss))

  const wrapHeight = Number((tabBarWxss.match(/\.tabbar-wrap\s*\{[^}]*height:\s*(\d+)rpx/) || [])[1] || 0)
  assert('留白 - tabBar 高度不超过预留值', wrapHeight > 0 && wrapHeight <= reserved,
    `实际 ${wrapHeight}rpx，页面预留 ${reserved}rpx`)

  // 圆钮顶端不能超出 wrap：超出说明页面留白算少了
  const capsuleBottom = Number((tabBarWxss.match(/\.tabbar\s*\{[^}]*?bottom:\s*(\d+)rpx/) || [])[1] || 0)
  const capsuleHeight = Number((tabBarWxss.match(/\.tabbar\s*\{[^}]*?height:\s*(\d+)rpx/) || [])[1] || 0)
  const circleBottom = Number((tabBarWxss.match(/\.continue-btn\s*\{[^}]*?bottom:\s*(\d+)rpx/) || [])[1] || 0)
  const circleSize = Number((tabBarWxss.match(/\.continue-btn\s*\{[^}]*?width:\s*(\d+)rpx/) || [])[1] || 0)

  assert('留白 - 圆钮顶端不超出 tabBar 高度',
    circleBottom + circleSize <= wrapHeight,
    `圆钮顶到 ${circleBottom + circleSize}rpx，wrap 只有 ${wrapHeight}rpx`)
  assert('留白 - 圆钮底部落在胶囊内部（是悬浮不是悬空）',
    circleBottom > capsuleBottom && circleBottom < capsuleBottom + capsuleHeight,
    `圆钮底 ${circleBottom}rpx，胶囊 ${capsuleBottom}~${capsuleBottom + capsuleHeight}rpx`)

  // 「继续答题」文字要留在白色胶囊里、圆钮下面，且不能掉出胶囊底部
  const labelBottom = Number((tabBarWxss.match(/\.continue-label\s*\{[^}]*?bottom:\s*(\d+)rpx/) || [])[1] || 0)
  const labelHeight = Number((tabBarWxss.match(/\.continue-label\s*\{[^}]*?height:\s*(\d+)rpx/) || [])[1] || 0)

  assert('留白 - 「继续答题」文字在胶囊内',
    labelBottom >= capsuleBottom && labelBottom + labelHeight <= capsuleBottom + capsuleHeight,
    `文字 ${labelBottom}~${labelBottom + labelHeight}rpx，胶囊 ${capsuleBottom}~${capsuleBottom + capsuleHeight}rpx`)
  assert('留白 - 「继续答题」文字在圆钮下方（不与圆钮重叠）',
    labelBottom + labelHeight <= circleBottom,
    `文字顶到 ${labelBottom + labelHeight}rpx，圆钮底在 ${circleBottom}rpx`)

  // 通栏滚动的页面：靠根容器 padding 让位
  // stats 用根 padding；my 改版后把让位放在底部协议链接上（设计稿 781:1922
  // 的内容区是白底通栏，根容器不再有内边距），所以这里连 @import 一起读。
  ;['stats', 'my'].forEach((name) => {
    const wxss = readWithImports(`page/${name}/index.wxss`)
    const matched = wxss.match(/\.[a-z-]*page\s*\{[^}]*padding:\s*[^;}]*?(\d+)rpx\s*;/)
    const padded = matched ? Number(matched[1]) : 0
    const bottoms = (wxss.match(/padding-bottom:\s*(\d+)rpx/g) || [])
      .map((line) => Number((line.match(/(\d+)rpx/) || [])[1] || 0))
    const bottom = Math.max(padded, ...(bottoms.length ? bottoms : [0]))

    assert(`留白 - ${name} 页底部预留 ≥ ${reserved}rpx`, bottom >= reserved, `实际 ${bottom}rpx`)
  })

  // 满屏两栏布局的页面：靠减去高度让位，不能用 padding
  const bankWxss = read('page/bank-detail/index.wxss')

  assert('留白 - bank-detail 不再用整屏 100vh',
    /\.bank-detail-page\s*\{[^}]*height:\s*calc\(/.test(bankWxss),
    '整屏 100vh 会让底部被胶囊压住')
  assert('留白 - bank-detail 内部容器改用 100% 跟随父级',
    /\.workbench\s*\{[^}]*height:\s*100%/.test(bankWxss))

  // 首页靠 .sheet 的内边距让位
  const homeWxss = read('page/subject-list/index.wxss')
  const sheetBottom = Number((homeWxss.match(/\.sheet\s*\{[^}]*padding:\s*[^;}]*?(\d+)rpx\s*;/) || [])[1] || 0)

  assert(`留白 - 首页 .sheet 底部预留 ≥ ${reserved}rpx`, sheetBottom >= reserved, `实际 ${sheetBottom}rpx`)
}

// ---------- 二·补二、弹层打开时底栏让位 ----------

/**
 * 自定义 tabBar 由基础库渲染在页面之上，页面里的 fixed 弹层（公告、抽题设置）
 * 一定会在它下面 —— z-index 拉多高都没用。唯一可靠的办法是弹层打开时把底栏收起来。
 * 这条只有 tab 页 + 弹层同时存在时才会踩到，所以放这里统一盯。
 */
function checkHiddenOnOverlay() {
  assert('让位 - 组件暴露 setHidden', /\bsetHidden\s*\([^)\n]*\)\s*\{/.test(tabBarJs))
  assert('让位 - 组件有 hidden 状态', /hidden:\s*false/.test(tabBarJs))
  assert('让位 - WXML 根节点按 hidden 切换类名', /\{\{hidden \? 'tabbar-hidden'/.test(tabBarWxml))
  assert('让位 - 收起样式用 display:none',
    /\.tabbar-hidden\s*\{[^}]*display:\s*none/.test(tabBarWxss),
    '用 opacity:0 会看不见但仍吃掉点击')

  // 两个有弹层的 tab 页都要接入
  const pages = [
    { name: 'subject-list', flag: 'handleAnnouncementTap' },
    { name: 'bank-detail', flag: 'setTabBarHidden' }
  ]

  pages.forEach((page) => {
    const source = read(`page/${page.name}/index.js`)

    assert(`让位 - ${page.name} 接入底栏收起`, source.indexOf('setTabBarHidden') >= 0)
    assert(`让位 - ${page.name} 在 onShow 里恢复底栏`,
      /onShow\(\)\s*\{[\s\S]{0,300}?setTabBarHidden\(false\)/.test(source),
      '不恢复的话「弹层没关就跳走」会让底栏永久消失')
  })

  // 公告打开的入口必须真的收起底栏
  const homeJs = read('page/subject-list/index.js')
  assert('让位 - 打开公告时收起底栏',
    /handleAnnouncementTap\(\)\s*\{[\s\S]{0,160}?setTabBarHidden\(true\)/.test(homeJs))
  assert('让位 - 关闭公告时恢复底栏',
    /handleAnnouncementClose\(\)\s*\{[\s\S]{0,160}?setTabBarHidden\(false\)/.test(homeJs))
}

// ---------- 三、中央「继续答题」 ----------

function checkContinueButton() {
  assert('中央钮 - WXML 存在中央按钮', tabBarWxml.indexOf('class="continue-btn"') >= 0)
  assert('中央钮 - 文案为「继续答题」', tabBarWxml.indexOf('继续答题') >= 0)

  // 文字必须在圆钮外面（用户明确要求：「不要放在蓝色图标里面」）
  const circleTag = (tabBarWxml.match(/<view\s+class="continue-btn"[\s\S]*?>[\s\S]*?<\/view>/) || [''])[0]

  assert('中央钮 - 圆钮里只有播放三角，没有文字',
    circleTag.indexOf('继续答题') < 0 && circleTag.indexOf('continue-icon') >= 0,
    '文字还留在圆钮内部')
  assert('中央钮 - 文字是独立的 continue-label', tabBarWxml.indexOf('class="continue-label"') >= 0)

  /*
   * 真实出过的事故：`.continue-label` 用 left:0 + right:0 铺满整条底栏，
   * 它和四个 tab 的标签同高、又是绝对定位且排在 tab 之后，
   * 于是这一条 30rpx 高的带子盖住全部 tab 文字 —— 点「复盘」两个字，
   * 实际触发的是 handleContinueTap，页面直接跳去答题页。用户报的就是这个。
   * 所以宽度必须收在中央圆钮那一格里，禁止再用左右双向拉伸。
   */
  const labelBlock = (tabBarWxss.match(/\.continue-label\s*\{[^}]*\}/) || [''])[0]
  const labelWidth = Number((labelBlock.match(/width:\s*(\d+)rpx/) || [])[1] || 0)

  assert('中央钮 - 文字点击区不得铺满底栏（会吃掉四个 tab 的点击）',
    !/right\s*:\s*0/.test(labelBlock) && labelWidth > 0 && labelWidth <= 140,
    labelBlock.indexOf('right: 0') >= 0 ? '还在用 left:0 + right:0' : `宽度 ${labelWidth}rpx`)
  assert('中央钮 - 文字点击区水平居中',
    /left\s*:\s*50%/.test(labelBlock) && /margin-left\s*:\s*-?\d+rpx/.test(labelBlock))
  assert('中央钮 - 文字也能点击（与圆钮同一处理函数）',
    (tabBarWxml.match(/bindtap="handleContinueTap"/g) || []).length === 2,
    `实际 ${(tabBarWxml.match(/bindtap="handleContinueTap"/g) || []).length} 处`)
  assert('中央钮 - 带 hover 反馈且 hover-start-time 为 0',
    /hover-class="continue-hover"[\s\S]{0,120}?hover-start-time="0"/.test(tabBarWxml))
  assert('中央钮 - 使用绝对定位浮在胶囊上（不挤占 tab 布局）',
    /\.continue-btn\s*\{[^}]*position\s*:\s*absolute/.test(tabBarWxss))
  assert('中央钮 - 胶囊本身是圆角悬浮',
    /\.tabbar\s*\{[^}]*border-radius\s*:\s*\d+rpx/.test(tabBarWxss))

  // 目的地解析：必须与首页同源，都读 getResumableSession
  assert('中央钮 - 去向解析读 getResumableSession', tabBarJs.indexOf('getResumableSession') >= 0)
  assert('中央钮 - 有半场会话时恢复练习', tabBarJs.indexOf('/page/practice/index?sessionId=') >= 0)
  assert('中央钮 - 无半场会话时去题库', tabBarJs.indexOf("url: '/page/bank-detail/index'") >= 0)
  assert('中央钮 - 读取失败时降级到题库而不是崩', /catch\s*\(error\)/.test(tabBarJs))

  const homeVm = read('viewmodels/subject-list-viewmodel.js')
  assert('中央钮 - 与首页「继续上次练习」同源（都读 getResumableSession）',
    homeVm.indexOf('getResumableSession') >= 0)
}

// ---------- 三·补、圆钮不得压住任何 tab ----------

/**
 * 真实出现过的问题：让位边距加在**第 3 个 tab 之后**，前 3 个 tab 平分左半侧，
 * 「统计」刚好落在屏幕正中，整个图标被 118rpx 的圆钮盖住，
 * 只剩一行「统计」两个字露在圆钮下面。
 *
 * 这里按 WXSS 里的真实数值把四格的位置算出来，和圆钮的横向区间求交。
 * 改边距、改圆钮大小、改胶囊左右留白，只要压上了就会红。
 */
function checkNoOverlap() {
  const capsuleLeft = Number((tabBarWxss.match(/\.tabbar\s*\{[^}]*?left:\s*(\d+)rpx/) || [])[1] || 0)
  const capsuleRight = Number((tabBarWxss.match(/\.tabbar\s*\{[^}]*?right:\s*(\d+)rpx/) || [])[1] || 0)
  const buttonWidth = Number((tabBarWxss.match(/\.continue-btn\s*\{[^}]*?width:\s*(\d+)rpx/) || [])[1] || 0)

  // 让位必须加在第 2 个之后：加在第 3 个之后会把「统计」推进圆钮底下
  const gapMatched = tabBarWxss.match(/\.tab-item:nth-child\(2\)\s*\{[^}]*?margin-right:\s*(\d+)rpx/)

  assert('布局 - 让位边距加在第 2 个 tab 之后',
    !!gapMatched,
    '若写在第 3 个之后，第 3 格会被推到屏幕正中、被圆钮整个盖住')
  assert('布局 - 第 3 个 tab 不再承担让位',
    /\.tab-item:nth-child\(3\)\s*\{[^}]*margin-right/.test(tabBarWxss) === false)

  if (!gapMatched || !buttonWidth) {
    return
  }

  const gap = Number(gapMatched[1])
  const screenWidth = 750
  const capsuleWidth = screenWidth - capsuleLeft - capsuleRight
  // .tabbar 的左右内边距也算进来：内宽变小，四格才等分
  const paddingSide = Number((tabBarWxss.match(/\.tabbar\s*\{[^}]*?padding:\s*0\s+(\d+)rpx/) || [])[1] || 0)
  const innerWidth = capsuleWidth - paddingSide * 2
  const itemWidth = (innerWidth - gap) / 4

  // 圆钮用 left:50% + 负 margin 居中，换算到胶囊内部坐标
  const localCenter = screenWidth / 2 - capsuleLeft
  const buttonLeft = localCenter - buttonWidth / 2
  const buttonRight = localCenter + buttonWidth / 2

  const ranges = [0, 1, 2, 3].map((index) => {
    const start = paddingSide + index * itemWidth + (index >= 2 ? gap : 0)

    return { index, start, end: start + itemWidth }
  })

  const overlapped = ranges.filter((item) => !(item.end <= buttonLeft || item.start >= buttonRight))

  assert('布局 - 圆钮不压住任何一个 tab',
    overlapped.length === 0,
    overlapped.map((item) => `第 ${item.index + 1} 格 [${item.start.toFixed(1)}, ${item.end.toFixed(1)}]`).join(' / ') +
      ` 与圆钮 [${buttonLeft}, ${buttonRight}] 重叠`)

  const leftInset = ranges[0].start
  const rightInset = capsuleWidth - ranges[3].end

  assert('布局 - 四个 tab 左右对称',
    Math.abs(leftInset - rightInset) < 0.5,
    `左 ${leftInset.toFixed(1)} / 右 ${rightInset.toFixed(1)}`)

  assert('布局 - 每个 tab 宽度足够放图标与文字',
    itemWidth >= 110,
    `每格仅 ${itemWidth.toFixed(1)}rpx`)
}

// ---------- 四、纯函数：去向解析 ----------

function loadTabBarModule() {
  const modulePath = path.join(MINIPROGRAM, 'custom-tab-bar/index.js')
  const source = fs.readFileSync(modulePath, 'utf8')
  const start = source.indexOf('const TAB_ROUTES = [')
  const end = source.indexOf('Component({')
  const head = source.slice(0, start)

  if (start < 0 || end < 0) {
    throw new Error('custom-tab-bar/index.js 结构变了，TAB_ROUTES 或 Component 定位失败')
  }

  // 只取 Component 之前的纯计算部分：这部分不依赖微信运行时
  const body = source.slice(start, end)
  const Module = require('module')
  const m = new Module(modulePath, null)
  m.filename = modulePath
  m.paths = Module._nodeModulePaths(path.dirname(modulePath))

  const wrapped = `${head}\n${body}\nmodule.exports = { TAB_ROUTES, findTabIndexByRoute, resolveContinueTarget }`

  return m._compile ? (() => {
    m._compile(wrapped, modulePath)
    return m.exports
  })() : null
}

function checkPureFunctions() {
  let exported = null

  try {
    exported = loadTabBarModule()
  } catch (error) {
    assert('纯函数 - 能独立加载 custom-tab-bar 的计算部分', false, error.message)
    return
  }

  if (!exported) {
    assert('纯函数 - 能独立加载 custom-tab-bar 的计算部分', false, '编译返回空')
    return
  }

  const { TAB_ROUTES, findTabIndexByRoute, resolveContinueTarget } = exported

  assert('纯函数 - TAB_ROUTES 有 4 项', TAB_ROUTES.length === 4, `实际 ${TAB_ROUTES.length}`)

  // 顺序必须严格等于 app.json 的 list，否则底栏高亮会错位
  const appOrder = appJson.tabBar.list.map((item) => `/${item.pagePath.replace(/^\//, '')}`)
  assert('纯函数 - TAB_ROUTES 顺序与 app.json 一致',
    TAB_ROUTES.map((item) => item.pagePath).join(',') === appOrder.join(','),
    `${TAB_ROUTES.map((i) => i.pagePath).join(',')} vs ${appOrder.join(',')}`)

  assert('纯函数 - 带前导斜杠可定位', findTabIndexByRoute('/page/stats/index') === 2)
  assert('纯函数 - 无前导斜杠可定位', findTabIndexByRoute('page/stats/index') === 2)
  assert('纯函数 - 带 query 可定位', findTabIndexByRoute('/page/my/index?from=login') === 3)
  assert('纯函数 - 未知路由返回 -1', findTabIndexByRoute('/page/practice/index') === -1)
  assert('纯函数 - 空路由返回 -1', findTabIndexByRoute('') === -1)
  assert('纯函数 - 非字符串返回 -1', findTabIndexByRoute(null) === -1)

  // 无会话 → 题库
  const bare = resolveContinueTarget(null)
  assert('纯函数 - 无存储时回落到题库', bare.type === 'bank' && bare.url === '/page/bank-detail/index',
    JSON.stringify(bare))

  // 读存储抛错也要回落，不能让底栏点不动
  const explodingStorage = {
    get() {
      throw new Error('storage 不可用')
    }
  }

  let threw = false
  let fallback = null

  try {
    fallback = resolveContinueTarget(explodingStorage)
  } catch (error) {
    threw = true
  }

  assert('纯函数 - storage 抛错时不冒泡', threw === false)
  assert('纯函数 - storage 抛错时回落题库', fallback && fallback.type === 'bank')
}

// ---------- 输出 ----------

checkConfig()
checkSelectionSync()
checkBottomSpace()
checkHiddenOnOverlay()
checkContinueButton()
checkNoOverlap()
checkPureFunctions()

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  if (!item.passed) {
    console.log(`FAIL  ${item.name}${item.detail ? ` —— ${item.detail}` : ''}`)
  }
})

console.log(`\n自定义 tabBar 自检：总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exitCode = 1
}
