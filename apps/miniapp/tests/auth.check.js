/** 登录身份、失败处理和页面契约自检。 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const authSession = require(path.join(MINIPROGRAM, 'utils/auth-session.js'))
const authRepository = require(path.join(MINIPROGRAM, 'repositories/auth-repository.js'))
const authGateway = require(path.join(MINIPROGRAM, 'repositories/auth-gateway.js'))
const httpGateway = require(path.join(MINIPROGRAM, 'repositories/http-gateway.js'))
const { LoginViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/login-viewmodel.js'))
const { SettingsViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/settings-viewmodel.js'))
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
    normalize({ provider: 'wechat', userId: 'u1', token: 'tk' }).loggedIn === true)

  const devAuth = normalize({ provider: 'dev', userId: 'dev_old', token: 'old' })
  assert('身份 - 旧本地身份保持未登录', !devAuth.loggedIn)

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
    authSession.describeAuth(authSession.buildWechatAuth({ userId: 'u', token: 'tk' })).displayName === '微信用户')
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

  assert('身份 - 登录和未登录说明各不相同',
    new Set([
      authSession.getAuthHint(null),
      authSession.getAuthHint(wechat)
    ]).size === 2)
}

// ---------- 二、登录仓储 ----------
async function checkRepository() {
  const storage = createMemoryStorage()
  const noCode = await authRepository.login(storage, { codeProvider: (done) => done('') })
  assert('仓储 - 缺少微信凭证时保持未登录', !noCode.ok && !noCode.auth.loggedIn)
  authGateway.setAuthGateway({ login: () => ({ ok: false, unavailable: true, reason: '断网' }) })
  const offline = await authRepository.login(storage, { codeProvider: (done) => done('code') })
  assert('仓储 - 断网时保留失败原因', !offline.ok && offline.reason === '断网')
  assert('仓储 - 断网不保存身份', storage.get(authSession.AUTH_STORAGE_KEY) === null)
  authGateway.setAuthGateway({ login: () => Promise.resolve({ ok: true, userId: 'u1', token: 'tk1' }) })
  const online = await authRepository.login(storage, { codeProvider: (done) => done('code') })
  assert('仓储 - 服务端身份落盘', online.ok && authRepository.getAuth(storage).userId === 'u1')
  assert('仓储 - 资料缓存保留身份', authRepository.updateProfile(storage, { nickname: '佳乐' }).auth.nickname === '佳乐')
  authRepository.logout(storage)
  assert('仓储 - 退出后未登录', !authRepository.getAuth(storage).loggedIn)
  authGateway.resetAuthGateway()
}

// ---------- 三、HTTP 网关登录接口 ----------
async function checkHttpGateway() {
  const originalWx = global.wx
  httpGateway.configure({ baseUrl: 'https://api.example.com' })
  const calls = []
  global.wx = { request(options) {
    calls.push(options)
    options.success({ statusCode: 200, data: options.url.endsWith('/me') ? { id: 'u9', nickname: '昵称' } : { session: { accessToken: 'tk9' } } })
  } }
  const result = await httpGateway.login('code9')
  assert('网关 - 微信 code 交给 v1 会话接口', calls[0].url.endsWith('/api/v1/auth/wechat-sessions') && calls[0].data.code === 'code9')
  assert('网关 - 用令牌读取统一用户资料', calls[1].header.Authorization === 'Bearer tk9' && result.userId === 'u9')
  global.wx = { request(options) { options.success({ statusCode: 200, data: {} }) } }
  assert('网关 - 缺少身份时返回失败', !(await httpGateway.login('code')).ok)
  httpGateway.configure({ baseUrl: '' })
  assert('网关 - 未配置域名时返回失败', !(await httpGateway.login('code')).ok)
  if (originalWx === undefined) delete global.wx
  else global.wx = originalWx
}

// ---------- 四、登录页 ViewModel（设计稿 763:567：邮箱密码为主，微信登录为辅） ----------
async function checkLoginViewModel() {
  const storage = createMemoryStorage()
  const vm = new LoginViewModel({ storage })
  const initial = vm.load()

  assert('登录页 - 初始字段为空', initial.data.email === '' && initial.data.password === '')
  assert('登录页 - 初始协议未勾选', initial.data.agreed === false)

  // 1) 空表单：拦在邮箱
  const emptySubmit = await vm.submit()

  assert('登录页 - 空表单提示填邮箱', emptySubmit.command.title === '请输入邮箱', emptySubmit.command.title)
  assert('登录页 - 空表单标红邮箱框', emptySubmit.data.errorField === 'email')

  // 2) 邮箱格式错
  vm.setField('email', 'curry@')
  vm.setField('password', 'abc12345')

  const badEmail = await vm.submit()

  assert('登录页 - 邮箱格式错被拦', badEmail.command.title === '邮箱格式不正确', badEmail.command.title)

  // 3) 密码必须字母+数字
  vm.setField('email', 'curry@test.com')
  vm.setField('password', 'abcdefgh')

  const badPassword = await vm.submit()

  assert('登录页 - 纯字母密码被拒', badPassword.command.title.indexOf('字母与数字') >= 0,
    badPassword.command.title)
  assert('登录页 - 密码问题标红密码框', badPassword.data.errorField === 'password')

  // 4) 未勾协议：拦在最后，别一上来就挡人
  vm.setField('password', 'abc12345')

  const noAgree = await vm.submit()

  assert('登录页 - 未勾协议被拦', noAgree.command.title.indexOf('用户协议') >= 0, noAgree.command.title)
  assert('登录页 - 未勾协议标记勾选栏', noAgree.data.errorField === 'agreed')
  assert('登录页 - 勾选后红框立即消失', vm.toggleAgreed().data.errorField === '')

  // 5) 后端不可用（没接上）→ 降级，但仍然是登录成功
  //    unavailable 与「后端明确拒绝」是两件事：只有前者能降级
  authGateway.setAuthGateway({
    name: 'none',
    loginByEmail: () => ({ ok: false, unavailable: true, reason: '未配置接口域名' })
  })

  const degraded = await vm.submit()
  const degradedAuth = authRepository.getAuth(storage)

  assert('登录页 - 断网保持未登录', degradedAuth.loggedIn === false)
  assert('登录页 - 断网不生成身份', degradedAuth.provider === '', degradedAuth.provider)
  assert('登录页 - 断网展示失败原因', degraded.command.title === '未配置接口域名', degraded.command.title)
  assert('登录页 - 失败停留当前页面', degraded.command.type === 'toast', JSON.stringify(degraded.command))
  assert('登录页 - 失败没有用户编号', degradedAuth.userId === '', degradedAuth.userId)
  assert('登录页 - 密码不写进身份', JSON.stringify(degradedAuth).indexOf('abc12345') < 0)
  assert('登录页 - storage 里也没有密码', JSON.stringify(storage.raw).indexOf('abc12345') < 0)

  // 6) 真登录
  authGateway.setAuthGateway({
    name: 'fake',
    loginByEmail: () => ({ ok: true, userId: 'u-9', email: 'curry@test.com', token: 'tk-9' })
  })

  const okStorage = createMemoryStorage()
  const okVm = new LoginViewModel({ storage: okStorage })

  okVm.setField('email', 'curry@test.com')
  okVm.setField('password', 'abc12345')
  okVm.toggleAgreed()

  const logged = await okVm.submit()

  assert('登录页 - 真登录提示登录成功', logged.command.title === '登录成功', logged.command.title)
  assert('登录页 - 真登录不带降级说明', logged.data.degradedNote === '', logged.data.degradedNote)
  assert('登录页 - 真登录用后端给的 id',
    authRepository.getAuth(okStorage).userId === 'u-9', authRepository.getAuth(okStorage).userId)

  // 7) 微信登录通道保留（设计稿里是「或」下面的备选按钮）
  authGateway.setAuthGateway({ name: 'fake', login: () => ({ ok: true, userId: 'u-1', token: 'tk1', openId: 'o-1' }) })

  global.wx = { login: (input) => input.success({ code: 'wechat-code' }) }
  const wechat = await new LoginViewModel({ storage: createMemoryStorage() }).wechatLogin()
  delete global.wx

  assert('登录页 - 微信登录仍可用', wechat.command.type === 'back', JSON.stringify(wechat.command))

  // 8) 退出
  const logout = okVm.logout()

  assert('登录页 - 退出后回到未登录', authRepository.getAuth(okStorage).loggedIn === false)
  assert('登录页 - 退出有提示', logout.command.title === '已退出登录')

  authGateway.resetAuthGateway()
}

// ---------- 五、设置页与我的页 ----------
async function checkEntryPages() {
  const storage = createMemoryStorage()
  const settings = new SettingsViewModel({ storage })

  // 改版后账户分组迁到「我的 → 账号管理」（设计稿 781:2123），设置页只留偏好 / 数据 / 关于。
  // 同一份账号状态不许有两个入口，否则迟早改出两套文案。
  assert('设置 - 账户分组已迁出（不再有 accountActions）',
    settings.load().data.accountActions === undefined)
  assert('设置 - 不再提供账户动作入口', typeof settings.openAccountAction === 'undefined')

  // 我的页
  const myStorage = createMemoryStorage()
  const my = new MyViewModel({ storage: myStorage })

  assert('我的 - 未登录时资料卡引导登录', my.load().data.auth.displayName === '点击登录',
    my.load().data.auth.displayName)
  assert('我的 - 未登录标签是未登录', my.load().data.auth.accountTag === '未登录')
  assert('我的 - 未登录点账号管理去登录页',
    my.tapRow('account').command.url === '/page/login/index',
    JSON.stringify(my.tapRow('account')))
  assert('我的 - 未登录点邮箱提醒先引导登录',
    my.tapRow('reminder').command.title.indexOf('登录') >= 0,
    JSON.stringify(my.tapRow('reminder')))
  assert('我的 - 未登录不给退出登录',
    my.load().data.otherRows.every((item) => item.key !== 'logout'),
    JSON.stringify(my.load().data.otherRows))

  authGateway.setAuthGateway({
    name: 'fake',
    login: () => ({ ok: true, userId: 'u-2', token: 'tk2', openId: 'o-2', nickname: 'curry' })
  })
  await authRepository.login(myStorage, { codeProvider: (done) => done('code-1') })
  authGateway.resetAuthGateway()

  const myAfter = my.load()

  assert('我的 - 登录后资料卡显示昵称', myAfter.data.auth.displayName === 'curry', myAfter.data.auth.displayName)
  assert('我的 - 登录后标签是微信登录', myAfter.data.auth.accountTag === '微信登录')
  assert('我的 - 登录后出现退出登录',
    myAfter.data.otherRows.some((item) => item.key === 'logout'),
    JSON.stringify(myAfter.data.otherRows))
  assert('我的 - 登录后账号管理进账号页',
    my.tapRow('account').command.url === '/page/account/index',
    JSON.stringify(my.tapRow('account')))
  assert('我的 - 登录后邮箱提醒可进入',
    my.tapRow('reminder').command.url === '/page/reminder/index',
    JSON.stringify(my.tapRow('reminder')))

  // 清空学习数据的入口改到设置页，但语义不变：只清学习数据，不动身份
  assert('设置 - 清空学习数据不牵连登录态', (() => {
    new SettingsViewModel({ storage: myStorage }).clearRecords()

    return my.load().data.auth.loggedIn === true
  })())

  const logout = my.logout()

  assert('我的 - 退出登录回传未登录视图', logout.data.auth.loggedIn === false)
  assert('我的 - 退出登录有提示', logout.command.title === '已退出登录')
  assert('我的 - 退出后不再给退出登录',
    my.load().data.otherRows.every((item) => item.key !== 'logout'))
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

  // 改版后登录页是纯认证页（设计稿 763:567），不再承担头像昵称编辑
  assert('页面 - 登录按钮处理函数已定义', loginJs.indexOf('handleLoginTap()') >= 0)
  assert('页面 - 微信登录处理函数已定义', loginJs.indexOf('handleWechatTap()') >= 0)
  assert('页面 - 注册入口处理函数已定义', loginJs.indexOf('handleRegisterTap()') >= 0)
  assert('页面 - 忘记密码处理函数已定义', loginJs.indexOf('handleForgotTap()') >= 0)
  assert('页面 - 登录页注册原生 Page 配置', /Page\(\s*\{/.test(loginJs))

  // 输入框不再做受控回写：回写 value 会让真机光标跳到末尾
  assert('页面 - 输入不反写 value', loginJs.indexOf('value:') < 0)

  const registerWxml = readFile('page/register/index.wxml')
  const forgotWxml = readFile('page/forgot-password/index.wxml')

  assert('页面 - 注册页有验证码发送入口', registerWxml.indexOf('handleSendCode') >= 0)
  assert('页面 - 注册页有协议勾选', registerWxml.indexOf('checkbox-tick') >= 0)
  assert('页面 - 找回密码页有确认密码字段', forgotWxml.indexOf('请再次输入新密码') >= 0)
  assert('页面 - 找回密码页说明重置后要重新登录',
    forgotWxml.indexOf('重置成功后，请使用新密码登录') >= 0)

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

  assert('页面 - 我的页资料头是登录 / 账号入口', myWxml.indexOf('handleProfileTap') >= 0)
  assert('页面 - 我的页资料头处理函数有定义', myJs.indexOf('handleProfileTap()') >= 0)
  assert('页面 - 我的页状态标签跟随登录态', myWxml.indexOf('{{auth.accountTag}}') >= 0)

  // 账号分组迁到独立页面后，脱敏邮箱与密码状态在这一页
  const accountWxml = readFile('page/account/index.wxml')
  const accountJs = readFile('page/account/index.js')

  assert('页面 - 账号管理页显示脱敏邮箱', accountWxml.indexOf('{{profile.emailMasked') >= 0)
  assert('页面 - 账号管理页可改头像（chooseAvatar）',
    accountWxml.indexOf('open-type="chooseAvatar"') >= 0)
  assert('页面 - 账号管理页头像转存后再用',
    accountJs.indexOf('copyFileSync') >= 0 && accountJs.indexOf('USER_DATA_PATH') >= 0)
  assert('页面 - 账号管理页保存入口已定义', accountJs.indexOf('handleSaveTap()') >= 0)

  const settingsWxml = readFile('page/settings/index.wxml')

  assert('页面 - 设置页不再放账户分组', settingsWxml.indexOf('accountActions') < 0)
  assert('页面 - 设置页清空学习数据仍有入口', settingsWxml.indexOf('handleClearRecords') >= 0)

  const loginWxss = readFile('page/login/index.wxss')

  // 三个认证页必须共用同一份尺寸来源，否则三个页面会慢慢长歪
  assert('页面 - 登录页引入公用认证样式', loginWxss.indexOf('styles/auth-form.wxss') >= 0)
  assert('页面 - 注册页引入公用认证样式',
    readFile('page/register/index.wxss').indexOf('styles/auth-form.wxss') >= 0)
  assert('页面 - 找回密码页引入公用认证样式',
    readFile('page/forgot-password/index.wxss').indexOf('styles/auth-form.wxss') >= 0)

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
