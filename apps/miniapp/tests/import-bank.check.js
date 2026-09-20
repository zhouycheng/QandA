/**
 * 题库导入脚本 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/import-bank.check.js
 *
 * 这份脚本守的是「导进来的题能不能被小程序正确加载」，所以除了解析与校验，
 * 还把生成的题目喂给运行时的 normalizeQuestionView 跑一遍：
 * 导入契约与运行时的归一化规则一旦分叉，坏数据就会一路流到答题页。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const importer = require(path.resolve(__dirname, '../scripts/import-question-bank.cjs'))
const { normalizeQuestionView } = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

// ---------- 编码与分隔符 ----------
assert('编码 - UTF-8 BOM 被去掉', importer.decodeBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0xe9, 0xa2, 0x98])).indexOf('题') === 0, 'BOM 未处理')
assert('编码 - 纯 UTF-8 正常解码', importer.decodeBuffer(Buffer.from('题干,选项', 'utf8')) === '题干,选项', '解码异常')

const gbkBuffer = Buffer.from([0xcc, 0xe2, 0xb8, 0xc9]) // 「题干」的 GBK 字节

assert('编码 - GBK 回退（Excel 默认导出）', importer.decodeBuffer(gbkBuffer) === '题干', importer.decodeBuffer(gbkBuffer))
assert('分隔符 - 逗号表识别为逗号', importer.detectDelimiter('题型,题干\n单选,a') === ',', '识别错误')
assert('分隔符 - 制表符表识别为制表符', importer.detectDelimiter('题型\t题干\n单选\ta') === '\t', '识别错误')

// ---------- 表格解析 ----------
const parsedCsv = importer.parseDelimitedText('a,b\n"含,逗号","含""引号"""\n', ',')

assert('表格 - 引号内的逗号不被切分', parsedCsv[1][0] === '含,逗号', parsedCsv[1][0])
assert('表格 - 双引号转义还原', parsedCsv[1][1] === '含"引号"', parsedCsv[1][1])
assert('表格 - 空行被过滤', importer.parseDelimitedText('a,b\n\n,\nc,d\n', ',').length === 2, '空行未过滤')

const headerTable = importer.parseTable('题型,题干,选项A,选项B,答案\n单选,Q,A,B,A\n')

assert('表头 - 中文表头可识别', headerTable.headerMap.type === 0 && headerTable.headerMap.stem === 1, JSON.stringify(headerTable.headerMap))
assert('表头 - 不缺必需列', headerTable.missing.length === 0, headerTable.missing.join(','))
assert('表头 - 数据行不含表头', headerTable.rows.length === 1, `实际 ${headerTable.rows.length}`)

const englishTable = importer.parseTable('type,stem,optionA,optionB,answer\nsingle,Q,A,B,A\n')

assert('表头 - 英文表头可识别', englishTable.headerMap.type === 0 && englishTable.headerMap.answer === 4, JSON.stringify(englishTable.headerMap))

const noHeader = importer.parseTable('单选题,Q,A,B,A')

assert('表头 - 第一行不是表头时缺列会被报出', noHeader.missing.length > 0, '未报出')

// ---------- 归一化 ----------
assert('题型 - 中文映射', importer.normalizeType('单选') === 'single' && importer.normalizeType('多选') === 'multiple' && importer.normalizeType('判断') === 'judge', '映射错误')
assert('题型 - 英文与数字映射', importer.normalizeType('SINGLE') === 'single' && importer.normalizeType('2') === 'multiple', '映射错误')
assert('题型 - 非法题型返回空', importer.normalizeType('填空') === '', '未拦下')
assert('难度 - 中文映射', importer.normalizeDifficulty('简单') === 'easy' && importer.normalizeDifficulty('困难') === 'hard', '映射错误')
assert('难度 - 缺省为 normal', importer.normalizeDifficulty('') === 'normal', '缺省值不对')

const letterOptions = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }]

assert('答案 - 单字母', importer.normalizeAnswerKeys('A', letterOptions, 'single').join('') === 'A', '解析错误')
assert('答案 - 连写多选', importer.normalizeAnswerKeys('AC', letterOptions, 'multiple').join('') === 'AC', '解析错误')
assert('答案 - 竖线分隔', importer.normalizeAnswerKeys('A|C', letterOptions, 'multiple').join('') === 'AC', '解析错误')
assert('答案 - 中文逗号分隔', importer.normalizeAnswerKeys('A，C', letterOptions, 'multiple').join('') === 'AC', '解析错误')
assert('答案 - 大小写不敏感', importer.normalizeAnswerKeys('a', letterOptions, 'single').join('') === 'A', '解析错误')
assert('答案 - 判断题写「正确」', importer.normalizeAnswerKeys('正确', letterOptions, 'judge').join('') === 'A', '解析错误')
assert('答案 - 判断题写「错误」', importer.normalizeAnswerKeys('错误', letterOptions, 'judge').join('') === 'B', '解析错误')
assert('答案 - 判断题写「√」', importer.normalizeAnswerKeys('√', letterOptions, 'judge').join('') === 'A', '解析错误')
assert('答案 - 空答案返回空', importer.normalizeAnswerKeys('', letterOptions, 'single').length === 0, '空值未拦下')

// ---------- 选项构建 ----------
// 与 templates 一致的表头：题型 题干 选项A-D 答案 解析 难度 标签
const goodHeader = { type: 0, stem: 1, optionA: 2, optionB: 3, optionC: 4, optionD: 5, answer: 6, explanation: 7, difficulty: 8, tags: 9 }

const judgeRow = ['判断', '题干', '', '', '', '', '正确']
const judgeHeader = { type: 0, stem: 1, optionA: 2, optionB: 3, answer: 6 }
const judgeOptions = importer.buildOptions(judgeRow, judgeHeader, 'judge')

assert('选项 - 判断题自动补「正确/错误」', judgeOptions.length === 2 && judgeOptions[0].text === '正确' && judgeOptions[1].text === '错误', JSON.stringify(judgeOptions))

const columnRow = ['单选', '题干', '甲', '乙', '丙', '', 'A']
const columnOptions = importer.buildOptions(columnRow, goodHeader, 'single')

assert('选项 - 分列选项按字母编号', columnOptions.map((item) => item.key).join('') === 'ABC', JSON.stringify(columnOptions))
assert('选项 - 空选项被丢弃', columnOptions.length === 3, `实际 ${columnOptions.length}`)

const combinedRow = ['单选', '题干', '', '', '', '甲|乙|丙', 'A']
const combinedOptions = importer.buildOptions(combinedRow, Object.assign({}, judgeHeader, { options: 5 }), 'single')

assert('选项 - 合并列按分隔符拆开', combinedOptions.map((item) => item.text).join('') === '甲乙丙', JSON.stringify(combinedOptions))

// ---------- 逐行校验 ----------
const goodRows = [
  ['单选', '第一题', '甲', '乙', '', '', 'A', '解析1', '简单', '标签1'],
  ['多选', '第二题', '甲', '乙', '丙', '', 'A|B', '解析2', '', ''],
  ['判断', '第三题', '', '', '', '', '正确', '解析3', '', '']
]
const goodOutcome = importer.buildQuestions(goodRows, goodHeader, 'demo-ch001')

assert('校验 - 正常三行全部通过', goodOutcome.questions.length === 3 && goodOutcome.errors.length === 0, JSON.stringify(goodOutcome.errors))
assert('校验 - 题型被归一', goodOutcome.questions.map((item) => item.type).join(',') === 'single,multiple,judge', '题型不对')
assert('校验 - 多选题答案为两个', goodOutcome.questions[1].answerKeys.join('') === 'AB', goodOutcome.questions[1].answerKeys.join(''))
assert('校验 - 判断题答案为 A', goodOutcome.questions[2].answerKeys.join('') === 'A', goodOutcome.questions[2].answerKeys.join(''))
assert('校验 - 难度与标签被读取', goodOutcome.questions[0].difficulty === 'easy' && goodOutcome.questions[0].tags[0] === '标签1', JSON.stringify(goodOutcome.questions[0]))
assert('校验 - 缺省解析有兜底文案', goodOutcome.questions[1].explanation.length > 0, '缺省解析为空')
assert('校验 - id 自动生成', goodOutcome.questions[0].id === 'demo-ch001-q001', goodOutcome.questions[0].id)
assert(
  '校验 - 显式 id 被保留',
  importer.buildQuestions([['单选', '题干', '甲', '乙', '', '', 'A', '', '', '', 'my-q-001']], Object.assign({ id: 10 }, goodHeader), 'demo-ch001').questions[0].id === 'my-q-001',
  '未保留'
)

assert('校验 - 非法题型被拒', importer.buildQuestions([['填空', '题干', '甲', '乙', '', '', 'A']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - 空题干被拒', importer.buildQuestions([['单选', '', '甲', '乙', '', '', 'A']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - 选项不足被拒', importer.buildQuestions([['单选', '题干', '甲', '', '', '', 'A']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - 答案超出选项范围被拒', importer.buildQuestions([['单选', '题干', '甲', '乙', '', '', 'D']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - 多选只有一个答案被拒', importer.buildQuestions([['多选', '题干', '甲', '乙', '丙', '', 'A']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - 单选多个答案被拒', importer.buildQuestions([['单选', '题干', '甲', '乙', '丙', '', 'A|B']], goodHeader, 'b').errors.length === 1, '未拦下')
assert('校验 - id 重复被拒', importer.buildQuestions([['单选', '题干', '甲', '乙', '', '', 'A', '', '', '', 'x'], ['单选', '题干2', '甲', '乙', '', '', 'A', '', '', '', 'x']], Object.assign({ id: 10 }, goodHeader), 'b').errors.length === 1, '未拦下')
assert('校验 - 题干重复给警告而非错误', importer.buildQuestions([['单选', '同一题', '甲', '乙', '', '', 'A'], ['单选', '同一题', '甲', '乙', '', '', 'A']], goodHeader, 'b').warnings.length === 1, '未给出警告')

// ---------- 与运行时归一化规则对齐 ----------
const runtimeViews = goodOutcome.questions.map((item) => normalizeQuestionView(item))

assert('一致 - 导入的题能被运行时正确归一化', runtimeViews.every((item) => !!item.typeText), '归一化失败')
assert('一致 - 判断题被标成判断题型', runtimeViews[2].typeText === '判断题' && runtimeViews[2].isJudge === true, runtimeViews[2].typeText)
assert('一致 - 多选题 isMultiple 为真', runtimeViews[1].isMultiple === true && runtimeViews[0].isMultiple === false, '标记错误')
assert('一致 - 选项结构完整', runtimeViews.every((item) => item.options.every((option) => !!option.key && !!option.text)), '选项缺失')

// ---------- JSON 输入 ----------
const jsonOutcome = importer.validateJsonQuestions([
  { type: '单选', stem: '题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answerKeys: ['A'] },
  { type: '多选', stem: '题干2', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answerKeys: ['A', 'B'] }
], 'demo-ch002')

assert('JSON - 合法题目被接受', jsonOutcome.questions.length === 2 && jsonOutcome.errors.length === 0, JSON.stringify(jsonOutcome.errors))
assert('JSON - 答案与选项不匹配被拒', importer.validateJsonQuestions([{ type: '单选', stem: '题', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answerKeys: ['Z'] }], 'b').errors.length === 1, '未拦下')
assert('JSON - 缺选项被拒', importer.validateJsonQuestions([{ type: '单选', stem: '题', options: [{ key: 'A', text: '甲' }], answerKeys: ['A'] }], 'b').errors.length === 1, '未拦下')

// ---------- 生成题库文件 ----------
const bank = importer.buildBank({
  subjectId: 'subject-demo',
  subjectName: '示例科目',
  bankId: 'demo-ch001',
  bankName: '第一章'
}, goodOutcome.questions)

assert('题库 - 字段齐全', bank.status === 'released' && bank.subjectId === 'subject-demo' && bank.bankId === 'demo-ch001', JSON.stringify(bank))
assert('题库 - 题量自动统计', bank.questionCount === 3, `实际 ${bank.questionCount}`)

const bankSource = importer.buildBankSource(bank)

assert('题库 - js 文件以 module.exports 开头', bankSource.indexOf('module.exports = ') === 0, '前缀不对')

const parsedBack = JSON.parse(bankSource.replace(/^module\.exports\s*=\s*/, '').replace(/;\s*$/, ''))

