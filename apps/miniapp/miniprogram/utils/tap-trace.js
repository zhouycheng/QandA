/**
 * 点击链路探针（诊断用，定位完可把 ENABLED 设为 false 关掉）
 *
 * 目的：把「点了没反应」这件事拆成三段，从控制台一眼看出断在哪一段。
 *
 *   1. 事件有没有到逻辑层？ → 点一下若没有任何 `[tap]` 输出，说明手指的点击
 *      根本没送达 JS（渲染层/框架层问题，比如多帧运行时、被浮层遮挡、
 *      hover 覆盖层吃掉事件），跟业务代码无关。
 *   2. 逻辑层跑通了吗？     → `[vm] ... setData(...)` 说明 ViewModel 正常返回了新数据。
 *   3. 数据到了渲染层吗？   → `[render]` 打印页面根节点尺寸；尺寸为 0 或缺失
 *      说明是布局/样式问题（UI 层），尺寸正常却看不到变化就是样式问题。
 *
 * 用法（各页面已接好）：
 *   Page(wrapTaps({ ... }, 'subject-list'))
 *
 * 打开开发者工具的 Console，在页面上点任意按钮，观察输出顺序：
 *
 *   [tap] subject-list.handleGoBank {"target":"..."}
 *   [vm]  subject-list → setData(routeLoadingVisible, ...)
 *   [render] subject-list 根节点 { width: 375, height: 667 }
 *
 * 三段齐全 → 链路健康，问题在视觉呈现（看不出反馈）；
 * 缺第 1 段 → 事件没进来，属于运行环境问题，去查多帧运行时 / 遮挡 / 游客模式。
 */

const ENABLED = true

/** 生命周期不包：包了会把框架调用也刷成点击日志，噪音太大 */
const LIFECYCLE = new Set([
  'onLoad',
  'onShow',
  'onHide',
  'onReady',
  'onUnload',
  'onPullDownRefresh',
  'onReachBottom',
  'onPageScroll',
  'onResize',
  'onTabItemTap',
  'onShareAppMessage',
  'onShareTimeline',
  'onAddToFavorites',
])

/** 各页面的根节点类名，用来探测渲染结果 */
const ROOT_SELECTOR = '.page, .bank-detail-page, .practice-page, .wrong-book-page, .settings-scroll'

function tag(pageName, kind, text) {
  console.log(`[${kind}] ${pageName}${text ? ' ' + text : ''}`)
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch (err) {
    return String(value)
  }
}

/**
 * 给页面选项包一层点击日志。
 * @param {object} options 原本传给 Page() 的对象
 * @param {string} pageName 页面名，仅用于日志前缀
 */
function wrapTaps(options, pageName) {
  if (!ENABLED) return options

  const name = pageName || 'page'
  const out = Object.assign({}, options)

  // 1) 点击入口日志：证明事件到了逻辑层，并把 dataset 打出来
  for (const key of Object.keys(options)) {
    if (typeof options[key] !== 'function') continue
    if (LIFECYCLE.has(key) || key === 'applyViewModelResult') continue

    const original = options[key]
    out[key] = function wrapped(event) {
      let extra = ''
      const dataset = event && event.currentTarget && event.currentTarget.dataset
      if (dataset && Object.keys(dataset).length) extra = safeStringify(dataset)
      tag(name, 'tap', `${key}${extra ? ' ' + extra : ''}`)
      return original.apply(this, arguments)
    }
  }

  // 2) ViewModel 返回日志：证明逻辑层真的算出了新数据
  if (typeof options.applyViewModelResult === 'function') {
    const originalApply = options.applyViewModelResult
    out.applyViewModelResult = function wrappedApply(result) {
      if (!result) {
        tag(name, 'vm', '返回 null（本次点击不产生数据变化）')
      } else {
        const keys = result.data ? Object.keys(result.data) : []
        const command = result.command ? result.command.type : ''
        tag(
          name,
          'vm',
          `${keys.length ? `setData(${keys.join(',')})` : '无 data'}${command ? ` command=${command}` : ''}`
        )
      }
      return originalApply.apply(this, arguments)
    }
  }

  // 3) 渲染探针：页面首次渲染完，量一下根节点尺寸
  const originalReady = options.onReady
  out.onReady = function wrappedReady() {
    if (originalReady) originalReady.apply(this, arguments)

    if (typeof wx === 'undefined' || !wx.createSelectorQuery) {
      tag(name, 'render', '当前环境不支持 createSelectorQuery，跳过尺寸探测')
      return
    }

    try {
      wx.createSelectorQuery()
        .in(this)
        .select(ROOT_SELECTOR)
        .boundingClientRect((rect) => {
          if (!rect) {
            tag(name, 'render', `根节点没量到（${ROOT_SELECTOR}）—— 页面可能是空渲染`)
            return
          }
          tag(name, 'render', `根节点 ${safeStringify({ w: rect.width, h: rect.height, top: rect.top })}`)
        })
        .exec()
    } catch (err) {
      tag(name, 'render', `尺寸探测失败：${err.message}`)
    }
  }

  return out
}

/**
 * 组件版：只包 methods 里的点击方法。
 * @param {object} options 原本传给 Component() 的对象
 * @param {string} name 组件名
 */
function wrapComponentMethods(options, name) {
  if (!ENABLED || !options || !options.methods) return options

  const out = Object.assign({}, options)
  const methods = Object.assign({}, options.methods)

  for (const key of Object.keys(methods)) {
    if (typeof methods[key] !== 'function') continue
    const original = methods[key]
    methods[key] = function wrapped(event) {
      let extra = ''
      const dataset = event && event.currentTarget && event.currentTarget.dataset
      if (dataset && Object.keys(dataset).length) extra = safeStringify(dataset)
      tag(name || 'component', 'tap', `${key}${extra ? ' ' + extra : ''}`)
      return original.apply(this, arguments)
    }
  }

  out.methods = methods
  return out
}

module.exports = { wrapTaps, wrapComponentMethods, ENABLED }
