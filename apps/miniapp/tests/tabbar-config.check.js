/**
 * tabBar 配置与统计页 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/tabbar-config.check.js
 *
 * 为什么需要它：
 *   tabBar 配错的后果在开发者工具里才暴露，且报错信息不指向根因——
 *   图标路径写错会静默不显示，用 navigateTo 跳 tab 页会直接失败。
 *   这里在提交前把三类问题静态扫一遍：
 *     1. tab 数量、页面注册、图标文件（存在 / 合法 PNG / 81×81 / 未超 40KB）
 *     2. 跳转方式与页面类型是否匹配（tab 页只能 switchTab，非 tab 页不能 switchTab）
 *     3. 统计页汇总口径是否正确
 */
const fs = require('node:fs')
const path = require('node:path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const APP_JSON_PATH = path.join(MINIPROGRAM, 'app.json')
const ICON_MAX_BYTES = 40 * 1024

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

function walkJsFiles(dir, collected) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'data') {
        return
      }

      walkJsFiles(full, collected)
      return
    }

    if (entry.name.endsWith('.js')) {
      collected.push(full)
    }
  })

  return collected
}

// ---------- 1. tabBar 配置 ----------
const appJson = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'))
const tabs = (appJson.tabBar && appJson.tabBar.list) || []
const tabPaths = tabs.map((tab) => tab.pagePath)

assert('tabBar - 共 4 个 tab', tabs.length === 4, `实际 ${tabs.length} 个`)

const expectedOrder = [
  'page/subject-list/index',
  'page/bank-detail/index',
  'page/stats/index',
  'page/my/index'
]

assert('tabBar - 顺序为首页/题库/统计/我的',
  JSON.stringify(tabPaths) === JSON.stringify(expectedOrder),
  JSON.stringify(tabPaths))

tabs.forEach((tab) => {
  const label = tab.text || tab.pagePath
  const pageDir = path.join(MINIPROGRAM, tab.pagePath)
  const pageFile = `${pageDir}.js`

  assert(`tab「${label}」- 已注册进 pages`,
    (appJson.pages || []).indexOf(tab.pagePath) >= 0,
    `${tab.pagePath} 不在 pages 中`)

  assert(`tab「${label}」- 页面文件齐全`,
    fs.existsSync(pageFile) &&
    fs.existsSync(`${pageDir}.wxml`) &&
    fs.existsSync(`${pageDir}.json`),
    '缺少 js / wxml / json')

  const iconFiles = [
    { role: '默认态', file: tab.iconPath },
    { role: '选中态', file: tab.selectedIconPath }
  ]

  iconFiles.forEach((icon) => {
    if (!icon.file) {
      assert(`tab「${label}」- ${icon.role}图标已配置`, false, 'iconPath 为空')
      return
    }

    const iconPath = path.join(MINIPROGRAM, icon.file)

    if (!fs.existsSync(iconPath)) {
      assert(`tab「${label}」- ${icon.role}图标存在`, false, `${icon.file} 找不到`)
      return
    }

    const buffer = fs.readFileSync(iconPath)
    const isPng = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a'
    const width = isPng ? buffer.readUInt32BE(16) : 0
    const height = isPng ? buffer.readUInt32BE(20) : 0

    assert(`tab「${label}」- ${icon.role}图标为合法 PNG`, isPng, icon.file)
    assert(`tab「${label}」- ${icon.role}图标尺寸 81×81`,
      width === 81 && height === 81,
      `${width}×${height}`)
    assert(`tab「${label}」- ${icon.role}图标未超 40KB`,
      buffer.length <= ICON_MAX_BYTES,
      `${(buffer.length / 1024).toFixed(1)}KB`)
  })
})

