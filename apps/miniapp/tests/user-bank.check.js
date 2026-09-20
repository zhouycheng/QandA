/**
 * 用户自助导入题库 —— Node 自检脚本。
 * 运行：node apps/miniapp/tests/user-bank.check.js
 *
 * 这份脚本守三件事：
 * 1. 解析规则与离线导入脚本是同一套（脚本已经改成引用运行时解析器了，这里守住不回退）
 * 2. storage 容量红线真的会拦（题库写满 1MB 的后果是「下次启动全部消失」）
 * 3. 导进来的题库能被 catalog / PracticeViewModel 正常取到——只在仓储层转一圈
 *    说明不了用户在题库页看不看得到
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const importer = require(path.resolve(__dirname, '../scripts/import-question-bank.cjs'))
const parser = require(path.join(MINIPROGRAM, 'utils/question-parser.js'))
const userBankRepository = require(path.join(MINIPROGRAM, 'repositories/user-bank-repository.js'))
const catalog = require(path.join(MINIPROGRAM, 'utils/question-bank-catalog.js'))
const { ImportBankViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/import-bank-viewmodel.js'))
const practiceRepository = require(path.join(MINIPROGRAM, 'repositories/practice-repository.js'))
const { PracticeViewModel } = require(path.join(MINIPROGRAM, 'viewmodels/practice-viewmodel.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function createStorage() {
  const map = {}

  return {
    map,
    get(key) {
      return map[key] === undefined ? null : map[key]
    },
    set(key, value) {
      map[key] = value
    },
    remove(key) {
      delete map[key]
    }
  }
}

const SAMPLE = [
  '题型,题干,选项A,选项B,选项C,选项D,答案,解析,难度,标签',
  '单选,下列句子没有语病的一项是：,水平提高,水平改进,水平增加,水平增强,A,搭配,easy,病句',
  '多选,下列属于五四口号的有：,外争主权,内除国贼,实业救国,民主与科学,A|B,无关项,normal,近代史',
  '判断,《史记》是第一部纪传体通史。,,,,,正确,司马迁所著,easy,文学常识'
].join('\n')

// ---------- 1. 与离线脚本同一套规则 ----------
assert('同源 - 脚本的 parseTable 就是运行时解析器', importer.parseTable === parser.parseTable, '脚本没引用运行时解析器')
assert('同源 - 脚本的 buildQuestions 就是运行时解析器', importer.buildQuestions === parser.buildQuestions, 'buildQuestions 被复制了一份')
assert('同源 - 两边解析同一份文本结果一致',
  JSON.stringify(importer.parseTable(SAMPLE).rows.length) === JSON.stringify(parser.parseTable(SAMPLE).rows.length),
  '行数不一致')

// ---------- 2. 运行时解析 ----------
const parsed = userBankRepository.parseBankText(SAMPLE, 'user-x')
assert('解析 - 解析出 3 题', parsed.questions.length === 3, `实际 ${parsed.questions.length}`)
assert('解析 - 题型归一正确', parsed.questions.map((item) => item.type).join(',') === 'single,multiple,judge', parsed.questions.map((item) => item.type).join(','))
assert('解析 - 判断题自动补正确/错误', JSON.stringify(parsed.questions[2].options.map((item) => item.text)) === '["正确","错误"]', JSON.stringify(parsed.questions[2].options))
assert('解析 - 判断题答案归一为 A', JSON.stringify(parsed.questions[2].answerKeys) === '["A"]', JSON.stringify(parsed.questions[2].answerKeys))
assert('解析 - 多选答案两个', parsed.questions[1].answerKeys.length === 2, JSON.stringify(parsed.questions[1].answerKeys))
assert('解析 - 无错误', parsed.errors.length === 0, JSON.stringify(parsed.errors))

const missingHeader = userBankRepository.parseBankText('题干,选项A\n问题,甲', 'user-x')
assert('解析 - 缺表头列时返回 missing', missingHeader.missing.indexOf('type') >= 0 && missingHeader.missing.indexOf('answer') >= 0, JSON.stringify(missingHeader.missing))
assert('解析 - 空文本不报错', userBankRepository.parseBankText('', 'user-x').questions.length === 0, '空文本应返回空题目')

const broken = userBankRepository.parseBankText('题型,题干,选项A,选项B,答案\n单选,�乱码,甲,乙,A', 'user-x')
assert('解析 - 乱码被识别为编码问题', broken.brokenEncoding === true, '未识别 GBK 乱码')

const withError = userBankRepository.parseBankText('题型,题干,选项A,选项B,答案\n单选,题干一,甲,乙,A\n单选,题干二,甲,乙,D', 'user-x')
assert('解析 - 答案越界被拦下', withError.errors.length === 1 && withError.questions.length === 1, JSON.stringify(withError.errors))
assert('解析 - 错误带行号', withError.errors[0].line === 3, JSON.stringify(withError.errors[0]))

// ---------- 3. 容量红线 ----------
const storage = createStorage()
const okBank = userBankRepository.buildUserBank({ bankId: 'user-1', bankName: '第一章' }, parsed.questions)

assert('构建 - 题库带导入时间', typeof okBank.importedAt === 'number' && okBank.importedAt > 0, JSON.stringify(okBank.importedAt))
assert('构建 - 题库归属我的题库科目', okBank.subjectId === 'subject-user', okBank.subjectId)

const saved = userBankRepository.saveUserBank(storage, okBank)
assert('存储 - 写入成功', saved.ok === true, saved.reason)
assert('存储 - 读回 1 个题库', userBankRepository.getUserBanks(storage).length === 1, '数量不对')
assert('存储 - 题量正确', userBankRepository.getUserBank(storage, 'user-1').questionCount === 3, '题量不对')

const overwritten = userBankRepository.saveUserBank(storage, userBankRepository.buildUserBank({ bankId: 'user-1', bankName: '第一章（新版）' }, parsed.questions.slice(0, 1)))
assert('存储 - 同 id 覆盖而不是追加', overwritten.ok && userBankRepository.getUserBanks(storage).length === 1, '变成了两条')
assert('存储 - 覆盖后题量更新', userBankRepository.getUserBank(storage, 'user-1').questionCount === 1, '题量没更新')

const tooMany = Array.from({ length: userBankRepository.MAX_QUESTIONS_PER_BANK + 1 }, (item, index) => ({
  id: `q${index}`,
  type: 'single',
  stem: `题干${index}`,
  options: [{ key: 'A', label: 'A', text: '甲' }, { key: 'B', label: 'B', text: '乙' }],
  answerKeys: ['A'],
  explanation: '',
  difficulty: 'normal',
  tags: []
}))
const tooManyOutcome = userBankRepository.saveUserBank(storage, userBankRepository.buildUserBank({ bankId: 'user-big', bankName: '超大题库' }, tooMany))
assert('存储 - 单库题量超限被拒绝', tooManyOutcome.ok === false && /最多/.test(tooManyOutcome.reason), JSON.stringify(tooManyOutcome.reason))
assert('存储 - 被拒绝时不写入', userBankRepository.getUserBank(storage, 'user-big') === null, '还是写进去了')

const bankLimitStorage = createStorage()

for (let index = 0; index < userBankRepository.MAX_BANKS; index += 1) {
  userBankRepository.saveUserBank(bankLimitStorage, userBankRepository.buildUserBank({ bankId: `user-b${index}`, bankName: `题库${index}` }, parsed.questions))
}

const overLimit = userBankRepository.saveUserBank(bankLimitStorage, userBankRepository.buildUserBank({ bankId: 'user-extra', bankName: '多出来的' }, parsed.questions))
assert('存储 - 题库个数超限被拒绝', overLimit.ok === false, '没拦住')
assert('存储 - 超限提示可操作', /删除/.test(overLimit.reason), overLimit.reason)

const bigStorage = createStorage()
// 光靠题量凑不出 800KB：300 道短题才几十 KB，必须让题干变长才碰得到体积红线
const longStem = '这是一道用于压测体积上限的题目，'.repeat(60)
const fatQuestions = Array.from({ length: userBankRepository.MAX_QUESTIONS_PER_BANK }, (item, index) => ({
  id: `fat-q${index}`,
  type: 'single',
  stem: longStem,
  options: [{ key: 'A', label: 'A', text: '甲' }, { key: 'B', label: 'B', text: '乙' }],
  answerKeys: ['A'],
  explanation: '',
  difficulty: 'normal',
  tags: []
}))
const fatBank = userBankRepository.buildUserBank({ bankId: 'user-fat', bankName: '大题库' }, fatQuestions)
const fatOutcome = userBankRepository.saveUserBank(bigStorage, fatBank)

assert('存储 - 体积超限被拒绝', fatOutcome.ok === false && /空间不足/.test(fatOutcome.reason), JSON.stringify(fatOutcome.reason))
assert('存储 - force 可以强制写入', userBankRepository.saveUserBank(bigStorage, fatBank, { force: true }).ok === true, 'force 失效')

// ---------- 4. 脏数据归一 ----------
const dirtyStorage = createStorage()

dirtyStorage.set(userBankRepository.STORAGE_KEY, {
  version: 1,
  banks: [
    { bankId: 'user-d1', bankName: '正常', questions: [{ id: 'q1', type: 'single', stem: '题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answerKeys: ['A'] }] },
    { bankId: 'user-d2', bankName: '缺选项', questions: [{ id: 'q2', type: 'single', stem: '题干', options: [{ key: 'A', text: '甲' }], answerKeys: ['A'] }] },
    { bankId: '', bankName: '没 id', questions: [] },
    null
  ]
})

const cleaned = userBankRepository.getUserBanks(dirtyStorage)
assert('脏数据 - 坏题被丢弃', cleaned.length === 2 && cleaned[0].questionCount === 1, JSON.stringify(cleaned.map((item) => item.bankId)))
assert('脏数据 - 选项补全 label', cleaned[0].questions[0].options[0].label === 'A', JSON.stringify(cleaned[0].questions[0].options[0]))
assert('脏数据 - 非法题库被丢弃', !cleaned.some((item) => !item.bankId), '有空 id 混进来')
assert('脏数据 - 全部坏掉时返回空数组而不是崩溃', userBankRepository.getUserBanks(createStorage()).length === 0, '空 storage 异常')

// ---------- 5. catalog 合并 ----------
const catalogStorage = createStorage()

userBankRepository.saveUserBank(catalogStorage, okBank)
catalog.registerUserBanks(userBankRepository.getUserBanks(catalogStorage))

const summaries = catalog.getSubjectSummaries()
const userSubject = summaries.find((item) => item.id === 'subject-user')

assert('合并 - 科目列表出现我的题库', !!userSubject, JSON.stringify(summaries.map((item) => item.id)))
assert('合并 - 题库数与题量正确', userSubject && userSubject.bankCount === 1 && userSubject.questionCount === 3, JSON.stringify(userSubject))
assert('合并 - 排在最后', summaries[summaries.length - 1].id === 'subject-user', '顺序不对')

const userQuiz = catalog.getBankQuiz('subject-user', 'user-1')
assert('合并 - 能取到用户题库的卷', !!userQuiz && userQuiz.questions.length === 3, JSON.stringify(userQuiz && userQuiz.questions.length))
assert('合并 - 卷标题正确', userQuiz && userQuiz.title === '我的题库 · 第一章', userQuiz && userQuiz.title)
assert('合并 - 题目被运行时归一化', userQuiz && userQuiz.questions[0].typeText === '单选题', '未归一化')

const statsWithUser = catalog.getCatalogStats()
catalog.registerUserBanks([])
const statsWithoutUser = catalog.getCatalogStats()

assert('合并 - 统计计入用户题库', statsWithUser.questionCount === statsWithoutUser.questionCount + 3, `${statsWithUser.questionCount} vs ${statsWithoutUser.questionCount}`)
assert('合并 - 科目数 +1', statsWithUser.subjectCount === statsWithoutUser.subjectCount + 1, `${statsWithUser.subjectCount} vs ${statsWithoutUser.subjectCount}`)
assert('合并 - 清空注册后用户科目消失', !catalog.getSubjectSummaries().some((item) => item.id === 'subject-user'), '没消失')

catalog.registerUserBanks(userBankRepository.getUserBanks(catalogStorage))

// ---------- 6. 答题链路 ----------
const practiceVm = new PracticeViewModel({ storage: createStorage() })
const practiceResult = practiceVm.load({ subjectId: 'subject-user', bankId: 'user-1', mode: 'order' })

assert('链路 - 能开一场用户题库的练习', !!practiceResult && practiceResult.data.questions.length === 3, JSON.stringify(practiceResult && practiceResult.data.questions.length))

if (practiceResult && practiceResult.data.questions.length) {
  practiceVm.selectOption(0)
  // 只答一题时 submit() 会先弹「还有题目未答」的确认框，这里要的是直接交卷
  const submitted = practiceVm.forceSubmit()
  assert('链路 - 交卷正常', submitted.data.isCompleted === true, '未交卷')
  assert('链路 - 交卷后同步状态已落库', !!submitted.data.syncStatusText || submitted.submitOk !== undefined, '缺少提交结果')
}

assert('链路 - 仓储层暴露同步方法', typeof practiceRepository.syncUserBanks === 'function', '缺 syncUserBanks')
assert('链路 - 同步后能读到', practiceRepository.syncUserBanks(catalogStorage) === 1, '同步数量不对')

// ---------- 7. ViewModel ----------
const vmStorage = createStorage()
const vm = new ImportBankViewModel({ storage: vmStorage })
const initial = vm.load()

assert('VM - 初始列表为空', initial.data.banks.length === 0, '不为空')
assert('VM - 带模板提示', String(initial.data.templateHint || vm.constructor.getInitialData().templateHint).indexOf('题型,题干') === 0, '模板缺失')

const previewResult = vm.applyText(SAMPLE, '')
assert('VM - 预览题量', previewResult.data.preview.questionCount === 3, JSON.stringify(previewResult.data.preview))
assert('VM - 预览可导入', previewResult.data.canImport === true, 'canImport 应为 true')
assert('VM - 预览题型文案', /单选题 1/.test(previewResult.data.preview.typeText), previewResult.data.preview.typeText)
assert('VM - 文本长度提示', previewResult.data.textLengthText.length > 0, '无提示')

const errorPreview = vm.applyText('题型,题干,选项A,选项B,答案\n单选,题干,甲,乙,D', '')
assert('VM - 有错时不可导入', errorPreview.data.canImport === false, 'canImport 应为 false')
assert('VM - 有错时仍显示预览', errorPreview.data.preview && errorPreview.data.preview.errorCount === 1, '未显示错误')

const nameless = vm.importBank({ bankName: '', text: SAMPLE })
assert('VM - 没名字不导入', nameless.command && nameless.command.type === 'toast' && /名字/.test(nameless.command.title), JSON.stringify(nameless.command))

const imported = vm.importBank({ bankName: '我的第一章', text: SAMPLE, sourceName: '' })
assert('VM - 导入成功', imported.command && /已导入/.test(imported.command.title), JSON.stringify(imported.command))
assert('VM - 导入后列表刷新', imported.data.banks.length === 1 && imported.data.banks[0].name === '我的第一章', JSON.stringify(imported.data.banks))
assert('VM - 导入后清空输入', imported.data.text === '' && imported.data.canImport === false, '未清空')
assert('VM - 导入后落盘', userBankRepository.getUserBanks(vmStorage).length === 1, '没落盘')
assert('VM - 导入后 catalog 立即可见', !!catalog.getBankQuiz('subject-user', userBankRepository.getUserBanks(vmStorage)[0].bankId), 'catalog 没更新')

const openResult = vm.openBank(userBankRepository.getUserBanks(vmStorage)[0].bankId)
assert('VM - 打开题库给出跳转', openResult && openResult.command.type === 'navigate' && openResult.command.url.indexOf('bankId=user-') >= 0, JSON.stringify(openResult))
assert('VM - 不存在的题库不跳转', vm.openBank('not-exist') === null, '不该返回命令')

const removed = vm.removeBank(userBankRepository.getUserBanks(vmStorage)[0].bankId)
assert('VM - 删除后列表为空', removed.data.banks.length === 0, JSON.stringify(removed.data.banks))
assert('VM - 删除后 storage 清空', userBankRepository.getUserBanks(vmStorage).length === 0, 'storage 还在')
assert('VM - 删除后 catalog 同步', !catalog.getSubjectSummaries().some((item) => item.id === 'subject-user'), 'catalog 还有残留')

// ---------- 输出 ----------
const failed = results.filter((item) => !item.passed)

results.forEach((item) => {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
})

console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

if (failed.length) {
  process.exit(1)
}
