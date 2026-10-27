/**
 * 登录 / 注册 / 找回密码 —— 页面与规则自检。
 * 运行：node apps/miniapp/tests/auth-pages.check.js
 *
 * 这一版按设计稿重做了认证页（Figma 763:567 / 772:1036 / 772:1076），
 * 本脚本锁住三件容易回退的事：
 *   1. **尺寸来源唯一**：三个页面都引 styles/auth-form.wxss，换算系数 750/402；
 *   2. **校验规则**：邮箱格式、8–20 位字母+数字、验证码 6 位、两次一致、协议必勾；
 *   3. **降级语义**：后端未接入时流程照样走得通，但**密码绝不落库**。
 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const form = require(path.join(MINIPROGRAM, 'utils/auth-form.js'))
const cooldown = require(path.join(MINIPROGRAM, 'utils/cooldown.js'))
const authRepository = require(path.join(MINIPROGRAM, 'repositories/auth-repository.js'))
const authGateway = require(path.join(MINIPROGRAM, 'repositories/auth-gateway.js'))
const httpGateway = require(path.join(MINIPROGRAM, 'repositories/http-gateway.js'))
const { LoginViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/login-viewmodel.js'))
const { RegisterViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/register-viewmodel.js'))
const { ForgotPasswordViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/forgot-password-viewmodel.js'))

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

    raw: map
  }
}

// ---------- 一、校验规则 ----------

function checkRules() {
  assert('规则 - 正常邮箱通过', form.isValidEmail('curry@test.com'))
  assert('规则 - 域名带点且后缀 ≥2 位', form.isValidEmail('a@b.cn'))
  assert('规则 - 缺域名后缀被拒', !form.isValidEmail('curry@test'))
  assert('规则 - 缺 @ 被拒', !form.isValidEmail('curry.test.com'))
  assert('规则 - 首尾空格被忽略', form.isValidEmail('  curry@test.com  '))

  assert('规则 - 8 位字母+数字通过', form.isValidPassword('abc12345'))
  assert('规则 - 纯字母被拒（设计稿要求字母与数字组合）', !form.isValidPassword('abcdefgh'))
  assert('规则 - 纯数字被拒', !form.isValidPassword('12345678'))
  assert('规则 - 7 位被拒（下限 8）', !form.isValidPassword('abc1234'))
  assert('规则 - 21 位被拒（上限 20）', !form.isValidPassword('abc1234512345123451234'))
  assert('规则 - 含符号被拒', !form.isValidPassword('abc12345!'))

  assert('规则 - 6 位数字验证码通过', form.isValidCode('123456'))
  assert('规则 - 5 位验证码被拒', !form.isValidCode('12345'))
  assert('规则 - 带字母验证码被拒', !form.isValidCode('12345a'))

  assert('规则 - 邮箱脱敏保留首字符与域名', form.maskEmail('abcd@qq.com') === 'a***@qq.com',
    form.maskEmail('abcd@qq.com'))
  assert('规则 - 空邮箱脱敏为空串', form.maskEmail('') === '')

  const loginEmpty = form.validateLogin({})
  assert('规则 - 登录空表单先报邮箱', loginEmpty.field === 'email' && loginEmpty.message === '请输入邮箱')

  const noAgree = form.validateLogin({ email: 'a@b.com', password: 'abc12345', agreed: false })
  assert('规则 - 登录未勾协议报协议', noAgree.field === 'agreed')

  const mismatch = form.validateRegister({
    email: 'a@b.com',
    code: '123456',
    password: 'abc12345',
    confirm: 'abc12346',
    agreed: true
  })
  assert('规则 - 两次密码不一致报确认栏', mismatch.field === 'confirm')

  const okLogin = form.validateLogin({ email: 'a@b.com', password: 'abc12345', agreed: true })
  assert('规则 - 完整表单通过', okLogin.ok === true)

  const resetNoAgree = form.validateReset({
    email: 'a@b.com',
    code: '123456',
    password: 'abc12345',
    confirm: 'abc12345'
  })
  assert('规则 - 找回密码不要求协议勾选', resetNoAgree.ok === true)
}

// ---------- 二、设计稿尺寸 ----------

function checkDesignTokens() {
  const wxss = readFile('styles/auth-form.wxss')

  // 系数 750/402：36px → 67rpx，52px → 97rpx，48px → 90rpx，12px → 22rpx
  assert('尺寸 - 页边距 67rpx', /padding:\s*48rpx\s+67rpx/.test(wxss))
  assert('尺寸 - 输入框高 97rpx', /\.field-input\s*\{[^}]*height:\s*97rpx/.test(wxss))
  assert('尺寸 - 按钮高 90rpx', /\.btn\s*\{[^}]*height:\s*90rpx/.test(wxss))
  assert('尺寸 - 圆角 22rpx', /border-radius:\s*22rpx/.test(wxss))
  assert('尺寸 - 品牌名 78rpx', /\.brand-name\s*\{[^}]*font-size:\s*78rpx/.test(wxss))
  assert('尺寸 - 页面标题 37rpx', /\.page-title\s*\{[^}]*font-size:\s*37rpx/.test(wxss))
  assert('尺寸 - 勾选框 30rpx', /\.checkbox\s*\{[^}]*width:\s*30rpx/.test(wxss))
  assert('尺寸 - 主色 #1477fb', /#1477fb/i.test(wxss))
  assert('尺寸 - 勾选填充色 #0d6fff', /#0d6fff/i.test(wxss))
  assert('尺寸 - 输入框底色 #f0f0f0', /#f0f0f0/i.test(wxss))
  assert('尺寸 - 错误态用内阴影避免抖动', /box-shadow:\s*inset 0 0 0 2rpx #f04438/.test(wxss))

  const loginWxss = readFile('page/login/index.wxss')
  assert('尺寸 - 登录页表单上距 84rpx（画板 45px）', /margin-top:\s*84rpx/.test(loginWxss))
  assert('尺寸 - 登录页字段间距 45rpx（画板 24px）', /margin-top:\s*45rpx/.test(loginWxss))
  assert('尺寸 - 登录页主按钮上距 56rpx（画板 30px）', /margin-top:\s*56rpx/.test(loginWxss))

  const registerWxss = readFile('page/register/index.wxss')
  assert('尺寸 - 注册页协议行上距 45rpx（画板 24px）', /margin-top:\s*45rpx/.test(registerWxss))
}

// ---------- 三、页面结构与注册 ----------

function checkPages() {
  const app = JSON.parse(readFile('app.json'))

  assert('页面 - 登录页已注册', app.pages.indexOf('page/login/index') >= 0)
  assert('页面 - 注册页已注册', app.pages.indexOf('page/register/index') >= 0)
  assert('页面 - 找回密码页已注册', app.pages.indexOf('page/forgot-password/index') >= 0)

  const REQUIRED = ['index.js', 'index.json', 'index.wxml', 'index.wxss']

  ;['page/login', 'page/register', 'page/forgot-password'].forEach((dir) => {
    const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(MINIPROGRAM, dir, name)))

    assert(`页面 - ${dir} 四件齐全`, missing.length === 0, missing.join(','))
  })

  const loginWxml = readFile('page/login/index.wxml')

  // 设计稿里的文案逐条对上，改文案就等于改设计
  assert('页面 - 登录页品牌名 QandA', loginWxml.indexOf('>QandA<') >= 0)
  assert('页面 - 登录页副标题 答题系统', loginWxml.indexOf('答题系统') >= 0)
  assert('页面 - 登录页标题 登录', loginWxml.indexOf('>登录<') >= 0)
  assert('页面 - 登录页邮箱占位文案', loginWxml.indexOf('请输入邮箱') >= 0)
  assert('页面 - 登录页密码占位文案', loginWxml.indexOf('请输入密码') >= 0)
  assert('页面 - 登录页协议文案', loginWxml.indexOf('已阅读并同意用户协议和隐私政策') >= 0)
  assert('页面 - 登录页忘记密码入口', loginWxml.indexOf('忘记密码？') >= 0)
  assert('页面 - 登录页「或」分隔', loginWxml.indexOf('>或<') >= 0)
  assert('页面 - 登录页微信登录按钮', loginWxml.indexOf('微信登录') >= 0)
  assert('页面 - 登录页注册入口文案', loginWxml.indexOf('没有账号？立即注册') >= 0)

  const registerWxml = readFile('page/register/index.wxml')

  assert('页面 - 注册页标题 注册', registerWxml.indexOf('>注册<') >= 0)
  assert('页面 - 注册页有验证码字段', registerWxml.indexOf('邮箱验证码') >= 0)
  assert('页面 - 注册页密码占位按设计稿写', registerWxml.indexOf('请设置 8–20 位字母与数字组合') >= 0)
  assert('页面 - 注册页确认密码占位', registerWxml.indexOf('请再次输入密码') >= 0)
  assert('页面 - 注册页返回登录', registerWxml.indexOf('已有账号？') >= 0)

  const forgotWxml = readFile('page/forgot-password/index.wxml')

  assert('页面 - 找回密码标题', forgotWxml.indexOf('>找回密码<') >= 0)
  assert('页面 - 找回密码邮箱占位', forgotWxml.indexOf('请输入注册邮箱') >= 0)
  assert('页面 - 找回密码新密码字段', forgotWxml.indexOf('>新密码<') >= 0)
  assert('页面 - 找回密码主按钮', forgotWxml.indexOf('>重置密码<') >= 0)

  // 认证页不用原生 button：button 自带 after 边框，得靠额外样式清，view 更省事
  ;['page/login/index.wxml', 'page/register/index.wxml', 'page/forgot-password/index.wxml'].forEach((file) => {
    assert(`页面 - ${file} 不用原生 button`, readFile(file).indexOf('<button') < 0)
  })
}

// ---------- 四、可点元素必须有按压反馈 ----------

function checkHover() {
  ;['page/login/index.wxml', 'page/register/index.wxml', 'page/forgot-password/index.wxml'].forEach((file) => {
    const src = readFile(file).replace(/<!--[\s\S]*?-->/g, ' ')
    const tags = src.match(/<(view|text)\b[^>]*bindtap[^>]*>/g) || []
    const bad = tags.filter((tag) => tag.indexOf('hover-class') < 0 || tag.indexOf('hover-start-time="0"') < 0)

    assert(`交互 - ${file} 可点元素都有 hover-class 且 0ms 起效`, bad.length === 0, bad.join(' | '))
  })
}

// ---------- 五、三层链路与降级 ----------

async function checkFlow() {
  // 1) 发送验证码：后端未接入也算成功，并说明跳过校验
  authGateway.setAuthGateway({ name: 'none' })

  const codeStorage = createMemoryStorage()
  const registerVm = new RegisterViewModel({ storage: codeStorage })

  registerVm.setField('email', 'curry@test.com')

  const sent = await registerVm.sendCode('register')

  assert('降级 - 未配域名也能发验证码（返回 cooldown）',
    sent.command.type === 'cooldown' && sent.command.seconds > 0, JSON.stringify(sent.command))
  assert('降级 - 明确告知验证码校验已跳过',
    sent.command.title.indexOf('跳过') >= 0, sent.command.title)

  const badEmailSend = await new RegisterViewModel({ storage: createMemoryStorage() }).sendCode('register')

  assert('降级 - 邮箱没填不发验证码', badEmailSend.command.title === '请先填写邮箱', badEmailSend.command.title)

  // 2) 注册：降级后进登录态，身份由邮箱派生
  const registerStorage = createMemoryStorage()
  const okRegister = new RegisterViewModel({ storage: registerStorage })

  okRegister.setField('email', 'curry@test.com')
  okRegister.setField('code', '123456')
  okRegister.setField('password', 'abc12345')
  okRegister.setField('confirm', 'abc12345')
  okRegister.toggleAgreed()

  const registered = await okRegister.submit()
  const registeredAuth = authRepository.getAuth(registerStorage)

  assert('降级 - 注册后直接进登录态', registeredAuth.loggedIn === true)
  assert('降级 - 注册来源是邮箱', registeredAuth.provider === 'email', registeredAuth.provider)
  assert('降级 - 注册后回到上一页', registered.command.type === 'back', JSON.stringify(registered.command))
  assert('降级 - 注册不把密码写进 storage',
    JSON.stringify(registerStorage.raw).indexOf('abc12345') < 0)

  // 3) 同一邮箱重复登录 → 身份 id 不变（本机数据不会看起来换了个人）
  const again = new LoginViewModel({ storage: registerStorage })

  again.setField('email', 'curry@test.com')
  again.setField('password', 'abc12345')
  again.toggleAgreed()

  await again.submit()

  assert('降级 - 同一邮箱 id 稳定',
    authRepository.getAuth(registerStorage).userId === registeredAuth.userId,
    authRepository.getAuth(registerStorage).userId)

  // 4) 找回密码：不改登录态，且说明后端未接入
  const resetStorage = createMemoryStorage()
  const resetVm = new ForgotPasswordViewModel({ storage: resetStorage })

  resetVm.setField('email', 'curry@test.com')
  resetVm.setField('code', '123456')
  resetVm.setField('password', 'newpass123')
  resetVm.setField('confirm', 'newpass123')

  const reset = await resetVm.submit()

  assert('降级 - 重置成功回登录页',
    reset.command.type === 'navigate' && reset.command.url === '/page/login/index', JSON.stringify(reset.command))
  assert('降级 - 重置不产生登录态', authRepository.getAuth(resetStorage).loggedIn === false)
  assert('降级 - 重置说明密码未实际修改', reset.command.title.indexOf('未实际修改') >= 0, reset.command.title)

  // 5) 后端可用时走真实返回
  authGateway.setAuthGateway({
    name: 'fake',
    loginByEmail: () => ({ ok: true, userId: 'u-77', email: 'curry@test.com' })
  })

  const realStorage = createMemoryStorage()
  const realVm = new LoginViewModel({ storage: realStorage })

  realVm.setField('email', 'curry@test.com')
  realVm.setField('password', 'abc12345')
  realVm.toggleAgreed()

  const real = await realVm.submit()

  assert('链路 - 后端可用时用后端 id', authRepository.getAuth(realStorage).userId === 'u-77',
    authRepository.getAuth(realStorage).userId)
  assert('链路 - 后端可用时不给降级说明', real.data.degradedNote === '', real.data.degradedNote)

  // 6) 提交中重复点击不该发两次
  const guardVm = new LoginViewModel({ storage: createMemoryStorage() })

  guardVm.setField('email', 'curry@test.com')
  guardVm.setField('password', 'abc12345')
  guardVm.toggleAgreed()
  guardVm.submitting = true

  const guarded = await guardVm.submit()

  assert('链路 - 提交中重复点击被忽略', !guarded.command, JSON.stringify(guarded.command || {}))

  authGateway.resetAuthGateway()
}

// ---------- 六、本轮修复的缺陷回归 ----------
//
// 这一节锁的是「排查时发现、已经修好」的真实缺陷。
// 每条都对应一个具体的失效场景，不写只走形式的存在性断言。

async function checkRegressions() {
  // 1) 后端**明确拒绝**（密码错）不能被当成「没接上后端」而降级登录。
  //    修之前：输错密码也进登录态，接上后端后这是最危险的一种错。
  authGateway.setAuthGateway({
    name: 'reject',
    loginByEmail: () => ({ ok: false, unavailable: false, reason: '邮箱或密码不正确' })
  })

  const rejectStorage = createMemoryStorage()
  const rejectVm = new LoginViewModel({ storage: rejectStorage })

  rejectVm.setField('email', 'curry@test.com')
  rejectVm.setField('password', 'abc12345')
  rejectVm.toggleAgreed()

  const rejected = await rejectVm.submit()

  assert('修复 - 后端拒绝密码时不产生登录态',
    authRepository.getAuth(rejectStorage).loggedIn === false)
  assert('修复 - 后端拒绝时原样回传原因',
    rejected.command.title === '邮箱或密码不正确', rejected.command.title)

  // 2) 没接上后端（unavailable）仍然降级 —— 上一条修复不能把联调前的路堵死
  authGateway.setAuthGateway({
    name: 'offline',
    loginByEmail: () => ({ ok: false, unavailable: true, reason: '未配置接口域名' })
  })

  const offlineStorage = createMemoryStorage()
  const offlineVm = new LoginViewModel({ storage: offlineStorage })

  offlineVm.setField('email', 'curry@test.com')
  offlineVm.setField('password', 'abc12345')
  offlineVm.toggleAgreed()

  const offline = await offlineVm.submit()

  assert('修复 - 没接上后端仍可本地登录',
    authRepository.getAuth(offlineStorage).provider === 'email' && !!offline.data.degradedNote,
    JSON.stringify(offline.data))

  // 3) 换到真后端登录成功后，降级说明必须消失（不能一直挂着上一轮的提示）
  authGateway.setAuthGateway({
    name: 'online',
    loginByEmail: () => ({ ok: true, userId: 'u-9', email: 'curry@test.com' })
  })

  const online = await offlineVm.submit()

  assert('修复 - 真登录成功后降级说明被清掉', online.data.degradedNote === '', online.data.degradedNote)

  // 4) 验证码被后端拒绝时不给倒计时，否则按钮白锁 60 秒
  authGateway.setAuthGateway({
    name: 'code-reject',
    sendCode: () => ({ ok: false, unavailable: false, reason: '该邮箱未注册' })
  })

  const codeVm = new RegisterViewModel({ storage: createMemoryStorage() })

  codeVm.setField('email', 'nobody@test.com')

  const codeFail = await codeVm.sendCode('register')

  assert('修复 - 验证码被拒不给倒计时',
    codeFail.command.type === 'toast' && codeFail.command.title === '该邮箱未注册',
    JSON.stringify(codeFail.command))

  // 5) _submit 同步抛错不能让 submitting 永久卡在 true（按钮从此点不动）
  const boomVm = new LoginViewModel({
    storage: createMemoryStorage(),
    repository: {
      loginWithEmail() {
        throw new Error('boom')
      },

      getAuth() {
        return {}
      }
    }
  })

  boomVm.setField('email', 'curry@test.com')
  boomVm.setField('password', 'abc12345')
  boomVm.toggleAgreed()

  const boom = await boomVm.submit()

  assert('修复 - 仓储同步抛错不卡住提交态',
    boom.data.submitting === false && boom.command.type === 'toast', JSON.stringify(boom.data.submitting))

  // 6) 倒计时按绝对结束时刻算：退到后台后定时器被停，回来要能接上
  const now = Date.now()

  assert('修复 - 剩余秒数按结束时刻算', cooldown.remainingSeconds(now + 5000, now) === 5)
  assert('修复 - 已过期返回 0', cooldown.remainingSeconds(now - 1000, now) === 0)

  ;['page/register/index.js', 'page/forgot-password/index.js'].forEach((file) => {
    const src = readFile(file)

    assert(`修复 - ${file} 不再靠每秒自减`,
      !/this\.data\.cooldown\s*-\s*1/.test(src))
    assert(`修复 - ${file} onShow 里恢复倒计时`,
      /onShow\s*\(\s*\)\s*\{[^}]*cooldown\.resume\(this\)/.test(src))
  })

  // 7) 真实 HTTP 的错误文案取自后端返回，不是「接口返回 400」
  const originalWx = global.wx

  global.wx = {
    request(options) {
      options.success({ statusCode: 400, data: { message: '邮箱或密码不正确' } })
    }
  }

  httpGateway.configure({ baseUrl: 'https://api.example.com' })

  const httpReject = await httpGateway.loginByEmail('a@b.com', 'abc12345')

  assert('修复 - HTTP 错误文案取自后端 message',
    httpReject.ok === false && httpReject.reason === '邮箱或密码不正确' && httpReject.unavailable === false,
    JSON.stringify(httpReject))

  // 断网要标成 unavailable，上层才知道该降级
  global.wx = {
    request(options) {
      options.fail({ errMsg: 'request:fail timeout' })
    }
  }

  const httpDown = await httpGateway.loginByEmail('a@b.com', 'abc12345')

  assert('修复 - 断网标记 unavailable 供上层降级',
    httpDown.ok === false && httpDown.unavailable === true, JSON.stringify(httpDown))

  httpGateway.configure({ baseUrl: '' })
  global.wx = originalWx

  authGateway.resetAuthGateway()
}

// ---------- 汇总 ----------

async function main() {
  checkRules()
  checkDesignTokens()
  checkPages()
  checkHover()
  await checkFlow()
  await checkRegressions()

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
