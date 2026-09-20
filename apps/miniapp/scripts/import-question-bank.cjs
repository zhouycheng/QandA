#!/usr/bin/env node
/**
 * 题库导入脚本（零依赖，Node ≥ 18 直接跑）。
 *
 *   node scripts/import-question-bank.cjs \
 *     --file 我的题库.csv \
 *     --subject-id subject-demo --subject-name 示例科目 \
 *     --bank-id demo-ch001 --bank-name 第一章
 *
 * 常用参数：
 *   --dry-run            只校验不写文件（导入前先跑一遍）
 *   --init-template <p>  生成一份可直接填写的 CSV 模板
 *   --root <dir>         小程序根目录（默认：脚本旁 ../miniprogram）
 *
 * 为什么不用 xlsx 解析库：小程序端要求零 npm 依赖，脚本也保持一致。
 * 因此输入支持 CSV / TSV / JSON 三种；手里是 .xlsx 时脚本会提示
 * 「在 Excel 里另存为 CSV（UTF-8）」——这比引入一个解析库划算。
 *
 * 解析与校验规则**不在本文件里**：统一放在 miniprogram/utils/question-parser.js，
 * 小程序端自助导入用的是同一份，两边不会出现「脚本能过、小程序报同一份表有错」。
 * 本文件只负责 Node 侧的事：读文件、解编码、写产物、命令行交互。
 *
 * 校验不通过时**默认一个文件都不写**：导入半份题库会让题库处于中间态，
 * 宁可让用户改完表再跑一次。确要跳过坏行，显式加 --skip-invalid。
 */
const fs = require('fs')
const path = require('path')
const parser = require('../miniprogram/utils/question-parser.js')

const {
  buildBank,
  buildOptions,
  buildQuestions,
  detectDelimiter,
  normalizeAnswerKeys,
  normalizeDifficulty,
  normalizeType,
  parseDelimitedText,
  parseTable,
  stripBom,
  validateJsonQuestions
} = parser

// ---------- Node 侧：编码探测 ----------

/**
 * 中文 Excel 导出的 CSV 默认是 GBK，直接按 UTF-8 读会整片乱码。
 * 判断依据：UTF-8 解码里出现替换字符 U+FFFD 就退回 GBK。
 */
function decodeBuffer(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').slice(1)
  }

  const utf8 = buffer.toString('utf8')

  if (!parser.hasBrokenChars(utf8)) {
    return utf8
  }

  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch (error) {
    return utf8
  }
}

// ---------- Node 侧：产物生成 ----------

function buildBankSource(bank) {
  return `module.exports = ${JSON.stringify(bank, null, 2)}\n`
}

/**
 * 把题库挂进 catalog：科目不存在就新建，题库已存在就覆盖（重导同一份文件时不会重复计数）。
 * 顶层与科目的计数一律重算——手改 catalog 最容易漏掉这三处。
 */
function buildCatalogData(catalog, meta, questionCount) {
  const base = catalog && typeof catalog === 'object' ? catalog : {}
  const subjects = Array.isArray(base.subjects) ? base.subjects.map((item) => Object.assign({}, item)) : []
  let subject = subjects.find((item) => item.id === meta.subjectId)

  if (!subject) {
    const maxOrder = subjects.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0)

    subject = {
      id: meta.subjectId,
      name: meta.subjectName,
      theme: meta.theme || 'chinese',
      order: maxOrder + 10,
      bankCount: 0,
      questionCount: 0,
      banks: []
    }

    subjects.push(subject)
  }

  subject.banks = (subject.banks || []).map((item) => Object.assign({}, item))
  const bankIndex = subject.banks.findIndex((item) => item.id === meta.bankId)
  const bankMeta = {
    id: meta.bankId,
    name: meta.bankName,
    questionCount,
    sourceChapterId: meta.sourceChapterId || ''
  }

  if (bankIndex >= 0) {
    subject.banks[bankIndex] = bankMeta
  } else {
    subject.banks.push(bankMeta)
  }

  subjects.forEach((item) => {
    item.bankCount = (item.banks || []).length
    item.questionCount = (item.banks || []).reduce((total, bank) => total + (Number(bank.questionCount) || 0), 0)
  })

  return Object.assign({}, base, {
    subjects,
    subjectCount: subjects.length,
    bankCount: subjects.reduce((total, item) => total + (item.bankCount || 0), 0),
    questionCount: subjects.reduce((total, item) => total + (item.questionCount || 0), 0)
  })
}

/** 往 BANK_LOADERS 登记：小程序 require 不支持动态路径，少这一行题库就加载不出来 */
function buildBankLoadersSource(source, bankId) {
  const line = `  '${bankId}': () => require('../data/banks/${bankId}.js'),`

  if (source.indexOf(`'${bankId}':`) >= 0) {
    return source
  }

  const marker = 'const BANK_LOADERS = {\n'
  const at = source.indexOf(marker)

  if (at < 0) {
    return source
  }

  const insertAt = at + marker.length

  return `${source.slice(0, insertAt)}${line}\n${source.slice(insertAt)}`
}