assert('题库 - 生成内容可被 JSON 解析回来', parsedBack.questionCount === 3 && parsedBack.questions.length === 3, '解析失败')

// ---------- catalog 更新 ----------
const baseCatalog = {
  version: 'v1',
  subjectCount: 1,
  bankCount: 1,
  questionCount: 29,
  subjects: [
    {
      id: 'subject-chinese',
      name: '大学语文',
      theme: 'chinese',
      order: 10,
      bankCount: 1,
      questionCount: 29,
      banks: [{ id: 'chinese-ch001', name: '序二篇', questionCount: 29 }]
    }
  ]
}

const newSubjectCatalog = importer.buildCatalogData(baseCatalog, {
  subjectId: 'subject-demo',
  subjectName: '示例科目',
  bankId: 'demo-ch001',
  bankName: '第一章'
}, 20)

assert('catalog - 新科目被追加', newSubjectCatalog.subjects.length === 2, `实际 ${newSubjectCatalog.subjects.length}`)
assert('catalog - 新科目排在最后', newSubjectCatalog.subjects[1].id === 'subject-demo' && newSubjectCatalog.subjects[1].order === 20, JSON.stringify(newSubjectCatalog.subjects[1]))
assert('catalog - 顶层计数被重算', newSubjectCatalog.subjectCount === 2 && newSubjectCatalog.bankCount === 2 && newSubjectCatalog.questionCount === 49, JSON.stringify(newSubjectCatalog))

