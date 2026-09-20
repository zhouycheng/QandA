const practiceRepository = require('../repositories/practice-repository.js')
const { QUESTION_TYPE_TEXT } = require('../utils/question-bank-catalog.js')
const { createUserBankId, MAX_BANKS, MAX_QUESTIONS_PER_BANK } = require('../repositories/user-bank-repository.js')

/**
 * 导入页的两种输入方式。
 * 选文件走 wx.chooseMessageFile——它只能从**微信聊天记录**里选，
 * 所以「粘贴文本」必须同时存在，否则用户手上有文件也导不进来。
 */
const INPUT_MODES = [
  { value: 'paste', label: '粘贴表格' },
  { value: 'file', label: '从聊天选文件' }
]

// 文本长度上限：再大就该走开发者脚本了，小程序里解析几 MB 文本会卡住界面
const MAX_TEXT_LENGTH = 200 * 1024

const TEMPLATE_HINT = [
  '题型,题干,选项A,选项B,选项C,选项D,答案,解析,难度,标签',
  '单选,下列句子没有语病的一项是：,水平提高,水平改进,水平增加,水平增强,A,「水平」与「提高」搭配,easy,病句',
  '多选,下列属于五四口号的有：,外争主权,内除国贼,实业救国,民主与科学,A|B,「实业救国」无关,normal,近代史',
  '判断,《史记》是第一部纪传体通史。,,,,,正确,司马迁所著,easy,文学常识'
].join('\n')

function getInitialImportBankViewData() {
  return {
    inputMode: 'paste',
    inputModes: INPUT_MODES,
    bankName: '',
    sourceName: '',
    text: '',
    textLengthText: '',
    templateHint: TEMPLATE_HINT,
    preview: null,
    missing: [],
    brokenEncoding: false,
    canImport: false,
    banks: [],
    limitText: `最多 ${MAX_BANKS} 个题库，单个最多 ${MAX_QUESTIONS_PER_BANK} 题`,
    emptyText: '还没有导入过题库'
  }
}

