/**
 * 题目字号 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/font-size.check.js
 *
 * 起因：用户反馈「字号点了不起作用」。查下来链路（点击 → 落盘 → 选中态）本身是通的，
 * 真问题是两条：
 *   1. 三档只差 4~5rpx，手机上根本看不出变化，等于没做；
 *   2. 字号只在答题页生效，题目详情页完全没接。
 *
 * 所以这里锁死三件事：
 *   1. 三档数值差距足够大，且方向正确（小 < 标准 < 大）；
 *   2. 「读题」场景（答题页 + 题目详情页）都带 font-* 类并有对应规则；
 *   3. 设置页选完当场有预览，不依赖重新进答题页。
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const preferenceUtils = require(path.join(MINIPROGRAM, 'utils/preferences.js'))
const { SettingsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
const { QuestionDetailViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/question-detail-viewmodel.js'))
const { PracticeSession } = require(path.join(MINIPROGRAM, 'models/practice-session.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function createMemoryStorage(initial) {
  const map = Object.assign({}, initial || {})

  return {
    get(key) {
      return map[key] === undefined ? null : map[key]
    },

    set(key, value) {
      map[key] = value
    },

    remove(key) {
      delete map[key]
    },

    keys() {
      return Object.keys(map)
    },

    raw: map
  }
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(MINIPROGRAM, relativePath), 'utf8')
}

/** 从 WXSS 里取出 `.font-<档位> .<类> { font-size: Nrpx }` 的数值 */
function pickFontSize(wxss, scale, target) {
  const pattern = new RegExp(`\\.font-${scale}\\s+\\.${target}\\s*\\{[^}]*?font-size:\\s*(\\d+)rpx`, 'm')
  const matched = wxss.match(pattern)

  return matched ? Number(matched[1]) : 0
}

function pickDefaultFontSize(wxss, target) {
  const pattern = new RegExp(`(^|\\})\\s*\\.${target}\\s*\\{[^}]*?font-size:\\s*(\\d+)rpx`, 'm')
  const matched = wxss.match(pattern)

  return matched ? Number(matched[2]) : 0
}

// ---------- 一、偏好本身 ----------
function checkPreferences() {
  const options = preferenceUtils.FONT_SIZE_OPTIONS.map((item) => item.value).join(',')

  assert('偏好 - 字号三档齐全', options === 'small,normal,large', options)
  assert('偏好 - 默认是标准', preferenceUtils.DEFAULT_PREFERENCES.fontSize === 'normal')
  assert('偏好 - 非法值回落标准',
    preferenceUtils.normalizePreferences({ fontSize: 'huge' }).fontSize === 'normal')
  assert('偏好 - 合法值保留',
    preferenceUtils.normalizePreferences({ fontSize: 'large' }).fontSize === 'large')
  assert('偏好 - 字号对设置页开放',
    preferenceUtils.PREFERENCE_CHOICES.find((item) => item.key === 'fontSize').available === true)
}

// ---------- 二、设置页：点了要有看得见的变化 ----------
function checkSettings() {
  const storage = createMemoryStorage()
  const vm = new SettingsViewModel({ storage })

  assert('设置 - 初始标准字号', vm.load().data.fontSize === 'normal')
  assert('设置 - 提供预览文案', !!vm.load().data.fontPreviewText)

  const large = vm.selectChoice('fontSize', 'large')

  assert('设置 - 选大后回传 large', large.data.fontSize === 'large', large.data.fontSize)
  assert('设置 - 选大后选中态跟着变',
    large.data.choices[0].options.find((item) => item.value === 'large').selected === true)
  assert('设置 - 选大落盘',
    preferenceUtils.normalizePreferences(storage.get(preferenceUtils.PREFERENCE_STORAGE_KEY)).fontSize === 'large')

  const small = vm.selectChoice('fontSize', 'small')

  assert('设置 - 选小后回传 small', small.data.fontSize === 'small', small.data.fontSize)

  const wxml = readFile('page/settings/index.wxml')
  const wxss = readFile('page/settings/index.wxss')

  assert('设置 - 预览块绑了当前字号', wxml.indexOf('font-{{fontSize}}') >= 0)
  assert('设置 - 预览只在字号项出现', wxml.indexOf("wx:if=\"{{item.key === 'fontSize'}}\"") >= 0)
  assert('设置 - 预览有两档字号规则',
    pickFontSize(wxss, 'small', 'font-preview-text') > 0 &&
      pickFontSize(wxss, 'large', 'font-preview-text') > 0)
}