// ---------- 2. 跳转方式与页面类型是否匹配 ----------
const routePattern = /wx\.(navigateTo|redirectTo|switchTab|reLaunch)\s*\(\s*\{[\s\S]{0,200}?url:\s*[`'"]([^`'"?]+)/g
const routeFiles = walkJsFiles(path.join(MINIPROGRAM, 'page'), [])
  .concat(walkJsFiles(path.join(MINIPROGRAM, 'components'), []))
const mismatches = []

routeFiles.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8')
  let match = routePattern.exec(source)

  while (match) {
    const method = match[1]
    const target = match[2].replace(/^\//, '')
    const isTabPage = tabPaths.indexOf(target) >= 0

    if (isTabPage && method !== 'switchTab' && method !== 'reLaunch') {
      mismatches.push(`${path.relative(MINIPROGRAM, file)} 用 ${method} 打开 tab 页 ${target}`)
    }

    if (!isTabPage && method === 'switchTab') {
      mismatches.push(`${path.relative(MINIPROGRAM, file)} 用 switchTab 打开非 tab 页 ${target}`)
    }

    match = routePattern.exec(source)
  }
})

assert('路由 - 跳转方式与页面类型匹配', mismatches.length === 0, mismatches.join(' | '))

// tab 页不接受 URL 参数：首页跳题库必须走全局数据而非拼接 query
const subjectListSource = fs.readFileSync(
  path.join(MINIPROGRAM, 'page/subject-list/index.js'),
  'utf8'
)

assert('路由 - 首页跳题库走 switchTab', subjectListSource.indexOf('wx.switchTab') >= 0, '未找到 switchTab')
assert('路由 - 首页跳题库不带参数',
  subjectListSource.indexOf('/page/bank-detail/index?') < 0,
  'switchTab 的 url 里拼接了 query，参数会被忽略')

// ---------- 3. 统计页汇总口径 ----------
const catalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
const practiceRepository = require(path.join(MINIPROGRAM, 'repositories/practice-repository.js'))
const { StatsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/stats-viewmodel.js'))

const storage = createMemoryStorage()
const firstBank = catalog.getBankQuiz('subject-chinese', 'chinese-ch001')
const firstQuestionId = firstBank.questions[0].id
const secondQuestionId = firstBank.questions[1].id

// 一题答对、一题答错
const answers = {}
answers[firstQuestionId] = 1
answers[secondQuestionId] = 0

storage.set('qandaProgress', {
  'chinese-ch001': {
    total: firstBank.questions.length,
    answers,
    updatedAt: Date.now()
  }
})

practiceRepository.saveWrongResults(storage, [
  { id: secondQuestionId, answered: true, correct: false }
])
practiceRepository.addQuestionFavorite(storage, firstQuestionId)
storage.set('qandaBestScore:chinese-ch001', 80)

const statsData = new StatsViewModel({ storage }).load().data
const catalogStats = practiceRepository.getCatalogStats()

assert('统计页 - 总题量等于全部科目之和',
  statsData.overall.total === catalogStats.questionCount,
  `${statsData.overall.total} vs ${catalogStats.questionCount}`)
assert('统计页 - 已做按作答去重计数', statsData.overall.answered === 2, String(statsData.overall.answered))
assert('统计页 - 正确率按已做计算', statsData.overall.accuracyText === '50%', statsData.overall.accuracyText)
assert('统计页 - 完成度按总题量计算',
  statsData.overall.progressPercent === Math.round((2 / catalogStats.questionCount) * 100),
  String(statsData.overall.progressPercent))
assert('统计页 - 列出全部科目',
  statsData.subjectStats.length === catalogStats.subjectCount,
  `${statsData.subjectStats.length} vs ${catalogStats.subjectCount}`)

const chineseStat = statsData.subjectStats.find((item) => item.id === 'subject-chinese')
assert('统计页 - 科目行带主题色', !!chineseStat && chineseStat.theme === 'chinese',
  JSON.stringify(chineseStat && chineseStat.theme))
assert('统计页 - 科目已做数正确',
  !!chineseStat && chineseStat.answered === 2,
  String(chineseStat && chineseStat.answered))

assert('统计页 - 待复习错题数', statsData.wrongCount === 1, String(statsData.wrongCount))
assert('统计页 - 收藏数', statsData.favoriteCount === 1, String(statsData.favoriteCount))
assert('统计页 - 历史最佳按分数倒序',
  statsData.records.length === 1 && statsData.records[0].score === 80,
  JSON.stringify(statsData.records))

// 统计页是只读的：load 不应写入任何 storage 键
const keysBefore = storage.keys().slice().sort().join(',')
new StatsViewModel({ storage }).load()
assert('统计页 - load 无写副作用',
  storage.keys().slice().sort().join(',') === keysBefore,
  'load 过程改动了本地存储')

// 空数据不应抛错
const emptyData = new StatsViewModel({ storage: createMemoryStorage() }).load().data
assert('统计页 - 空数据可用',
  emptyData.overall.answered === 0 && emptyData.records.length === 0,
  JSON.stringify(emptyData.overall))

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
