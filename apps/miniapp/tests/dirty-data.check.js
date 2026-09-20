/**
 * 脏数据压测 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/dirty-data.check.js
 *
 * 为什么需要这份脚本：
 * 其它自检用的内存 storage 对「键不存在」返回 null，而真实的 wx.getStorageSync
 * 返回的是**空字符串 ''**。再加上用户本地可能残留旧格式数据（改版前写入的），
 * 一旦 ViewModel 读到脏数据就抛异常，页面 onLoad 会中断——
 * 结果是页面渲染出初始空 data，内容不显示、点击像石沉大海，
 * 而原生 tabBar 不受影响，看起来就成了「只有底部导航能点」。
 *
 * 这类问题在开发者工具里表现为「没报错但什么都不对」，只能靠压测暴露。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')

const results = []

function assert(name, condition, detail) {
  results.push({ name, passed: !!condition, detail: condition ? '' : detail || '' })
}

/**
 * 模拟真实微信存储：
 * - 键不存在 -> ''（不是 null！）
 * - set 后原样返回
 */
function createWxLikeStorage(initial) {
  const map = Object.assign({}, initial || {})

  return {
    get(key) {
      return map[key] === undefined ? '' : map[key]
    },

    set(key, value) {
      map[key] = value
    },

    remove(key) {
      delete map[key]
    },

    keys() {
      return Object.keys(map)
    }
  }
}

/** 各种可能残留在本地的脏数据形态 */
const DIRTY_VALUES = {
  '键不存在': undefined,
  '空字符串': '',
  'null': null,
  '数字': 123,
  '普通字符串': 'abc',
  '空数组': [],
  '空对象': {},
  'scope 值为 null': { 'chinese-ch001': null },
  'scope 值为字符串': { 'chinese-ch001': 'oops' },
  'total 为 null': { 'chinese-ch001': { total: null, answers: null, updatedAt: null } },
  'total 为字符串': { 'chinese-ch001': { total: 'x', answers: {}, updatedAt: 0 } },
  'answers 为数组': { 'chinese-ch001': { total: 10, answers: [1, 0, 1], updatedAt: 0 } },
  'answers 值为字符串': { 'chinese-ch001': { total: 10, answers: { a: 'yes' }, updatedAt: 0 } },
  'updatedAt 为字符串': { 'chinese-ch001': { total: 10, answers: { q1: 1 }, updatedAt: '昨天' } },
  '嵌套 undefined': { 'chinese-ch001': { total: undefined, answers: undefined } }
}

/** 需要压测的存储键（覆盖全部本地持久化数据） */
const STORAGE_KEYS = [
  'qandaProgress',
  'qandaWrongBook',
  'qandaFavorites',
  'qandaCustomQuiz',
  'qandaStudyTime',
  'qandaPreferences',
  'qandaDailyLog',
  'qandaBestScore:chinese-ch001:practice:0'
]

/** 逐个 ViewModel 压测：把每个脏值分别塞进每个键，再调 load() */
const VIEWMODELS = [
  { name: 'subject-list', file: 'subject-list-viewmodel.js', cls: 'SubjectListViewModel', load: vm => vm.load() },
  { name: 'stats', file: 'stats-viewmodel.js', cls: 'StatsViewModel', load: vm => vm.load() },
  { name: 'my', file: 'my-viewmodel.js', cls: 'MyViewModel', load: vm => vm.load() },
  { name: 'settings', file: 'settings-viewmodel.js', cls: 'SettingsViewModel', load: vm => vm.load() },
  { name: 'bank-detail', file: 'bank-detail-viewmodel.js', cls: 'BankDetailViewModel', load: vm => vm.load() },
  { name: 'wrong-book', file: 'wrong-book-viewmodel.js', cls: 'WrongBookViewModel', load: vm => vm.load({}) }
]

for (const vmDef of VIEWMODELS) {
  let mod
  try {
    mod = require(path.join(MINIPROGRAM, 'viewmodels', vmDef.file))
  } catch (error) {
    assert(`${vmDef.name} 可加载`, false, error.message)
    continue
  }

  const ViewModel = mod[vmDef.cls]
  assert(`${vmDef.name} 导出 ${vmDef.cls}`, typeof ViewModel === 'function', '未导出该类')

  if (typeof ViewModel !== 'function') continue

  let crashed = 0
  const crashDetails = []

  for (const key of STORAGE_KEYS) {
    for (const [label, dirty] of Object.entries(DIRTY_VALUES)) {
      const storage = createWxLikeStorage(dirty === undefined ? {} : { [key]: dirty })
      let vm
      try {
        vm = new ViewModel({ storage })
      } catch (error) {
        crashed++
        crashDetails.push(`构造崩溃 [${key}=${label}] ${error.message}`)
        continue
      }

      try {
        const result = vmDef.load(vm)
        // load 允许返回 null，但不允许返回 undefined 之外的「半截数据」
        if (result && typeof result !== 'object') {
          crashed++
          crashDetails.push(`load 返回非法值 [${key}=${label}] ${typeof result}`)
        }
      } catch (error) {
        crashed++
        crashDetails.push(`load 崩溃 [${key}=${label}] ${error.message}`)
      }
    }
  }

  assert(
    `${vmDef.name} 脏数据不崩溃（${STORAGE_KEYS.length * Object.keys(DIRTY_VALUES).length} 组合）`,
    crashed === 0,
    crashDetails.slice(0, 5).join('\n      ')
  )
}

// ---- 汇总 ----
const failed = results.filter(item => !item.passed)

console.log('=== 脏数据压测（模拟真实 wx.getStorageSync 行为）===\n')

for (const item of results) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}`)
  if (!item.passed && item.detail) console.log(`      ${item.detail}`)
}

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) process.exit(1)
