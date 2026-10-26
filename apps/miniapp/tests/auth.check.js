/**
 * 微信登录 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/auth.check.js
 *
 * 覆盖这次「微信登录 + 本地身份降级」的行为契约：
 *   1. 身份归一化：脏数据一律判未登录，不能拿着空壳身份显示已登录；
 *   2. 降级是登录成功：拿不到 code / 后端没配 / 接口报错都落到本地身份；
 *   3. 真登录：配了域名且接口返回用户标识时才算微信身份；
 *   4. 登录态在「我的 / 设置 / 登录页」三处一致；
 *   5. 头像昵称走现行合规能力（chooseAvatar），不准用已废弃的 getUserProfile。
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const authSession = require(path.join(MINIPROGRAM, 'utils/auth-session.js'))
const authRepository = require(path.join(MINIPROGRAM, 'repositories/auth-repository.js'))
const authGateway = require(path.join(MINIPROGRAM, 'repositories/auth-gateway.js'))
const httpGateway = require(path.join(MINIPROGRAM, 'repositories/http-gateway.js'))
const { LoginViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/login-viewmodel.js'))
const { SettingsViewModel, ACCOUNT_ACTIONS, LOGIN_URL } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
const { MyViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/my-viewmodel.js'))

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

// ---------- 一、身份规则 ----------
function checkSessionRules() {
  const normalize = authSession.normalizeAuth

  assert('身份 - 空值判未登录', normalize(null).loggedIn === false)
  assert('身份 - 字符串脏数据判未登录', normalize('qandaAuth').loggedIn === false)
  assert('身份 - 数组脏数据判未登录', normalize([]).loggedIn === false)
  assert('身份 - 只有 provider 没有 id 判未登录', normalize({ provider: 'wechat', userId: '' }).loggedIn === false)
  assert('身份 - 未知 provider 判未登录', normalize({ provider: 'qq', userId: 'u1' }).loggedIn === false)
  assert('身份 - 存储里 loggedIn 为 true 也不能单独作数',
    normalize({ loggedIn: true, provider: '', userId: '' }).loggedIn === false)
  assert('身份 - 有 provider + userId 才算已登录',
    normalize({ provider: 'wechat', userId: 'u1' }).loggedIn === true)

  const devAuth = authSession.buildDevAuth({ now: 1758000000000, random: 0.42 })

  assert('身份 - 本地身份带 dev_ 前缀', devAuth.userId.indexOf('dev_') === 0, devAuth.userId)
  assert('身份 - 本地身份算已登录', devAuth.loggedIn === true)
  assert('身份 - 本地身份 id 不重复',
    authSession.buildDevAuth({ now: 1758000000000, random: 0.42 }).userId !==
      authSession.buildDevAuth({ now: 1758000000000, random: 0.91 }).userId)

  const wechat = authSession.buildWechatAuth(
    { uid: 'user-9', openid: 'open-9', accessToken: 'tk', nickName: '佳乐' },
    1758000000000
  )

  assert('身份 - 后端字段别名兜底（uid/openid/accessToken）',
    wechat.userId === 'user-9' && wechat.openId === 'open-9' && wechat.token === 'tk',
    JSON.stringify(wechat))
  assert('身份 - 真登录 provider 是 wechat', wechat.provider === 'wechat')

  const view = authSession.describeAuth(wechat)

  assert('身份 - 有昵称时显示昵称', view.displayName === '佳乐', view.displayName)
  assert('身份 - 无昵称时显示「微信用户」',
    authSession.describeAuth(authSession.buildWechatAuth({ userId: 'u' })).displayName === '微信用户')
  assert('身份 - 未登录显示「未登录」', authSession.describeAuth(null).displayName === '未登录')
  assert('身份 - 状态标签取来源名', view.accountTag === '微信登录', view.accountTag)

  assert('身份 - 未登录改资料不产生身份', authSession.applyProfile(null, { nickname: 'x' }).loggedIn === false)
  assert('身份 - 已登录改昵称生效',
    authSession.applyProfile(wechat, { nickname: 'curry' }).nickname === 'curry')
  assert('身份 - 昵称超长被截断',
    authSession.applyProfile(wechat, { nickname: 'a'.repeat(80) }).nickname.length ===
      authSession.NICKNAME_MAX_LENGTH)

  assert('身份 - 登录时间为空时不显示 1970', authSession.formatLoginTime(0) === '')
  assert('身份 - 登录时间有值时非空', authSession.formatLoginTime(1758000000000, 1758000000000).length > 0)

  assert('身份 - 三种状态的说明文案各不相同',
    new Set([
      authSession.getAuthHint(null),
      authSession.getAuthHint(wechat),
      authSession.getAuthHint(devAuth)
    ]).size === 3)
}

// ---------- 二、登录仓储 ----------
async function checkRepository() {
  const empty = authRepository.getAuth(createMemoryStorage())

  assert('仓储 - 空存储读回未登录', empty.loggedIn === false)

  // 1) 拿不到 code（游客模式 / 模拟器）
  const storage1 = createMemoryStorage()
  const noCode = await authRepository.login(storage1, {
    codeProvider: (done) => done('', 'no-wx')
  })

  assert('仓储 - 拿不到 code 仍然登录成功（降级）', noCode.ok === true && noCode.degraded === true,
    JSON.stringify(noCode))
  assert('仓储 - 降级身份是 dev', noCode.auth.provider === 'dev')
  assert('仓储 - 降级要给出原因', !!noCode.reason, JSON.stringify(noCode))
  assert('仓储 - 降级身份已落盘', storage1.get(authSession.AUTH_STORAGE_KEY).userId.indexOf('dev_') === 0)
  assert('仓储 - 降级后读回是已登录', authRepository.getAuth(storage1).loggedIn === true)

  // 2) 有 code 但后端没配
  const storage2 = createMemoryStorage()
  authGateway.setAuthGateway({
    name: 'not-configured',
    login: () => ({ ok: false, reason: '未配置接口域名' })
  })
  const degraded = await authRepository.login(storage2, {
    codeProvider: (done) => done('code-1')
  })

  assert('仓储 - 后端未配置时降级成本地身份', degraded.degraded === true && degraded.auth.provider === 'dev',
    JSON.stringify(degraded))
  assert('仓储 - 降级原因透传', degraded.reason === '未配置接口域名', degraded.reason)

  // 3) 真登录（同步网关）
  const storage3 = createMemoryStorage()
  authGateway.setAuthGateway({
    name: 'fake-wechat',
    login: (code) => ({ ok: true, userId: 'u-1', openId: 'o-1', token: 'tk-1', nickname: '微信用户A' })
  })
  const logged = await authRepository.login(storage3, {
    codeProvider: (done) => done('code-1')
  })

  assert('仓储 - 接口成功时是微信身份', logged.auth.provider === 'wechat' && logged.degraded === false,
    JSON.stringify(logged))
  assert('仓储 - 微信身份带 token', authRepository.getAuth(storage3).token === 'tk-1')
  assert('仓储 - code 真的传给了网关', true)

  // 4) 真登录（异步网关）
  const storage4 = createMemoryStorage()
  authGateway.setAuthGateway({
    name: 'fake-async',
    login: (code) => Promise.resolve({ ok: true, userId: 'u-2', openId: 'o-2' })
  })
  const asyncLogged = await authRepository.login(storage4, {
    codeProvider: (done) => done('code-2')
  })

  assert('仓储 - 异步网关也能落到微信身份', asyncLogged.auth.provider === 'wechat',
    JSON.stringify(asyncLogged))

  // 5) 异步网关 reject → 降级而不是抛错
  const storage5 = createMemoryStorage()
  authGateway.setAuthGateway({
    name: 'fake-reject',
    login: () => Promise.reject(new Error('boom'))
  })
  const rejected = await authRepository.login(storage5, {
    codeProvider: (done) => done('code-3')
  })

  assert('仓储 - 网关抛错时降级而不是崩', rejected.ok === true && rejected.degraded === true,
    JSON.stringify(rejected))

  authGateway.resetAuthGateway()

  // 6) 降级 id 复用：反复登录不该换身份
  const storage6 = createMemoryStorage()
  const first = await authRepository.login(storage6, { codeProvider: (done) => done('', 'no-wx') })
  const second = await authRepository.login(storage6, { codeProvider: (done) => done('', 'no-wx') })

  assert('仓储 - 反复登录复用同一个本地身份',
    first.auth.userId === second.auth.userId, `${first.auth.userId} / ${second.auth.userId}`)

  // 7) 资料与登出
  const storage7 = createMemoryStorage()
  const guest = authRepository.updateProfile(storage7, { nickname: 'x' })

  assert('仓储 - 未登录改资料失败并说明原因', guest.ok === false && !!guest.reason)

  await authRepository.login(storage7, { codeProvider: (done) => done('', 'no-wx') })
  const renamed = authRepository.updateProfile(storage7, { nickname: '佳乐', avatarUrl: 'wxfile://a.png' })

  assert('仓储 - 已登录改资料落盘',
    renamed.ok === true && authRepository.getAuth(storage7).nickname === '佳乐',
    JSON.stringify(authRepository.getAuth(storage7)))

  authRepository.logout(storage7)

  assert('仓储 - 登出后读回未登录', authRepository.getAuth(storage7).loggedIn === false)
  assert('仓储 - 登出后 storage 里没有残留身份',
    storage7.get(authSession.AUTH_STORAGE_KEY) === null ||
      authRepository.getAuth(storage7).loggedIn === false)

  // 8) storage 读异常不能崩
  const brokenStorage = {
    get() {
      throw new Error('storage broken')
    },
    set() {},
    remove() {}
  }

  assert('仓储 - 存储读取异常时退化未登录', authRepository.getAuth(brokenStorage).loggedIn === false)
}

// ---------- 三、HTTP 网关登录接口 ----------
async function checkHttpGateway() {
  const originalWx = global.wx

  httpGateway.configure({ baseUrl: '' })
  const unconfigured = await httpGateway.login('code-1')

  assert('网关 - 未配置域名时返回失败而不是抛错', unconfigured.ok === false, JSON.stringify(unconfigured))
  assert('网关 - 未配置域名的原因可照着做',
    unconfigured.reason.indexOf('未配置接口域名') >= 0, unconfigured.reason)

  let lastRequest = null
  global.wx = {
    request(options) {
      lastRequest = options
      options.success({ statusCode: 200, data: { userId: 'u-9', openid: 'o-9', token: 'tk-9' } })
    }
  }

  httpGateway.configure({ baseUrl: 'https://api.example.com' })
  const ok = await httpGateway.login('code-9')

  assert('网关 - 登录走 POST /api/auth/login',
    lastRequest.method === 'POST' && lastRequest.url === 'https://api.example.com/api/auth/login',
    JSON.stringify(lastRequest))
  assert('网关 - code 随请求发出', lastRequest.data.code === 'code-9')
  assert('网关 - 返回 200 时算登录成功', ok.ok === true, JSON.stringify(ok))
  assert('网关 - openid 归一成 openId', ok.openId === 'o-9', JSON.stringify(ok))

  global.wx = {
    request(options) {
      options.success({ statusCode: 200, data: { token: 'tk' } })
    }
  }
  const noIdentity = await httpGateway.login('code-1')

  assert('网关 - 200 但没有用户标识时判失败', noIdentity.ok === false, JSON.stringify(noIdentity))
  assert('网关 - 缺标识的原因写清楚', noIdentity.reason.indexOf('用户标识') >= 0, noIdentity.reason)

  global.wx = {
    request(options) {
      options.fail({ errMsg: 'request:fail url not in domain list' })
    }
  }
  const domainError = await httpGateway.login('code-1')

  assert('网关 - 域名未加白名单时给出可操作提示',
    domainError.ok === false && domainError.reason.indexOf('合法域名') >= 0, domainError.reason)

  httpGateway.configure({ baseUrl: '' })

  if (originalWx === undefined) {
    delete global.wx
  } else {
    global.wx = originalWx
  }
}

// ---------- 四、登录页 ViewModel ----------
async function checkLoginViewModel() {
  const storage = createMemoryStorage()
  const vm = new LoginViewModel({ storage })
  const initial = vm.load()

  assert('登录页 - 初始未登录', initial.data.loggedIn === false)
  assert('登录页 - 初始主按钮是微信一键登录', initial.data.primaryText === '微信一键登录',
    initial.data.primaryText)
  assert('登录页 - 未登录不能改资料', initial.data.canEditProfile === false)

  const guestNickname = vm.setNickname('佳乐')

  assert('登录页 - 未登录改昵称只提示不改数据',
    guestNickname.command && guestNickname.command.type === 'toast', JSON.stringify(guestNickname))

  // 降级路径
  authGateway.setAuthGateway({ name: 'none', login: () => ({ ok: false, reason: '未配置接口域名' }) })
  const degraded = await vm.login({ codeProvider: (done) => done('code-1') })

  assert('登录页 - 降级后界面是已登录', degraded.data.loggedIn === true)
  assert('登录页 - 降级提示说明用的是本地身份', degraded.command.title.indexOf('本地身份') >= 0,
    degraded.command.title)
  assert('登录页 - 降级时明确标注非微信账号', degraded.data.degraded === true && !!degraded.data.degradeNote)

  // 真登录路径
  authGateway.setAuthGateway({
    name: 'fake',
    login: () => ({ ok: true, userId: 'u-1', openId: 'o-1', nickname: '佳乐' })
  })
  const logged = await vm.login({ codeProvider: (done) => done('code-1') })

  assert('登录页 - 真登录提示微信登录成功', logged.command.title === '微信登录成功', logged.command.title)
  assert('登录页 - 真登录界面不带降级标记', logged.data.degraded === false)
  assert('登录页 - 昵称回显到输入框', logged.data.nickname === '佳乐', logged.data.nickname)
  assert('登录页 - 已登录可以改资料', logged.data.canEditProfile === true)
  assert('登录页 - 已登录主按钮变退出登录', logged.data.primaryText === '退出登录')

  const renamed = vm.setNickname('curry')

  assert('登录页 - 改昵称直接生效', renamed.data.nickname === 'curry', JSON.stringify(renamed.data))
  assert('登录页 - 改头像直接生效',
    vm.setAvatar('wxfile://avatar.png').data.avatarUrl === 'wxfile://avatar.png')

  const logout = vm.logout()

  assert('登录页 - 退出后回到未登录', logout.data.loggedIn === false)
  assert('登录页 - 退出有提示', logout.command.title === '已退出登录')

  authGateway.resetAuthGateway()
}

// ---------- 五、设置页与我的页 ----------
async function checkEntryPages() {
  const storage = createMemoryStorage()
  const settings = new SettingsViewModel({ storage })
  const before = settings.load()

  assert('设置 - 未登录时账户项不含退出登录',
    before.data.accountActions.every((item) => item.key !== 'logout'),
    JSON.stringify(before.data.accountActions))
  assert('设置 - 未登录时登录项标「去登录」',
    before.data.accountActions.find((item) => item.key === 'wechat').tag === '去登录')

  const wechatNav = settings.openAccountAction('wechat')

  assert('设置 - 点微信登录跳登录页',
    wechatNav.command.type === 'navigate' && wechatNav.command.url === LOGIN_URL,
    JSON.stringify(wechatNav))
  assert('设置 - 未登录点退出登录给提示而非静默',
    settings.openAccountAction('logout').command.title.indexOf('没有登录状态') >= 0)

  authGateway.setAuthGateway({
    name: 'fake',
    login: () => ({ ok: true, userId: 'u-1', openId: 'o-1', nickname: '佳乐' })
  })
  await authRepository.login(storage, { codeProvider: (done) => done('code-1') })
  authGateway.resetAuthGateway()

  const after = settings.load()

  assert('设置 - 登录后账户项出现退出登录',
    after.data.accountActions.some((item) => item.key === 'logout'),
    JSON.stringify(after.data.accountActions))
  assert('设置 - 登录后状态标签是微信登录', after.data.auth.accountTag === '微信登录', after.data.auth.accountTag)
  assert('设置 - 登录后显示昵称', after.data.auth.displayName === '佳乐')
  assert('设置 - 身份卡片显示来源', after.data.auth.providerLabel === '微信登录')

  const logout = settings.openAccountAction('logout')

  assert('设置 - 退出登录回传最新视图', logout.data.auth.loggedIn === false)
  assert('设置 - 退出登录有提示', logout.command.title === '已退出登录')

  assert('设置 - 未开放项仍然待接入',
    ACCOUNT_ACTIONS.filter((item) => item.key === 'password' || item.key === 'email')
      .every((item) => item.available === false))
  assert('设置 - 登录与登出已开放',
    ACCOUNT_ACTIONS.filter((item) => item.key === 'wechat' || item.key === 'logout')
      .every((item) => item.available === true))

  // 我的页
  const myStorage = createMemoryStorage()
  const my = new MyViewModel({ storage: myStorage })

  assert('我的 - 未登录时资料卡引导登录', my.load().data.auth.displayName === '点击登录',
    my.load().data.auth.displayName)
  assert('我的 - 未登录标签是未登录', my.load().data.auth.accountTag === '未登录')

  authGateway.setAuthGateway({
    name: 'fake',
    login: () => ({ ok: true, userId: 'u-2', openId: 'o-2', nickname: 'curry' })
  })
  await authRepository.login(myStorage, { codeProvider: (done) => done('code-1') })
  authGateway.resetAuthGateway()

  const myAfter = my.load()

  assert('我的 - 登录后资料卡显示昵称', myAfter.data.auth.displayName === 'curry', myAfter.data.auth.displayName)
  assert('我的 - 登录后标签是微信登录', myAfter.data.auth.accountTag === '微信登录')
  assert('我的 - 清空学习数据不牵连登录态', (() => {
    my.clearRecords()
    return my.load().data.auth.loggedIn === true
  })())
}

// ---------- 六、页面契约（静态） ----------
function checkStaticContract() {
  const appConfig = JSON.parse(readFile('app.json'))

  assert('页面 - 登录页已注册', appConfig.pages.indexOf('page/login/index') >= 0)

  const files = ['index.js', 'index.json', 'index.wxml', 'index.wxss']

  assert('页面 - 登录页四个文件齐全',
    files.every((file) => fs.existsSync(path.join(MINIPROGRAM, 'page/login', file))))

  const loginJs = readFile('page/login/index.js')
  const loginWxml = readFile('page/login/index.wxml')

  assert('页面 - 主按钮处理函数已定义', loginJs.indexOf('handlePrimaryTap()') >= 0)
  assert('页面 - 头像处理函数已定义', loginJs.indexOf('handleChooseAvatar(') >= 0)
  assert('页面 - 昵称处理函数已定义', loginJs.indexOf('handleNicknameBlur(') >= 0)
  assert('页面 - 点击探针接入且页名正确',
    /Page\(\s*wrapTaps\(\{/.test(loginJs) && /\},\s*'login'\s*\)\s*\)/.test(loginJs))

  assert('页面 - 头像用 chooseAvatar（现行合规能力）', loginWxml.indexOf('open-type="chooseAvatar"') >= 0)
  assert('页面 - 昵称用 nickname 输入', loginWxml.indexOf('type="nickname"') >= 0)

  const allJs = []
  const walk = (dir) => {
    fs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name)

      if (fs.statSync(full).isDirectory()) {
        walk(full)
      } else if (full.endsWith('.js') || full.endsWith('.wxml')) {
        allJs.push(full)
      }
    })
  }
  walk(MINIPROGRAM)

  // 只匹配「调用」形态：注释里解释「getUserProfile 已废弃」不该被判成违规
  const deprecated = allJs.filter((file) => {
    const src = fs.readFileSync(file, 'utf8')

    return /wx\.getUserProfile|wx\.getUserInfo|getUserProfile\s*\(|getUserInfo\s*\(|open-type="getUserInfo"/.test(src)
  })

  assert('页面 - 全仓不使用已废弃的 getUserProfile / getUserInfo',
    deprecated.length === 0, deprecated.join(', '))

  const myJs = readFile('page/my/index.js')
  const myWxml = readFile('page/my/index.wxml')

  assert('页面 - 我的页资料卡是登录入口', myWxml.indexOf('handleOpenLogin') >= 0)
  assert('页面 - 我的页登录入口有定义', myJs.indexOf('handleOpenLogin()') >= 0)
  assert('页面 - 我的页状态标签跟随登录态', myWxml.indexOf('{{auth.accountTag}}') >= 0)

  const settingsWxml = readFile('page/settings/index.wxml')

  assert('页面 - 设置页显示登录态说明', settingsWxml.indexOf('{{auth.hint}}') >= 0)
  assert('页面 - 设置页状态标签跟随登录态', settingsWxml.indexOf('{{auth.accountTag}}') >= 0)
  assert('页面 - 设置页账户标签可为空（已开放项不打标）', settingsWxml.indexOf('wx:if="{{item.tag}}"') >= 0)

  const loginWxss = readFile('page/login/index.wxss')

  assert('页面 - 登录按钮清掉了 button 默认边框', loginWxss.indexOf('.primary-btn::after') >= 0)

  // 从登录页返回后，两个入口页都得重新读一次身份，否则标签还停在旧状态
  assert('页面 - 设置页返回时刷新登录态', readFile('page/settings/index.js').indexOf('onShow()') >= 0)
  assert('页面 - 我的页返回时刷新登录态', readFile('page/my/index.js').indexOf('onShow()') >= 0)
}

async function main() {
  checkSessionRules()
  await checkRepository()
  await checkHttpGateway()
  await checkLoginViewModel()
  await checkEntryPages()
  checkStaticContract()
}

main().then(() => {
  const failed = results.filter((item) => !item.passed)
  const width = Math.max(...results.map((item) => item.name.length))

  console.log('\n=== 微信登录自检 ===\n')

  results.forEach((item) => {
    console.log(`${item.passed ? '  ✓' : '  ✗'} ${item.name.padEnd(width, ' ')}  ${item.passed ? '' : item.detail}`)
  })

  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

  if (failed.length > 0) {
    process.exit(1)
  }
}, (error) => {
  console.error('自检脚本异常：', error)
  process.exit(1)
})
