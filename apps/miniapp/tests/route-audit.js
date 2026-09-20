/** 一次性审计：所有跳转 URL 是否存在、跳转方式与页面类型是否匹配。 */
const fs = require('fs')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const app = JSON.parse(fs.readFileSync(path.join(MINIPROGRAM, 'app.json'), 'utf8'))

const pages = new Set(app.pages)
const tabPages = new Set(((app.tabBar && app.tabBar.list) || []).map(item => item.pagePath))

const found = []
const problems = []

const RE = /(navigateTo|switchTab|redirectTo|reLaunch)\s*\(\s*\{\s*url:\s*['"]([^'"]+)['"]/g

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  let match
  while ((match = RE.exec(src)) !== null) {
    const api = match[1]
    const rawUrl = match[2]
    const url = rawUrl.split('?')[0]
    const rel = path.relative(MINIPROGRAM, file).replace(/\\/g, '/')
    found.push(`${api} -> ${rawUrl}`)

    if (!pages.has(url)) {
      problems.push(`❌ ${rel}  ${api}('${rawUrl}')  目标不在 app.json pages 中`)
    } else if (api === 'switchTab' && !tabPages.has(url)) {
      problems.push(`❌ ${rel}  switchTab('${rawUrl}')  目标不是 tabBar 页面，会失败`)
    } else if (api === 'navigateTo' && tabPages.has(url)) {
      problems.push(`❌ ${rel}  navigateTo('${rawUrl}')  目标是 tabBar 页面，navigateTo 打不开，必须 switchTab`)
    }
  }
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full)
    else if (full.endsWith('.js')) scanFile(full)
  }
}

walk(path.join(MINIPROGRAM, 'page'))
walk(path.join(MINIPROGRAM, 'viewmodels'))

console.log('=== 页面跳转审计 ===\n')
console.log(`共 ${found.length} 处跳转`)
console.log(`app.json pages (${pages.size}): ${[...pages].join(', ')}`)
console.log(`tabBar 页面 (${tabPages.size}): ${[...tabPages].join(', ')}\n`)

if (problems.length === 0) {
  console.log('PASS  全部跳转目标存在，且跳转方式与页面类型匹配')
} else {
  problems.forEach(p => console.log(p))
  console.log(`\nFAIL  ${problems.length} 处异常`)
  process.exit(1)
}
