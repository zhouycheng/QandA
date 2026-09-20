/**
 * 真机（模拟器）点击验证 —— 连接微信开发者工具，真实点一遍。
 *
 * 为什么需要它：
 * 「页面点击没反应」这类问题，静态检查全部会通过——编译器说代码没问题，
 * 绑定检查说事件有定义，但用户点了就是不动。只有真的 tap 一次才能证伪。
 *
 * 前置条件：
 *   1. 微信开发者工具已打开本项目
 *   2. 工具里开启服务端口：设置 → 安全设置 → 服务端口【打开】
 *      （不开会报 "IDE service port disabled"，CLI 与自动化都连不上）
 *
 * 依赖：miniprogram-automator 装在隔离工作区，不在项目里（项目保持零 npm 依赖）
 *
 *   npm install miniprogram-automator
 *   （装到 C:/Users/<你>/.workbuddy/binaries/node/workspace）
 *
 * 运行：
 *   cd apps/miniapp
 *   NODE_PATH="C:/Users/<你>/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/tap-test.cjs
 *
 * 可选：用环境变量覆盖路径
 *   IDE_CLI="D:/Program Files x86/微信web开发者工具/cli.bat"
 */
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_CLI = 'D:\\Program Files x86\\微信web开发者工具\\cli.bat'
const CLI_PATH = process.env.IDE_CLI || DEFAULT_CLI

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 每个页面挑几个元素，点完看页面/数据有没有变化 */
const CASES = [
  {
    label: '首页 → 点「详情」应进统计页',
    entry: '/page/subject-list/index',
    selectors: ['.data-head', '.data-head-more', '.data-card'],
    expectRoute: '/page/stats/index'
  },
  {
    label: '首页 → 点公告条',
    entry: '/page/subject-list/index',
    selectors: ['.tip-bar'],
    expectAnyChange: true
  },
  {
    label: '题库页 → 点科目切换',
    entry: '/page/bank-detail/index',
    selectors: ['.rail-item'],
    expectAnyChange: true
  },
  {
    label: '统计页 → 点错题入口',
    entry: '/page/stats/index',
    selectors: ['.stat-entry', '.entry', '.section'],
    expectAnyChange: true
  }
]

async function main() {
  let automator
  try {
    automator = require('miniprogram-automator')
  } catch (error) {
    console.log('FAIL 未找到 miniprogram-automator，先在工作区安装：')
    console.log('     cd ~/.workbuddy/binaries/node/workspace && npm install miniprogram-automator')
    process.exit(2)
  }

  console.log('=== 真机点击验证 ===\n')
  console.log('项目：' + PROJECT_ROOT)
  console.log('CLI ：' + CLI_PATH + '\n')

  let miniProgram
  try {
    miniProgram = await automator.launch({
      projectPath: PROJECT_ROOT,
      cliPath: CLI_PATH,
      timeout: 90000
    })
  } catch (error) {
    console.log('FAIL 无法连接开发者工具：' + error.message)
    console.log('\n请确认：')
    console.log('  1. 工具已打开本项目')
    console.log('  2. 设置 → 安全设置 → 服务端口 已【打开】')
    console.log('  3. cli.bat 路径正确（可用 IDE_CLI 环境变量覆盖）')
    process.exit(2)
  }

  let passed = 0
  let failed = 0

  for (const testCase of CASES) {
    console.log('--- ' + testCase.label)

    let page
    try {
      page = await miniProgram.reLaunch(testCase.entry)
      await page.waitFor(1500)
    } catch (error) {
      console.log('    ❌ 打开页面失败：' + error.message)
      failed++
      continue
    }

    // 找一个真实存在的元素
    let target = null
    let usedSelector = ''
    for (const selector of testCase.selectors) {
      const el = await page.$(selector).catch(() => null)
      if (el) {
        target = el
        usedSelector = selector
        break
      }
    }

    if (!target) {
      console.log('    ❌ 元素未找到：' + testCase.selectors.join(' / '))
      console.log('       → 页面很可能没渲染出来（编译失败或缓存未刷新）')
      failed++
      continue
    }

    const beforePath = (await miniProgram.currentPage()).path
    const beforeData = JSON.stringify(await page.data()).slice(0, 400)

    await target.tap()
    await sleep(1800)

    const afterPath = (await miniProgram.currentPage()).path
    const afterData = JSON.stringify(await page.data()).slice(0, 400)

    if (testCase.expectRoute) {
      const ok = afterPath === testCase.expectRoute
      console.log('    点击 ' + usedSelector + ' → ' + beforePath + ' ⇒ ' + afterPath)
      console.log('    ' + (ok ? '✅ 跳转生效' : '❌ 未跳转'))
      ok ? passed++ : failed++
    } else {
      const ok = afterPath !== beforePath || afterData !== beforeData
      console.log('    点击 ' + usedSelector + ' → ' + (ok ? '页面有响应' : '无变化'))
      console.log('    ' + (ok ? '✅ 点击生效' : '❌ 点击无反应'))
      ok ? passed++ : failed++
    }
    console.log('')
  }

  await miniProgram.close().catch(() => {})

  console.log(`总计 ${passed + failed} 项，通过 ${passed} 项，失败 ${failed} 项`)
  if (failed) process.exit(1)
}

main().catch(error => {
  console.log('异常：' + error.message)
  process.exit(1)
})