// ---------- 输入读取 ----------

function readInputFile(filePath) {
  const buffer = fs.readFileSync(filePath)
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.xlsx' || extension === '.xls') {
    return {
      kind: 'unsupported',
      message: '请先在 Excel 里「另存为 → CSV UTF-8（逗号分隔）」，再用本脚本导入。'
    }
  }

  if (extension === '.json') {
    return {
      kind: 'json',
      payload: JSON.parse(decodeBuffer(buffer))
    }
  }

  return {
    kind: 'table',
    payload: decodeBuffer(buffer)
  }
}

function collectFromJson(payload) {
  const meta = {
    subjectId: payload.subjectId || '',
    subjectName: payload.subjectName || '',
    theme: payload.theme || '',
    bankId: payload.bankId || '',
    bankName: payload.bankName || '',
    sourceChapterId: payload.sourceChapterId || ''
  }
  const questions = Array.isArray(payload.questions)
    ? payload.questions
    : Array.isArray(payload) ? payload : []

  return { meta, questions }
}

// ---------- 输出 ----------

function printReport(report) {
  const lines = []

  lines.push(`题库：${report.bankName}（${report.bankId}）`)
  lines.push(`科目：${report.subjectName}（${report.subjectId}）`)
  lines.push(`题量：${report.questionCount}`)
  lines.push(`题型：${JSON.stringify(report.typeCounts)}`)

  if (report.warnings.length) {
    lines.push('')
    lines.push(`警告 ${report.warnings.length} 条：`)
    report.warnings.forEach((item) => lines.push(`  · 第 ${item.line} 行 ${item.field}：${item.reason}`))
  }

  if (report.errors.length) {
    lines.push('')
    lines.push(`错误 ${report.errors.length} 条：`)
    report.errors.forEach((item) => lines.push(`  · 第 ${item.line} 行 ${item.field}：${item.reason}`))
  }

  console.log(lines.join('\n'))
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token.indexOf('--') !== 0) {
      continue
    }

    const key = token.slice(2)
    const next = argv[index + 1]
    const flagKeys = ['dry-run', 'skip-invalid', 'help']

    if (flagKeys.indexOf(key) >= 0 || next === undefined || next.indexOf('--') === 0) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }

  return args
}

const TEMPLATE_ROWS = [
  ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '难度', '标签'],
  ['单选', '下列句子中没有语病的一项是：', '他的写作水平明显提高了', '他的写作水平明显改进了', '他的写作水平明显增加', '他的写作水平明显增强', 'A', '「水平」与「提高」搭配，其余动词搭配不当。', 'easy', '病句'],
  ['多选', '下列属于五四运动口号的有：', '外争主权', '内除国贼', '实业救国', '民主与科学', 'A|B', '「实业救国」与本题无关。', 'normal', '近代史'],
  ['判断', '《史记》是我国第一部纪传体通史。', '', '', '', '', '正确', '司马迁所著，纪传体通史之首。', 'easy', '文学常识']
]