// ---------- 三、答题页：三档差距要够大 ----------
function checkPracticeScale() {
  const wxss = readFile('page/practice/index.wxss')
  const wxml = readFile('page/practice/index.wxml')

  assert('答题页 - 根节点带 font-* 类', wxml.indexOf('font-{{preferences.fontSize}}') >= 0)

  const targets = ['stem', 'option-text', 'explanation-text', 'review-stem']

  targets.forEach((target) => {
    const small = pickFontSize(wxss, 'small', target)
    const large = pickFontSize(wxss, 'large', target)
    const base = pickDefaultFontSize(wxss, target)

    assert(`答题页 - .${target} 三档都有定义`, small > 0 && large > 0 && base > 0,
      `small=${small} base=${base} large=${large}`)
    assert(`答题页 - .${target} 方向正确（小 < 标准 < 大）`, small < base && base < large,
      `small=${small} base=${base} large=${large}`)
    assert(`答题页 - .${target} 小档与大档差距 ≥ 8rpx`, large - small >= 8,
      `large - small = ${large - small}`)
  })

  // 会话把偏好透传给页面
  const session = new PracticeSession({
    preferences: { fontSize: 'large' },
    quiz: null
  })

  assert('答题页 - 偏好透传到视图数据',
    session.getViewData().preferences.fontSize === 'large',
    JSON.stringify(session.getViewData().preferences))
}

// ---------- 四、题目详情页也要跟着生效 ----------
function checkQuestionDetail() {
  const wxml = readFile('page/question-detail/index.wxml')
  const wxss = readFile('page/question-detail/index.wxss')

  assert('详情页 - 根节点带 font-* 类', wxml.indexOf('font-{{fontSize}}') >= 0)

  const targets = ['detail-stem', 'detail-option-text', 'explain-text']

  targets.forEach((target) => {
    const small = pickFontSize(wxss, 'small', target)
    const large = pickFontSize(wxss, 'large', target)
    const base = pickDefaultFontSize(wxss, target)

    assert(`详情页 - .${target} 三档都有定义`, small > 0 && large > 0 && base > 0,
      `small=${small} base=${base} large=${large}`)
    assert(`详情页 - .${target} 方向正确`, small < base && base < large,
      `small=${small} base=${base} large=${large}`)
  })

  const vm = new QuestionDetailViewModel({
    storage: createMemoryStorage(),
    repository: {
      getPreferences: () => ({ fontSize: 'large' })
    }
  })

  assert('详情页 - 读偏好得到当前字号', vm.readFontSize() === 'large', vm.readFontSize())
  assert('详情页 - 初始数据是标准字号',
    QuestionDetailViewModel.getInitialData().fontSize === 'normal')

  const broken = new QuestionDetailViewModel({
    storage: createMemoryStorage(),
    repository: {
      getPreferences() {
        throw new Error('storage broken')
      }
    }
  })

  assert('详情页 - 读偏好失败退回标准字号', broken.readFontSize() === 'normal', broken.readFontSize())
}

checkPreferences()
checkSettings()
checkPracticeScale()
checkQuestionDetail()

const failed = results.filter((item) => !item.passed)
const width = Math.max(...results.map((item) => item.name.length))

console.log('\n=== 题目字号自检 ===\n')

results.forEach((item) => {
  console.log(`${item.passed ? '  ✓' : '  ✗'} ${item.name.padEnd(width, ' ')}  ${item.passed ? '' : item.detail}`)
})

console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length > 0) {
  process.exit(1)
}