const existingSubjectCatalog = importer.buildCatalogData(newSubjectCatalog, {
  subjectId: 'subject-demo',
  subjectName: '示例科目',
  bankId: 'demo-ch002',
  bankName: '第二章'
}, 30)

assert('catalog - 同科目可追加第二个题库', existingSubjectCatalog.subjects[1].banks.length === 2, '未追加')
assert('catalog - 科目题量累加', existingSubjectCatalog.subjects[1].questionCount === 50, `实际 ${existingSubjectCatalog.subjects[1].questionCount}`)

const overwritten = importer.buildCatalogData(existingSubjectCatalog, {
  subjectId: 'subject-demo',
  subjectName: '示例科目',
  bankId: 'demo-ch001',
  bankName: '第一章（修订）'
}, 25)

assert('catalog - 重导同一题库不会重复计数', overwritten.subjects[1].banks.length === 2 && overwritten.subjects[1].questionCount === 55, `实际 ${overwritten.subjects[1].questionCount}`)
assert('catalog - 题库名被覆盖', overwritten.subjects[1].banks[0].name === '第一章（修订）', overwritten.subjects[1].banks[0].name)
assert('catalog - 原科目不受影响', overwritten.subjects[0].questionCount === 29, `实际 ${overwritten.subjects[0].questionCount}`)

