/**
 * 临时探针：模拟「全新用户」（storage 全空）时，各页面 ViewModel 的数据是否为空。
 * 用途是定位「页面整屏白」——多数页面根部挂了 wx:if={{xxx}}，数据拿不到就整页不渲染。
 */
const path = require('path')
const ROOT = path.join(path.resolve(__dirname, '..'), 'miniprogram') + path.sep

const storage = {
  get: () => '',
  set: () => {},
  remove: () => {},
}

function show(name, obj) {
  const keys = Object.keys(obj || {})
  const dead = keys.filter((k) => {
    const v = obj[k]
    if (v === null || v === undefined) return true
    if (Array.isArray(v) && v.length === 0) return true
    return false
  })
  console.log(`\n### ${name}`)
  console.log('  keys:', keys.join(', ') || '(无)')
  console.log('  空值   :', dead.length ? dead.join(', ') : '(无)')
  if (obj && typeof obj === 'object') {
    console.log('  raw    :', JSON.stringify(obj).slice(0, 300))
  }
}

const mods = [
  ['subject-list', 'subject-list-viewmodel.js', 'SubjectListViewModel'],
  ['bank-detail', 'bank-detail-viewmodel.js', 'BankDetailViewModel'],
  ['stats', 'stats-viewmodel.js', 'StatsViewModel'],
  ['my', 'my-viewmodel.js', 'MyViewModel'],
  ['wrong-book', 'wrong-book-viewmodel.js', 'WrongBookViewModel'],
  ['settings', 'settings-viewmodel.js', 'SettingsViewModel'],
]

for (const [label, file, cls] of mods) {
  try {
    const m = require(ROOT + 'viewmodels/' + file)
    const C = m[cls]
    const vm = new C({ storage })
    show(label + ' [getInitialData]', C.getInitialData ? C.getInitialData() : {})
    if (typeof vm.load === 'function') {
      const r = vm.load()
      show(label + ' [load()]', r && r.data)
    } else {
      console.log(`\n### ${label} 没有 load()，方法有：`, Object.getOwnPropertyNames(Object.getPrototypeOf(vm)).join(', '))
    }
  } catch (e) {
    console.log(`\n### ${label}  !! ${e.message}`)
  }
}
