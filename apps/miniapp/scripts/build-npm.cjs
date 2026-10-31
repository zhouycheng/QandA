const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const project = path.resolve(__dirname, '..')
const localPath = path.join(project, 'miniprogram/ext.json')
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).extConfig || {} : {}
if (local.apiBaseUrl) {
  const url = new URL(local.apiBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('apiBaseUrl 必须是 HTTP(S) 地址，认证信息通过登录获取')
}
// Ordinary AppIDs do not read ext.json through getExtConfigSync.
fs.writeFileSync(path.join(project, 'miniprogram/runtime.local.js'), 'module.exports = ' + JSON.stringify({ apiBaseUrl: local.apiBaseUrl || '' }) + '\n')
const cli = process.env.WECHAT_DEVTOOLS_CLI || (process.platform === 'darwin' ? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli' : 'cli')
const result = spawnSync(cli, ['build-npm', '--project', project], { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
for (const name of ['mobx-miniprogram', 'mobx-miniprogram-bindings']) {
  if (!fs.existsSync(path.join(project, 'miniprogram/miniprogram_npm', name, 'index.js'))) throw new Error('npm 构建缺少 ' + name)
}