// ---------- BANK_LOADERS 登记 ----------
const loadersSource = [
  "const BANK_LOADERS = {",
  "  'chinese-ch001': () => require('../data/banks/chinese-ch001.js'),",
  "  'english-ch003': () => require('../data/banks/english-ch003.js')",
  "}"
].join('\n')

const withNewLoader = importer.buildBankLoadersSource(loadersSource, 'demo-ch001')

assert('登记 - 新增一行', withNewLoader.indexOf("'demo-ch001': () => require('../data/banks/demo-ch001.js'),") >= 0, '未写入')
assert('登记 - 插在 BANK_LOADERS 内部', withNewLoader.indexOf("'demo-ch001'") < withNewLoader.indexOf("'chinese-ch001'"), '插入位置不对')
assert('登记 - 原有条目保留', withNewLoader.indexOf("'english-ch003'") >= 0, '原条目丢失')
assert('登记 - 重复登记不追加', importer.buildBankLoadersSource(withNewLoader, 'demo-ch001') === withNewLoader, '被重复追加')

// ---------- 模板 ----------
const template = importer.buildTemplateText()
const templateTable = importer.parseTable(template)

assert('模板 - 表头可被识别', templateTable.missing.length === 0, templateTable.missing.join(','))
assert('模板 - 含三行示例', templateTable.rows.length === 3, `实际 ${templateTable.rows.length}`)

const templateOutcome = importer.buildQuestions(templateTable.rows, templateTable.headerMap, 'demo-ch001')

assert('模板 - 示例题可直接导入', templateOutcome.questions.length === 3 && templateOutcome.errors.length === 0, JSON.stringify(templateOutcome.errors))
assert('模板 - 示例覆盖三种题型', templateOutcome.questions.map((item) => item.type).join(',') === 'single,multiple,judge', '题型不全')
assert('模板 - 多选题答案解析为两个', templateOutcome.questions[1].answerKeys.join('') === 'AB', templateOutcome.questions[1].answerKeys.join(''))

// ---------- 参数解析 ----------
const args = importer.parseArgs(['--file', 'a.csv', '--dry-run', '--bank-id', 'demo-ch001'])

assert('参数 - 带值参数正确', args.file === 'a.csv' && args['bank-id'] === 'demo-ch001', JSON.stringify(args))
assert('参数 - 开关参数正确', args['dry-run'] === true, JSON.stringify(args))

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