function formatBytes(length) {
  const bytes = Number(length) || 0

  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} 字符`
}

class ImportBankViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || null
  }

  static getInitialData() {
    return getInitialImportBankViewData()
  }

  load() {
    return {
      data: {
        banks: this.buildBankList()
      }
    }
  }

  buildBankList() {
    return this.repository.getUserBanks(this.storage).map((bank) => ({
      bankId: bank.bankId,
      name: bank.bankName,
      questionText: `${bank.questionCount} 题`,
      importedAtText: bank.importedAt ? this.formatDate(bank.importedAt) : '',
      sourceText: bank.sourceName ? `来自 ${bank.sourceName}` : '手动粘贴导入'
    }))
  }

  formatDate(timestamp) {
    const date = new Date(timestamp)
    const pad = (value) => String(value).padStart(2, '0')

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  selectInputMode(mode) {
    return {
      data: {
        inputMode: mode === 'file' ? 'file' : 'paste'
      }
    }
  }

  setBankName(name) {
    return {
      data: {
        bankName: String(name || '').trim()
      }
    }
  }

  /**
   * 传入原始文本 → 解析 → 出预览。
   * 预览只是给用户看，落盘要等他点「导入」。
   */
  applyText(text, sourceName) {
    const raw = String(text || '')
    const clean = raw.slice(0, MAX_TEXT_LENGTH)
    const parsed = this.repository.parseBankText(clean, createUserBankId())
    const preview = buildPreview(parsed)

    return {
      data: {
        text: clean,
        sourceName: String(sourceName || '').trim(),
        textLengthText: formatBytes(clean.length),
        preview: preview && (preview.questionCount || preview.errorCount) ? preview : null,
        missing: parsed.missing,
        brokenEncoding: parsed.brokenEncoding,
        canImport: !!(preview && preview.questionCount && !preview.errorCount)
      }
    }
  }

  clearText() {
    return {
      data: {
        text: '',
        sourceName: '',
        textLengthText: '',
        preview: null,
        missing: [],
        brokenEncoding: false,
        canImport: false
      }
    }
  }

  /**
   * 落盘。同名题库覆盖，失败时把原因原样返回给页面 toast——
   * 容量类的失败用户能自己处理（删旧题库），不该吞掉。
   */
  importBank(currentState) {
    const state = currentState || {}
    const bankName = String(state.bankName || '').trim()
    const text = String(state.text || '')

    if (!bankName) {
      return {
        command: { type: 'toast', title: '先给题库起个名字' }
      }
    }

    const parsed = this.repository.parseBankText(text, createUserBankId())

    if (parsed.missing.length) {
      return {
        command: { type: 'toast', title: `表格缺少列：${parsed.missing.join(' / ')}` }
      }
    }

    if (parsed.brokenEncoding) {
      return {
        command: { type: 'toast', title: '文件可能是 GBK 编码，请另存为 UTF-8 后再导入' }
      }
    }

    if (!parsed.questions.length) {
      return {
        command: { type: 'toast', title: '没有解析出题目，检查一下表格' }
      }
    }

    if (parsed.errors.length) {
      return {
        command: { type: 'toast', title: `有 ${parsed.errors.length} 行有问题，先看预览` }
      }
    }

    const bank = this.repository.buildUserBank({
      bankId: createUserBankId(),
      bankName,
      sourceName: state.sourceName || ''
    }, parsed.questions)

    const outcome = this.repository.saveUserBank(this.storage, bank)

    if (!outcome.ok) {
      return {
        command: { type: 'toast', title: outcome.reason || '导入失败' }
      }
    }

    // 写进 storage 还不够：catalog 是启动时注册的快照，这里要立刻补上，
    // 否则导入完回到题库页看不到新题库，得杀掉小程序重进
    this.repository.registerUserBanks(outcome.banks)

    return {
      data: {
        banks: this.buildBankList(),
        text: '',
        sourceName: '',
        textLengthText: '',
        preview: null,
        missing: [],
        brokenEncoding: false,
        canImport: false,
        bankName: ''
      },
      command: {
        type: 'toast',
        title: `已导入 ${parsed.questions.length} 题`
      }
    }
  }

  removeBank(bankId) {
    const banks = this.repository.removeUserBank(this.storage, bankId)

    this.repository.registerUserBanks(banks)

    return {
      data: {
        banks: this.buildBankList()
      },
      command: { type: 'toast', title: '已删除' }
    }
  }

  /** 跳到练习页：用户题库与内置题库走同一个 URL，页面不需要区分 */
  openBank(bankId) {
    const bank = this.repository.getUserBank(this.storage, bankId)

    if (!bank) {
      return null
    }

    return {
      command: {
        type: 'navigate',
        url: `/page/practice/index?subjectId=${encodeURIComponent(bank.subjectId)}&bankId=${encodeURIComponent(bank.bankId)}&mode=order`
      }
    }
  }
}

/**
 * 预览只需要前几条错误，全量下发给 WXML 会让页面渲染一堆没用的行。
 * typeText 直接拼成「单选 2 · 多选 1 · 判断 3」，省得在 WXML 里再算一遍。
 */
function buildPreview(parsed) {
  const counts = parsed.questions.reduce((acc, question) => {
    acc[question.type] = (acc[question.type] || 0) + 1

    return acc
  }, {})
  const typeText = Object.keys(counts)
    .map((type) => `${QUESTION_TYPE_TEXT[type] || type} ${counts[type]}`)
    .join(' · ')

  return {
    questionCount: parsed.questions.length,
    typeText,
    errorCount: parsed.errors.length,
    warningCount: parsed.warnings.length,
    errors: parsed.errors.slice(0, 5),
    warnings: parsed.warnings.slice(0, 5)
  }
}

module.exports = {
  ImportBankViewModel,
  INPUT_MODES,
  MAX_TEXT_LENGTH,
  TEMPLATE_HINT
}
