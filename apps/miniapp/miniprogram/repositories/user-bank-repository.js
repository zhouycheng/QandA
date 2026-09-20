/**
 * 用户自助导入的题库仓储层。
 *
 * 与内置题库的区别：内置题库打包进小程序（data/banks/*.js，require 静态引入），
 * 用户题库存在 storage 里，只能运行时读出来再挂到 catalog 上。
 *
 * 三条容量红线（storage 单 key 上限 1MB，写满会直接抛错且已存数据一起丢）：
 * - 题库个数上限：防止无限导入
 * - 单库题量上限：手机上没人能做完 300 题以上的自建题库
 * - 总字节上限：写之前先算，超了就拒绝并告诉用户先删旧的
 */
const { parseTable, buildQuestions, validateJsonQuestions, buildBank, summarizeTypeCounts } = require('../utils/question-parser.js')

const STORAGE_KEY = 'qandaUserBanks'

const STORAGE_VERSION = 1

const MAX_BANKS = 20
const MAX_QUESTIONS_PER_BANK = 300
// 1MB 是小程序 storage 单 key 的硬上限，这里留出 20% 余量
const MAX_TOTAL_BYTES = 800 * 1024

const USER_SUBJECT_ID = 'subject-user'
const USER_SUBJECT_NAME = '我的题库'

/**
 * 估算 JSON 的字节数。
 * 中文按 UTF-8 占 3 字节算，直接取 string.length 会低估三分之一，
 * 低估到某天真的写满 1MB 就是「导入成功但下次启动全没了」。
 */
function estimateBytes(value) {
  let text = ''

  try {
    text = JSON.stringify(value)
  } catch (error) {
    return 0
  }

  let bytes = 0

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else {
      bytes += 3
    }
  }

  return bytes
}

function readRaw(storage) {
  if (!storage) {
    return null
  }

  const raw = storage.get(STORAGE_KEY)

  // 真实 wx.getStorageSync 对「键不存在」返回空字符串，内存 mock 返回 null，
  // 两种都要当成「没有数据」
  if (!raw || typeof raw !== 'object') {
    return null
  }

  return raw
}

function normalizeQuestion(question) {
  if (!question || typeof question !== 'object') {
    return null
  }

  const type = question.type === 'multiple' ? 'multiple' : question.type === 'judge' ? 'judge' : 'single'
  const id = String(question.id || '').trim()
  const stem = String(question.stem || '').trim()
  const options = (Array.isArray(question.options) ? question.options : [])
    .map((option) => ({
      key: String(option.key || '').trim(),
      label: String(option.label || option.key || '').trim(),
      text: String(option.text || '').trim()
    }))
    .filter((option) => option.key && option.text)
  const answerKeys = (Array.isArray(question.answerKeys) ? question.answerKeys : [])
    .map((key) => String(key || '').trim().toUpperCase())

  if (!id || !stem || options.length < 2 || !answerKeys.length) {
    return null
  }

  return {
    id,
    type,
    stem,
    options,
    answerKeys,
    weight: Number(question.weight) || 1,
    difficulty: question.difficulty || 'normal',
    tags: Array.isArray(question.tags) ? question.tags.filter(Boolean) : [],
    explanation: String(question.explanation || '').trim() || '本题暂无解析。'
  }
}

/**
 * 读出时一律归一化：storage 里的内容可能是老版本写的，
 * 也可能是用户手动改坏的，这里挡一层，页面就不会因为一条脏数据整页空白。
 */
function normalizeBank(raw) {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const bankId = String(raw.bankId || '').trim()
  const bankName = String(raw.bankName || '').trim()
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean)

  if (!bankId || !bankName) {
    return null
  }

  return {
    bankId,
    bankName,
    subjectId: USER_SUBJECT_ID,
    subjectName: USER_SUBJECT_NAME,
    questionCount: questions.length,
    importedAt: Number(raw.importedAt) || 0,
    sourceName: String(raw.sourceName || '').trim(),
    questions
  }
}

function getUserBanks(storage) {
  const raw = readRaw(storage)

  if (!raw || !Array.isArray(raw.banks)) {
    return []
  }

  return raw.banks.map(normalizeBank).filter(Boolean)
}

function getUserBank(storage, bankId) {
  return getUserBanks(storage).find((bank) => bank.bankId === bankId) || null
}

function createUserBankId() {
  return `user-${Date.now().toString(36)}`
}

