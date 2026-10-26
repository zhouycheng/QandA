/**
 * 考试倒计时（设置页 → 首页）全链路 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/exam-countdown.check.js
 *
 * 这条链路跨两个页面，靠一个 storage key 串起来，最容易出的不是算错天数，
 * 而是「半套状态」：填了名字没选日期、选了日期没填名字、清了一个留了另一个。
 * 这些状态在首页的表现各不相同，必须在设置页这一侧就堵住。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const examCountdown = require(path.join(MINIPROGRAM, 'utils/exam-countdown.js'))
const preferences = require(path.join(MINIPROGRAM, 'utils/preferences.js'))
const { SettingsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
const { SubjectListViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/subject-list-viewmodel.js'))
const practiceRepository = require(path.join(MINIPROGRAM, 'repositories/practice-repository.js'))

const results = []

function assert(name, condition, detail) {
  results.push({ name, passed: !!condition, detail: condition ? '' : detail || '' })
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

/** 用真实的 practice-repository 驱动，才能验到「落盘 → 读回」这一步 */
function createViewModel(storage) {
  return new SettingsViewModel({ repository: practiceRepository, storage })
}

function createHomeViewModel(storage) {
  return new SubjectListViewModel({ repository: practiceRepository, storage })
}

const at = (y, m, d, hour = 10) => new Date(y, m - 1, d, hour, 0, 0, 0).getTime()
const NOW = at(2026, 12, 1)

/**
 * 设置页 ViewModel 不注入时间，走的是真实 Date.now()。
 * 所以跨页断言不能写死天数，必须按运行当天算，否则换个日期跑就红了。
 */
function daysTo(dateKey) {
  return examCountdown.diffCalendarDays(Date.now(), examCountdown.parseDateKey(dateKey))
}

// ---------- 一、偏好层 ----------

function checkPreferences() {
  const defaults = preferences.normalizePreferences(null)

  assert('偏好 - 默认不含考试名称', defaults.examName === '')
  assert('偏好 - 默认不含考试日期', defaults.examDate === '')

  // 补齐：老用户存的是没有这两个键的旧对象
  const filled = preferences.normalizePreferences({ fontSize: 'large' })
  assert('偏好 - 旧数据自动补齐 examName', filled.examName === '')
  assert('偏好 - 补齐时不影响已有字段', filled.fontSize === 'large')

  // 脏数据：类型不对时必须退回空串，不能把 [object Object] 渲染到卡片上
  assert('偏好 - 非字符串 examName 归一化为空',
    preferences.normalizePreferences({ examName: { a: 1 } }).examName === '')
  assert('偏好 - 非字符串 examDate 归一化为空',
    preferences.normalizePreferences({ examDate: 20261210 }).examDate === '')

  const set = preferences.setPreferenceText(preferences.normalizePreferences(null), 'examName', '研究生入学考试')
  assert('偏好 - setPreferenceText 写入名称', set.examName === '研究生入学考试')
  assert('偏好 - setPreferenceText 不破坏其它字段', typeof set.fontSize === 'string')

  // 只允许白名单键被写入，防止页面把任意字符串塞进偏好
  const blocked = preferences.setPreferenceText(preferences.normalizePreferences(null), 'unknownKey', 'x')
  assert('偏好 - 非白名单键不被写入', blocked.unknownKey === undefined)

  assert('偏好 - 文本键白名单含两个考试字段',
    preferences.TEXT_PREFERENCE_KEYS.indexOf('examName') >= 0 &&
    preferences.TEXT_PREFERENCE_KEYS.indexOf('examDate') >= 0)
}

// ---------- 二、日期边界 ----------

