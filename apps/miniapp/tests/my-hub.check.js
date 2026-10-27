/**
 * 我的 / 账号管理 / 邮箱提醒 —— 页面与规则自检。
 * 运行：node apps/miniapp/tests/my-hub.check.js
 *
 * 这一版按设计稿重做了三页（Figma 781:1922 / 781:2123 / 781:2043），
 * 本脚本锁住四件容易回退的事：
 *   1. **入口唯一**：「我的」是设置总入口，账户操作只在账号管理页，不许再长出第二份；
 *   2. **尺寸来源唯一**：三页都引 styles/list-page.wxss，换算系数 750/402；
 *   3. **邮箱提醒的规则**：时间格式、提前提醒至少留一个、考试名与日期必填、
 *      重复添加要拦、脏数据一律回落默认；
 *   4. **自定义布局真的生效**：答题页按偏好调换题干与选项顺序（用 order，不改 DOM）。
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const appConfig = JSON.parse(fs.readFileSync(path.join(MINIPROGRAM, 'app.json'), 'utf8'))
const reminderSettings = require(path.join(MINIPROGRAM, 'utils/reminder-settings.js'))
const preferences = require(path.join(MINIPROGRAM, 'utils/preferences.js'))
const authSession = require(path.join(MINIPROGRAM, 'utils/auth-session.js'))
const { MyViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/my-viewmodel.js'))
const { AccountViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/account-viewmodel.js'))
const { ReminderViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/reminder-viewmodel.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(MINIPROGRAM, relativePath), 'utf8')
}

function createMemoryStorage() {
  const map = {}

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

function seedEmailAuth(storage, extra) {
  storage.set('qandaAuth', authSession.buildEmailAuth(Object.assign({
    email: 'jiale@qq.com',
    nickname: '铁柱'
  }, extra || {})))
}

// ---------- 一、页面注册与尺寸来源 ----------

function checkPages() {
  const pages = ['page/my/index', 'page/account/index', 'page/reminder/index']

  pages.forEach((page) => {
    assert(`页面 - ${page} 已注册`, appConfig.pages.indexOf(page) >= 0)
  })

  pages.forEach((page) => {
    const files = ['index.js', 'index.json', 'index.wxml', 'index.wxss']
    // page 已经是 page/xxx/index，去掉最后一段才是目录
    const dir = page.replace(/\/index$/, '')
    const missing = files.filter((file) => !fs.existsSync(path.join(MINIPROGRAM, dir, file)))

    assert(`页面 - ${page} 四个文件齐全`, missing.length === 0, missing.join(', '))
  })

  // 三页共用一份尺寸来源，否则会慢慢长歪
  ;['my', 'account', 'reminder'].forEach((name) => {
    const wxss = readFile(`page/${name}/index.wxss`)

    assert(`样式 - ${name} 页引入公用列表样式`, wxss.indexOf('styles/list-page.wxss') >= 0)
  })

  const shared = readFile('styles/list-page.wxss')

  // 设计稿取色：主色 #466BFF、正文 #141820、次要 #8B8F99、分隔线 #EEF0F5
  ;['#466bff', '#141820', '#8b8f99', '#eef0f5'].forEach((color) => {
    assert(`样式 - 公用样式含设计稿色值 ${color}`, shared.toLowerCase().indexOf(color) >= 0)
  })

  // 22px 页边距 → 41rpx；54px 行高 → 101rpx（系数 750/402）
  assert('样式 - 页边距按 750/402 换算', /\.list-page\s*\{[^}]*padding:\s*0 41rpx/.test(shared))
  assert('样式 - 行高按 750/402 换算', /\.row\s*\{[^}]*min-height:\s*101rpx/.test(shared))
}

// ---------- 二、我的页：入口唯一 ----------

function checkMyViewModel() {
  const guestStorage = createMemoryStorage()
  const guest = new MyViewModel({ storage: guestStorage }).load().data

  assert('我的 - 未登录资料头引导登录', guest.auth.displayName === '点击登录', guest.auth.displayName)
  assert('我的 - 未登录副行给账号状态', guest.auth.subText === '未登录', guest.auth.subText)
  assert('我的 - 未登录不显示退出登录',
    guest.otherRows.every((item) => item.key !== 'logout'),
    JSON.stringify(guest.otherRows))
  assert('我的 - 学习设置三行齐全',
    guest.learnRows.map((item) => item.key).join(',') === 'practice,layout,reminder',
    JSON.stringify(guest.learnRows.map((item) => item.key)))
  assert('我的 - 法律协议两条', guest.links.length === 2)

  const storage = createMemoryStorage()
  seedEmailAuth(storage, { college: '计算机科学与技术学院' })

  const vm = new MyViewModel({ storage })
  const data = vm.load().data

  assert('我的 - 登录后显示昵称', data.auth.displayName === '铁柱', data.auth.displayName)
  assert('我的 - 登录后副行是学院', data.auth.subText === '计算机科学与技术学院', data.auth.subText)
  assert('我的 - 邮箱脱敏显示', data.auth.emailMasked.indexOf('@qq.com') > 0 && data.auth.emailMasked.indexOf('jiale@') < 0,
    data.auth.emailMasked)
  assert('我的 - 登录后出现退出登录',
    data.otherRows.some((item) => item.key === 'logout'),
    JSON.stringify(data.otherRows))

  // 路由
  assert('我的 - 账号管理进账号页', vm.tapRow('account').command.url === '/page/account/index')
  assert('我的 - 答题偏好进设置页偏好锚点',
    vm.tapRow('practice').command.url === '/page/settings/index?focus=practice',
    vm.tapRow('practice').command.url)
  assert('我的 - 邮箱提醒进提醒页', vm.tapRow('reminder').command.url === '/page/reminder/index')

  // 学习设置的右侧摘要跟着真实设置走
  const prefs = preferences.setPreferenceChoice(
    preferences.setPreferenceSwitch(preferences.normalizePreferences(null), 'autoShowExplanation', false),
    'answerLayout',
    'above'
  )
  storage.set('qandaPreferences', prefs)
  storage.set('qandaReminder', reminderSettings.setReminderSwitch(null, 'enabled', false))

  const changed = vm.load().data

  assert('我的 - 摘要跟随「只标对错」',
    changed.learnRows.find((item) => item.key === 'practice').value === '仅看对错',
    changed.learnRows.find((item) => item.key === 'practice').value)
  assert('我的 - 摘要跟随「选项在上」',
    changed.learnRows.find((item) => item.key === 'layout').value === '选项在上',
    changed.learnRows.find((item) => item.key === 'layout').value)
  assert('我的 - 摘要跟随提醒开关',
    changed.learnRows.find((item) => item.key === 'reminder').value === '已关闭',
    changed.learnRows.find((item) => item.key === 'reminder').value)

  // 弹层
  assert('我的 - 关于弹层有题库规模', vm.openSheet('about').data.about.questionCount > 0)
  assert('我的 - 协议弹层有正文', vm.openSheet('agreement').data.sheetBody.length > 10)
  assert('我的 - 隐私弹层有正文', vm.openSheet('privacy').data.sheetBody.length > 10)
  assert('我的 - 关闭弹层清空状态', vm.closeSheet().data.sheet === '')
  assert('我的 - 未知行返回空', vm.tapRow('unknown') === null)

  // 退出登录：只清身份，不动学习数据
  const logout = vm.logout()

  assert('我的 - 退出登录回传未登录视图', logout.data.auth.loggedIn === false)
  assert('我的 - 退出登录有提示', logout.command.title === '已退出登录')
  assert('我的 - 重复退出给提示而非静默', vm.logout().command.title.indexOf('没有登录') >= 0)
}

// ---------- 三、账号管理 ----------

function checkAccountViewModel() {
  const guest = new AccountViewModel({ storage: createMemoryStorage() })

  assert('账号 - 未登录保存先去登录',
    guest.save().command.type === 'navigate' && guest.save().command.url === '/page/login/index',
    JSON.stringify(guest.save()))

  const storage = createMemoryStorage()
  seedEmailAuth(storage)

  const vm = new AccountViewModel({ storage })
  const loaded = vm.load().data

  assert('账号 - 邮箱身份密码状态为已设置', loaded.profile.passwordStatus === '已设置',
    loaded.profile.passwordStatus)
  assert('账号 - 邮箱身份微信为未绑定', loaded.profile.wechatStatus === '未绑定')
  assert('账号 - 初始无改动', loaded.dirty === false)

  assert('账号 - 未改动直接保存给提示', vm.save().command.title === '资料没有改动')

  vm.setField('nickname', '佳乐')
  vm.setField('college', '计算机科学与技术学院')

  assert('账号 - 有改动后按钮可用', vm.setField('college', '计算机学院').data.dirty === true)

  const saved = vm.save()
  const stored = authSession.normalizeAuth(storage.get('qandaAuth'))

  assert('账号 - 保存有提示', saved.command.title === '资料已保存')
  assert('账号 - 昵称落盘', stored.nickname === '佳乐', stored.nickname)
  assert('账号 - 学院落盘', stored.college === '计算机学院', stored.college)
  assert('账号 - 保存后回到无改动', saved.data.dirty === false)

  // 改密码 → 找回密码页，带上邮箱省得再敲一遍
  const password = vm.tapPassword()

  assert('账号 - 改密码走找回密码页',
    password.command.type === 'navigate' &&
      password.command.url.indexOf('/page/forgot-password/index') === 0,
    JSON.stringify(password))

  // 换邮箱 / 微信绑定还没接后端：必须给说明，不能静默
  assert('账号 - 换邮箱给说明', vm.tapEmail().command.title.indexOf('后端') >= 0)
  assert('账号 - 微信绑定给说明', vm.tapWechat().command.title.indexOf('微信') >= 0)

  // 微信身份下没有密码可改
  const wechatStorage = createMemoryStorage()
  wechatStorage.set('qandaAuth', authSession.buildWechatAuth({ userId: 'u-9', openId: 'o-9', nickname: 'curry' }))

  const wechatVm = new AccountViewModel({ storage: wechatStorage })

  assert('账号 - 微信身份下密码未设置', wechatVm.load().data.profile.passwordStatus === '未设置')
  assert('账号 - 微信身份改密码给说明而非跳转',
    !wechatVm.tapPassword().command.url, JSON.stringify(wechatVm.tapPassword()))
}

// ---------- 四、邮箱提醒：规则 ----------

function checkReminderRules() {
  const defaults = reminderSettings.normalizeReminder(null)

  assert('提醒 - 默认开启', defaults.enabled === true && defaults.reviewEnabled === true &&
    defaults.examEnabled === true)
  assert('提醒 - 默认时间 20:00', defaults.reviewTime === '20:00', defaults.reviewTime)
  assert('提醒 - 默认每天', defaults.frequency === 'daily')
  assert('提醒 - 默认勾 7 天前与当天', defaults.advanceDays.join(',') === '7,0', defaults.advanceDays.join(','))

  // 脏数据一律回落默认，不能把 '25:99' 存进去
  const dirty = reminderSettings.normalizeReminder({
    enabled: 'yes',
    reviewTime: '25:99',
    frequency: 'hourly',
    advanceDays: [99, 3],
    exams: [{ name: '', date: '2026-01-01' }, { name: '大学语文', date: '2026-13-45' }]
  })

  assert('提醒 - 脏开关回落默认', dirty.enabled === true)
  assert('提醒 - 脏时间回落默认', dirty.reviewTime === '20:00', dirty.reviewTime)
  assert('提醒 - 脏频率回落默认', dirty.frequency === 'daily')
  assert('提醒 - 脏提前天数被过滤', dirty.advanceDays.join(',') === '3', dirty.advanceDays.join(','))
  assert('提醒 - 脏考试被丢弃', dirty.exams.length === 0, JSON.stringify(dirty.exams))

  // 至少保留一个提前提醒
  let one = reminderSettings.toggleAdvanceDay(defaults, 7)

  one = reminderSettings.toggleAdvanceDay(one, 0)

  assert('提醒 - 提前提醒至少留一个', one.advanceDays.length === 1, one.advanceDays.join(','))

  // 添加考试
  const added = reminderSettings.addExam(defaults, { name: '大学英语', date: '2026-10-22' })

  assert('提醒 - 添加考试成功', added.ok === true && added.reminder.exams.length === 1)
  assert('提醒 - 同名同日不能重复添加',
    reminderSettings.addExam(added.reminder, { name: '大学英语', date: '2026-10-22' }).ok === false)
  assert('提醒 - 考试名称必填',
    reminderSettings.addExam(defaults, { name: '   ', date: '2026-10-22' }).reason.indexOf('名称') >= 0)
  assert('提醒 - 考试日期必须能解析',
    reminderSettings.addExam(defaults, { name: 'x', date: '2026-13-45' }).reason.indexOf('日期') >= 0)

  // 状态文案：已结束 / 今天 / N天后
  const now = new Date(2026, 9, 27, 9, 0, 0).getTime()

  assert('提醒 - 过去的考试显示已结束',
    reminderSettings.buildExamStatus('2026-10-15', now).text === '已结束')
  assert('提醒 - 当天显示今天',
    reminderSettings.buildExamStatus('2026-10-27', now).text === '今天')
  assert('提醒 - 未来显示 N天后',
    reminderSettings.buildExamStatus('2026-11-01', now).text === '5天后',
    reminderSettings.buildExamStatus('2026-11-01', now).text)

  // 视图：日期用斜杠、未开启给「已关闭」
  const view = reminderSettings.buildReminderView(added.reminder, { emailMasked: 'j***@qq.com', now })

  assert('提醒 - 视图日期是斜杠写法', view.exams[0].dateText === '2026/10/22', view.exams[0].dateText)
  assert('提醒 - 视图带脱敏邮箱', view.emailMasked === 'j***@qq.com')
  assert('提醒 - 频率给 picker 文案与下标',
    view.frequencyOptions.length === 3 && view.frequencyIndex === 0,
    `${view.frequencyOptions.join('/')} @${view.frequencyIndex}`)
  assert('提醒 - 关闭后摘要「已关闭」',
    reminderSettings.buildReminderView(
      reminderSettings.setReminderSwitch(added.reminder, 'enabled', false)
    ).summaryLabel === '已关闭')
}

// ---------- 五、邮箱提醒：页面 ViewModel ----------

function checkReminderViewModel() {
  const storage = createMemoryStorage()
  seedEmailAuth(storage)

  const vm = new ReminderViewModel({ storage })
  const loaded = vm.load().data

  assert('提醒页 - 显示脱敏收件邮箱', loaded.emailMasked.indexOf('@qq.com') > 0, loaded.emailMasked)
  assert('提醒页 - 默认三组开关都开', loaded.enabled && loaded.reviewEnabled && loaded.examEnabled)

  vm.toggleSwitch('enabled', false)

  assert('提醒页 - 关总开关即时落盘',
    reminderSettings.normalizeReminder(storage.get('qandaReminder')).enabled === false)

  vm.toggleSwitch('enabled', true)
  vm.pickTime('07:30')

  assert('提醒页 - 改时间即时落盘',
    reminderSettings.normalizeReminder(storage.get('qandaReminder')).reviewTime === '07:30')

  vm.pickTime('25:99')

  assert('提醒页 - 非法时间不改数据',
    reminderSettings.normalizeReminder(storage.get('qandaReminder')).reviewTime === '07:30')

  vm.pickFrequencyIndex(1)

  assert('提醒页 - 频率按 picker 下标改',
    reminderSettings.normalizeReminder(storage.get('qandaReminder')).frequency === 'weekday')

  // 添加考试：弹层开 → 填 → 确认
  const opened = vm.openAddSheet()

  assert('提醒页 - 打开添加弹层带今天日期',
    opened.data.addSheetVisible === true && /^\d{4}-\d{2}-\d{2}$/.test(opened.data.examDraftDate),
    JSON.stringify(opened.data))

  assert('提醒页 - 弹层名称未填时拦住', vm.confirmAddExam().command.title.indexOf('名称') >= 0)

  vm.setExamDraftName('大学语文')
  vm.setExamDraftDate('2026-10-15')

  const added = vm.confirmAddExam()

  assert('提醒页 - 添加后弹层关闭', added.data.addSheetVisible === false)
  assert('提醒页 - 添加后列表出现该考试',
    added.data.exams.length === 1 && added.data.exams[0].name === '大学语文',
    JSON.stringify(added.data.exams))

  const removed = vm.removeExam(added.data.exams[0].id)

  assert('提醒页 - 删除考试', removed.data.exams.length === 0)
  assert('提醒页 - 保存给确认提示', vm.save().command.title === '设置已保存')
}

// ---------- 六、自定义布局真的生效 ----------

function checkAnswerLayout() {
  const defaultPrefs = preferences.normalizePreferences(null)

  assert('布局 - 默认选项在下', defaultPrefs.answerLayout === 'below')
  assert('布局 - 可切到选项在上',
    preferences.setPreferenceChoice(defaultPrefs, 'answerLayout', 'above').answerLayout === 'above')
  assert('布局 - 非法值不生效',
    preferences.setPreferenceChoice(defaultPrefs, 'answerLayout', 'side').answerLayout === 'below')
  assert('布局 - 摘要文案跟随取值',
    preferences.describeChoiceLabel({ answerLayout: 'above' }, 'answerLayout') === '选项在上')

  const practiceWxml = readFile('page/practice/index.wxml')
  const practiceWxss = readFile('page/practice/index.wxss')

  assert('布局 - 答题页按偏好切换顺序类',
    practiceWxml.indexOf('pra-content-above') >= 0 && practiceWxml.indexOf('preferences.answerLayout') >= 0)
  // 调换顺序必须用 order，不能重排 DOM：重排 scroll-view 的子节点会让滚动位置跳
  assert('布局 - 用 flex order 调换而不是重排 DOM',
    /\.pra-content-above \.pra-stem\s*\{[^}]*order:\s*2/.test(practiceWxss) &&
      /\.pra-content-above \.pra-options\s*\{[^}]*order:\s*1/.test(practiceWxss),
    '缺少 order 规则')
  assert('布局 - 题干与选项都在同一个 flex 容器里',
    /\.pra-content\s*\{[^}]*display:\s*flex/.test(practiceWxss))
}

// ---------- 七、交互与文档 ----------

function checkInteraction() {
  const pages = ['my', 'account', 'reminder']

  pages.forEach((name) => {
    const wxml = readFile(`page/${name}/index.wxml`)
    const taps = wxml.match(/bindtap="[a-zA-Z]+"/g) || []
    const withoutFeedback = taps.filter((tap) => {
      const handler = tap.match(/bindtap="([a-zA-Z]+)"/)[1]
      const index = wxml.indexOf(`bindtap="${handler}"`)
      const window = wxml.slice(index, index + 320)

      return window.indexOf('hover-class=') < 0
    })

    assert(`${name} 页 - 可点元素都有 hover-class`, withoutFeedback.length === 0,
      withoutFeedback.join(', '))
  })

  // 文档同步：交接文档要提到新增的两页
  const agentsDoc = readFile('../AGENTS.md')

  assert('文档 - 交接文档列出账号管理页', agentsDoc.indexOf('page/account') >= 0)
  assert('文档 - 交接文档列出邮箱提醒页', agentsDoc.indexOf('page/reminder') >= 0)
}

// ---------- 汇总 ----------

function main() {
  checkPages()
  checkMyViewModel()
  checkAccountViewModel()
  checkReminderRules()
  checkReminderViewModel()
  checkAnswerLayout()
  checkInteraction()

  const failed = results.filter((item) => !item.passed)

  results.forEach((item) => {
    console.log(`  ${item.passed ? '✓' : '✗'} ${item.name}${item.passed ? '' : `  ← ${item.detail}`}`)
  })

  console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

  if (failed.length) {
    process.exitCode = 1
  }
}

main()