function buildStorageData(banks) {
  return {
    version: STORAGE_VERSION,
    updatedAt: Date.now(),
    banks
  }
}

/**
 * 写入一份题库。同名的覆盖，超容量或超题量的直接拒绝并给出原因。
 * 返回值带 banks 是为了让页面拿最新列表刷新，不必再读一次。
 */
function saveUserBank(storage, bank, options) {
  const normalizedOptions = options || {}
  const normalized = normalizeBank(bank)

  if (!storage) {
    return { ok: false, reason: '存储不可用', banks: [] }
  }

  if (!normalized) {
    return { ok: false, reason: '题库内容不完整', banks: getUserBanks(storage) }
  }

  if (!normalized.questions.length) {
    return { ok: false, reason: '没有可导入的题目', banks: getUserBanks(storage) }
  }

  if (normalized.questions.length > MAX_QUESTIONS_PER_BANK) {
    return {
      ok: false,
      reason: `单个题库最多 ${MAX_QUESTIONS_PER_BANK} 题，这份有 ${normalized.questions.length} 题`,
      banks: getUserBanks(storage)
    }
  }

  const current = getUserBanks(storage)
  const rest = current.filter((item) => item.bankId !== normalized.bankId)

  if (rest.length >= MAX_BANKS) {
    return {
      ok: false,
      reason: `最多导入 ${MAX_BANKS} 个题库，请先删除不再用的`,
      banks: current
    }
  }

  const next = rest.concat([normalized])

  if (!normalizedOptions.force) {
    const bytes = estimateBytes(buildStorageData(next))

    if (bytes > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        reason: `空间不足（需要 ${Math.ceil(bytes / 1024)}KB，上限 ${Math.floor(MAX_TOTAL_BYTES / 1024)}KB），请先删除旧题库`,
        banks: current
      }
    }
  }

  storage.set(STORAGE_KEY, buildStorageData(next))

  return { ok: true, reason: '', banks: next }
}

function removeUserBank(storage, bankId) {
  if (!storage) {
    return []
  }

  const next = getUserBanks(storage).filter((bank) => bank.bankId !== bankId)

  storage.set(STORAGE_KEY, buildStorageData(next))

  return next
}

function clearUserBanks(storage) {
  if (!storage) {
    return []
  }

  storage.set(STORAGE_KEY, buildStorageData([]))

  return []
}

/**
 * 解析用户给的原始文本 → 校验结果。
 * 只做计算不落盘，页面拿它出预览，用户确认后再调 saveUserBank。
 */
function parseBankText(text, bankId) {
  const table = parseTable(text)
  const source = String(text || '').trim()

  if (!source) {
    return { questions: [], errors: [], warnings: [], missing: ['type', 'stem', 'answer'], brokenEncoding: false }
  }

  if (table.missing.length) {
    return {
      questions: [],
      errors: [],
      warnings: [],
      missing: table.missing,
      brokenEncoding: table.brokenEncoding
    }
  }

  const outcome = buildQuestions(table.rows, table.headerMap, bankId)

  return {
    questions: outcome.questions,
    errors: outcome.errors,
    warnings: outcome.warnings,
    missing: [],
    brokenEncoding: table.brokenEncoding
  }
}

/** 预览信息：题量、题型分布、错误条数，够用户在导入前判断这份表对不对 */
function buildPreview(questions, errors, warnings) {
  return {
    questionCount: questions.length,
    typeCounts: summarizeTypeCounts(questions),
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.slice(0, 5),
    warnings: warnings.slice(0, 5)
  }
}

function buildUserBank(meta, questions) {
  return Object.assign(buildBank({
    subjectId: USER_SUBJECT_ID,
    subjectName: USER_SUBJECT_NAME,
    bankId: meta.bankId,
    bankName: meta.bankName,
    sourceChapterId: ''
  }, questions), {
    importedAt: Date.now(),
    sourceName: String(meta.sourceName || '').trim()
  })
}

module.exports = {
  MAX_BANKS,
  MAX_QUESTIONS_PER_BANK,
  MAX_TOTAL_BYTES,
  STORAGE_KEY,
  STORAGE_VERSION,
  USER_SUBJECT_ID,
  USER_SUBJECT_NAME,
  buildPreview,
  buildUserBank,
  clearUserBanks,
  createUserBankId,
  estimateBytes,
  getUserBank,
  getUserBanks,
  normalizeBank,
  normalizeQuestion,
  parseBankText,
  removeUserBank,
  saveUserBank,
  validateJsonQuestions
}