function checkDateBoundaries() {
  assert('边界 - 今天考试算 0 天',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2026-12-01' }, NOW).daysLeft === 0)
  assert('边界 - 明天考试算 1 天',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2026-12-02' }, NOW).daysLeft === 1)
  assert('边界 - 昨天考试标记为已过去',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2026-11-30' }, NOW).isPast === true)

  // 跨年
  assert('边界 - 跨年倒计时正确',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2027-01-01' }, NOW).daysLeft === 31)

  // 闰年 2 月 29 日
  assert('边界 - 闰年 2 月 29 日合法',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2028-02-29' }, at(2028, 1, 1)).configured === true)

  const invalid = ['2026-02-30', '2026-13-01', '2026-00-10', '20261201', '2026/12/01', '']
  const wronglyAccepted = invalid.filter((date) =>
    examCountdown.buildExamCountdown({ examName: 'A', examDate: date }, NOW).configured === true)

  assert('边界 - 非法日期一律视为未设置', wronglyAccepted.length === 0, wronglyAccepted.join(', '))
  assert('边界 - 校验器拒绝早于今天的日期',
    examCountdown.validateExamInput('A', '2026-11-30', NOW).ok === false)
  assert('边界 - 校验器接受今天', examCountdown.validateExamInput('A', '2026-12-01', NOW).ok === true)

  // toDateKey 必须补零，否则 '2026-1-5' 会让 picker 的 start 失效
  assert('边界 - toDateKey 补零', examCountdown.toDateKey(at(2026, 1, 5)) === '2026-01-05',
    examCountdown.toDateKey(at(2026, 1, 5)))

  // 进度条：30 天准备期折算，不应出现负数或超过 100
  assert('边界 - 进度不超过 100',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2027-12-01' }, NOW).progressPercent === 100)
  assert('边界 - 进度不低于 0',
    examCountdown.buildExamCountdown({ examName: 'A', examDate: '2026-11-01' }, NOW).progressPercent === 0)
}

// ---------- 三、设置页链路 ----------

function checkSettingsFlow() {
  const storage = createMemoryStorage()
  const vm = createViewModel(storage)

  // 初始状态
  const initial = vm.buildData()
  assert('设置 - 初始为未配置', initial.exam.configured === false)
  assert('设置 - 初始草稿名为空', initial.examDraftName === '')
  assert('设置 - 提供 picker 起始日期', /^\d{4}-\d{2}-\d{2}$/.test(vm.getTodayDateKey()), vm.getTodayDateKey())

  // 只填名称：不该生成倒计时（没有日期）
  vm.setExamName('研究生入学考试')
  let data = vm.buildData()
  assert('设置 - 只填名称时不算已配置', data.exam.configured === false)
  assert('设置 - 只填名称时提示待设置日期', data.exam.title.indexOf('待设置日期') >= 0, data.exam.title)
  assert('设置 - 名称回显到草稿', data.examDraftName === '研究生入学考试')

  // 补上日期：这时才成立
  vm.setExamDate('2026-12-20')
  data = vm.buildData()
  assert('设置 - 名称与日期齐全后已配置', data.exam.configured === true)
  assert('设置 - 天数计算正确', data.exam.daysLeft === daysTo('2026-12-20'),
    `实际 ${data.exam.daysLeft}，期望 ${daysTo('2026-12-20')}`)

  // 清除：两个字段一起清，不留半套状态
  vm.clearExam()
  data = vm.buildData()
  assert('设置 - 清除后回到未配置', data.exam.configured === false)
  assert('设置 - 清除后名称也清空', data.examDraftName === '')

  const afterClear = practiceRepository.getPreferences(storage)
  assert('设置 - 清除后 storage 里名称为空', (afterClear.examName || '') === '')
  assert('设置 - 清除后 storage 里日期为空', (afterClear.examDate || '') === '')

  // 只选日期没填名称：先存下日期，提示补名称
  vm.setExamDate('2026-12-25')
  data = vm.buildData()
  assert('设置 - 未填名称时仍不能算已配置', data.exam.configured === false,
    `title=${data.exam.title}`)
  // 只选了日期会出现「距离 考试 考试还有 N 天」，所以引导态必须提示补名称
  assert('设置 - 未填名称时提示补名称', data.exam.statusText === '去补名称', data.exam.statusText)
  assert('设置 - 未填名称时标题含待填写名称', data.exam.title.indexOf('待填写名称') >= 0, data.exam.title)

  const withDateOnly = practiceRepository.getPreferences(storage)
  assert('设置 - 未填名称时日期已先存下', withDateOnly.examDate === '2026-12-25')

  // 名称清空 → 连带清日期
  vm.setExamName('期末考试')
  vm.setExamName('   ')
  data = vm.buildData()
  assert('设置 - 名称清空会连带清掉日期', data.exam.configured === false)

  const clearedByEmptyName = practiceRepository.getPreferences(storage)
  assert('设置 - 名称清空后 storage 日期也为空', (clearedByEmptyName.examDate || '') === '')
}

// ---------- 四、设置页 → 首页 ----------

function checkCrossPage() {
  const storage = createMemoryStorage()
  const settings = createViewModel(storage)

  settings.setExamName('期末考试')
  settings.setExamDate('2026-12-15')

  // 首页是另一个 ViewModel，只能从 storage 读回 —— 验的就是这条链路
  const home = createHomeViewModel(storage).load()
  assert('跨页 - 首页读到设置页写入的考试', home.data.exam.configured === true)
  assert('跨页 - 首页天数与设置页一致', home.data.exam.daysLeft === daysTo('2026-12-15'),
    `实际 ${home.data.exam.daysLeft}，期望 ${daysTo('2026-12-15')}`)
  assert('跨页 - 首页标题含考试名与日期', home.data.exam.examName === '期末考试')

  // 只有日期没有名称时，首页不能显示一个没有名字的倒计时
  const dateOnlyStorage = createMemoryStorage({
    qandaPreferences: { examName: '', examDate: '2026-12-15' }
  })
  const dateOnlyHome = createHomeViewModel(dateOnlyStorage).load().data.exam

  assert('跨页 - 只有日期时首页不显示倒计时', dateOnlyHome.configured === false)
  assert('跨页 - 只有日期时首页不出天数', dateOnlyHome.dayText === '')

  // 清空后首页必须立刻回到引导态，不能残留旧天数
  settings.clearExam()
  const homeAfter = createHomeViewModel(storage).load()
  assert('跨页 - 清除后首页回到未配置', homeAfter.data.exam.configured === false)
  assert('跨页 - 清除后首页不显示天数', homeAfter.data.exam.dayText === '')

  assert('跨页 - 未配置时提供设置入口',
    homeAfter.data.exam.statusText === '去设置', homeAfter.data.exam.statusText)
}

// ---------- 五、脏数据不崩 ----------

function checkDirtyData() {
  const cases = [
    { label: '偏好是字符串', value: 'oops' },
    { label: '偏好是数组', value: [] },
    { label: 'examName 是数字', value: { examName: 123, examDate: 456 } },
    { label: 'examDate 是过去', value: { examName: 'A', examDate: '2020-01-01' } }
  ]

  cases.forEach((item) => {
    const storage = createMemoryStorage({ qandaPreferences: item.value })
    let data = null
    let threw = false

    try {
      data = createHomeViewModel(storage).load().data
    } catch (error) {
      threw = true
    }

    assert(`脏数据 - ${item.label} 时首页不崩`, threw === false)
    assert(`脏数据 - ${item.label} 时 exam 仍是可渲染对象`,
      data && data.exam && typeof data.exam.title === 'string' && typeof data.exam.dayText === 'string')
  })

  // 过去日期：显示「已结束」而不是负数天
  const pastStorage = createMemoryStorage({
    qandaPreferences: { examName: 'A', examDate: '2020-01-01' }
  })
  const pastExam = createHomeViewModel(pastStorage).load().data.exam

  assert('脏数据 - 过去日期显示「已结束」而不是负数',
    pastExam.dayText === '已结束', pastExam.dayText)
}

// ---------- 输出 ----------

checkPreferences()
checkDateBoundaries()
checkSettingsFlow()
checkCrossPage()
checkDirtyData()

const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  if (!item.passed) {
    console.log(`FAIL  ${item.name}${item.detail ? ` —— ${item.detail}` : ''}`)
  }
})

console.log(`\n考试倒计时自检：总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exitCode = 1
}