function buildTemplateText() {
  const escape = (value) => {
    const text = String(value === undefined || value === null ? '' : value)

    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return TEMPLATE_ROWS.map((row) => row.map(escape).join(',')).join('\n') + '\n'
}

function writeTemplate(target) {
  // 带 BOM：Excel 双击打开 UTF-8 CSV 时靠 BOM 才不会把中文显示成乱码。
  // 读入侧（decodeBuffer / stripBom）会先剥掉 BOM，因此带不带都不影响导入。
  fs.writeFileSync(target, `﻿${buildTemplateText()}`, 'utf8')
  console.log(`已生成模板：${target}`)
  console.log('照着前三行填即可；答案列多选题用 | 分隔（如 A|B），判断题写「正确」或「错误」。')
}

function printUsage() {
  console.log([
    '用法：',
    '  node scripts/import-question-bank.cjs --file <csv|tsv|json> \\',
    '       --subject-id <科目id> --subject-name <科目名> \\',
    '       --bank-id <题库id> --bank-name <题库名> [--dry-run]',
    '',
    '  生成模板：node scripts/import-question-bank.cjs --init-template 题库模板.csv',
    '',
    '题库 id 建议用「科目缩写-ch00N」，例如 demo-ch001；它同时是题目的 id 前缀。'
  ].join('\n'))
}

function main(argv) {
  const args = parseArgs(argv)

  if (args.help) {
    printUsage()
    return 0
  }

  if (args['init-template']) {
    writeTemplate(path.resolve(String(args['init-template'])))
    return 0
  }

  const filePath = args.file ? path.resolve(String(args.file)) : ''

  if (!filePath) {
    printUsage()
    return 1
  }

  const required = ['subject-id', 'subject-name', 'bank-id', 'bank-name']
  const missingArgs = required.filter((key) => !args[key])

  if (missingArgs.length) {
    console.error(`缺少参数：${missingArgs.map((key) => `--${key}`).join(' / ')}`)
    return 1
  }

  const meta = {
    subjectId: String(args['subject-id']),
    subjectName: String(args['subject-name']),
    theme: args.theme ? String(args.theme) : '',
    bankId: String(args['bank-id']),
    bankName: String(args['bank-name']),
    sourceChapterId: args['chapter-id'] ? String(args['chapter-id']) : ''
  }

  let input

  try {
    input = readInputFile(filePath)
  } catch (error) {
    console.error(`读取失败：${error.message}`)
    return 1
  }

  if (input.kind === 'unsupported') {
    console.error(input.message)
    return 1
  }

  let outcome

  if (input.kind === 'json') {
    const collected = collectFromJson(input.payload)
    const mergedMeta = {
      subjectId: meta.subjectId || collected.meta.subjectId,
      subjectName: meta.subjectName || collected.meta.subjectName,
      theme: meta.theme || collected.meta.theme,
      bankId: meta.bankId || collected.meta.bankId,
      bankName: meta.bankName || collected.meta.bankName,
      sourceChapterId: meta.sourceChapterId || collected.meta.sourceChapterId
    }

    outcome = validateJsonQuestions(collected.questions, mergedMeta.bankId)
    outcome.meta = mergedMeta
  } else {
    const table = parseTable(input.payload)

    if (table.missing.length) {
      console.error(`表头缺少必需列：${table.missing.join(' / ')}（也可能是第一行不是表头）`)
      return 1
    }

    const built = buildQuestions(table.rows, table.headerMap, meta.bankId)

    outcome = Object.assign({ meta }, built)
  }

  const report = {
    subjectId: outcome.meta.subjectId,
    subjectName: outcome.meta.subjectName,
    bankId: outcome.meta.bankId,
    bankName: outcome.meta.bankName,
    questionCount: outcome.questions.length,
    typeCounts: parser.summarizeTypeCounts(outcome.questions),
    errors: outcome.errors,
    warnings: outcome.warnings
  }

  printReport(report)

  if (outcome.errors.length && !args['skip-invalid']) {
    console.error('\n存在错误行，未写入任何文件。改完表重跑，或加 --skip-invalid 跳过这些行。')
    return 1
  }

  if (!outcome.questions.length) {
    console.error('\n没有可导入的题目。')
    return 1
  }

  if (args['dry-run']) {
    console.log('\n--dry-run：只校验，未写入文件。')
    return 0
  }

  const root = path.resolve(args.root ? String(args.root) : path.join(__dirname, '..', 'miniprogram'))
  const bank = buildBank(outcome.meta, outcome.questions)
  const banksDir = path.join(root, 'data', 'banks')

  fs.mkdirSync(banksDir, { recursive: true })
  fs.writeFileSync(path.join(banksDir, `${bank.bankId}.json`), `${JSON.stringify(bank, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(banksDir, `${bank.bankId}.js`), buildBankSource(bank), 'utf8')

  const catalogPath = path.join(root, 'data', 'catalog.js')
  const catalogJsonPath = path.join(root, 'data', 'catalog.json')
  const catalogSource = fs.readFileSync(catalogPath, 'utf8')
  const rawCatalog = catalogSource.replace(/^module\.exports\s*=\s*/, '').replace(/;\s*$/, '')

  let catalog = {}

  try {
    catalog = JSON.parse(rawCatalog)
  } catch (error) {
    catalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'))
  }

  const nextCatalog = buildCatalogData(catalog, outcome.meta, bank.questionCount)

  fs.writeFileSync(catalogJsonPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8')
  fs.writeFileSync(catalogPath, `module.exports = ${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8')

  const loadersPath = path.join(root, 'utils', 'question-bank-catalog.js')
  const loadersSource = fs.readFileSync(loadersPath, 'utf8')

  fs.writeFileSync(loadersPath, buildBankLoadersSource(loadersSource, bank.bankId), 'utf8')

  console.log(`\n已写入：`)
  console.log(`  ${path.join(banksDir, `${bank.bankId}.js`)}`)
  console.log(`  ${path.join(banksDir, `${bank.bankId}.json`)}`)
  console.log(`  ${catalogPath}（已重算计数）`)
  console.log(`  ${loadersPath}（已登记 BANK_LOADERS）`)

  const subjectIsNew = !Array.isArray(catalog.subjects) || !catalog.subjects.some((item) => item.id === outcome.meta.subjectId)

  if (subjectIsNew) {
    console.log(`\n提示：科目 ${outcome.meta.subjectId} 是新建的，可到 utils/question-bank-catalog.js 的 SUBJECT_UI 补一行主题色与简称。`)
  }

  console.log('\n下一步：微信开发者工具里「清缓存 → 重新编译」，新题库就会出现在题库页。')

  return 0
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}

module.exports = {
  TEMPLATE_ROWS,
  VALID_TYPES: parser.VALID_TYPES,
  buildBank,
  buildBankLoadersSource,
  buildBankSource,
  buildCatalogData,
  buildOptions,
  buildQuestions,
  buildTemplateText,
  decodeBuffer,
  detectDelimiter,
  normalizeAnswerKeys,
  normalizeDifficulty,
  normalizeType,
  parseArgs,
  parseDelimitedText,
  parseTable,
  validateJsonQuestions
}
