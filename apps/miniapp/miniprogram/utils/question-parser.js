/**
 * 题目表格解析与校验（纯计算，不碰 wx，可在 Node 里直接跑断言）。
 *
 * 这是**离线导入脚本与小程序端自助导入共用的唯一一份规则**：
 * - scripts/import-question-bank.cjs（开发者批量导入）引用本模块
 * - page/import-bank（用户在小程序里导入自己的题库）也引用本模块
 *
 * 两边各写一份的后果是「脚本能导入、小程序里报同一份表有错」，
 * 这种不一致只能靠用户反馈才发现，因此这里必须是单一真源。
 *
 * 刻意保持零依赖：不引任何解析库，CSV 引号/换行/转义自己处理。
 */

const VALID_TYPES = ['single', 'multiple', 'judge']

const TYPE_ALIASES = {
  single: 'single',
  单选: 'single',
  单选题: 'single',
  单选题目: 'single',
  '1': 'single',
  multiple: 'multiple',
  多选: 'multiple',
  多选题: 'multiple',
  多选题目: 'multiple',
  '2': 'multiple',
  judge: 'judge',
  判断: 'judge',
  判断题: 'judge',
  判断题型: 'judge',
  对错: 'judge',
  '3': 'judge'
}

const DIFFICULTY_ALIASES = {
  easy: 'easy',
  简单: 'easy',
  易: 'easy',
  normal: 'normal',
  中等: 'normal',
  普通: 'normal',
  中: 'normal',
  hard: 'hard',
  困难: 'hard',
  难: 'hard'
}

/** 表头别名：中英文都收，用户从 Excel 直接导出也能用 */
const FIELD_ALIASES = {
  id: ['id', '题号', '题目id', '题目编号', 'questionid'],
  type: ['type', '题型', '题目类型', '类型', 'questiontype'],
  stem: ['stem', '题干', '题目', '题目内容', 'title', 'question'],
  options: ['options', '选项', '所有选项'],
  answer: ['answer', 'answerkeys', '答案', '正确答案', 'correctanswer'],
  explanation: ['explanation', '解析', '答案解析', 'explain'],
  difficulty: ['difficulty', '难度', '难度等级'],
  tags: ['tags', '标签', '知识点', 'tag']
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

const OPTION_FIELD_ALIASES = OPTION_KEYS.reduce((map, key) => {
  const lower = key.toLowerCase()

  // 别名必须全小写：表头会先被 normalizeHeader 转小写（"选项A" → "选项a"），
  // 这里留一个大写别名就永远匹配不上，表现为「导入后所有题都报选项不足」
  map[`option${key}`] = [`option${lower}`, `选项${lower}`, `${lower}选项`, `选项 ${lower}`, lower]

  return map
}, {})

const JUDGE_OPTIONS = [
  { key: 'A', label: 'A', text: '正确' },
  { key: 'B', label: 'B', text: '错误' }
]

const TRUE_ALIASES = ['a', '正确', '对', '是', '√', '✓', 'true', 't', 'yes', 'y']
const FALSE_ALIASES = ['b', '错误', '错', '否', '×', '✗', 'false', 'f', 'no', 'n']

const REQUIRED_FIELDS = ['type', 'stem', 'answer']

// ---------- 文本清洗 ----------

/**
 * 去掉 BOM。带 BOM 的 CSV 是 Excel 导出的常态，
 * 不剥掉的话第一列表头会变成 "\ufeff题型"，表现为「表头看着对却匹配不上」。
 */
function stripBom(text) {
  const source = String(text || '')

  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
}

/** 替换字符 U+FFFD 说明这段文本不是 UTF-8 解出来的（多半是 GBK） */
function hasBrokenChars(text) {
  return String(text || '').indexOf('�') >= 0
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || ''
  const tabs = (firstLine.match(/\t/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length

  return tabs > commas ? '\t' : ','
}

/** 支持引号包裹、引号内换行与 "" 转义的最小 CSV 解析器 */
function parseDelimitedText(text, delimiter) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }

      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((item) => item.some((value) => String(value).trim() !== ''))
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function buildHeaderMap(headerRow) {
  const map = {}

  headerRow.forEach((header, index) => {
    const normalized = normalizeHeader(header)

    if (!normalized) {
      return
    }

    Object.keys(FIELD_ALIASES).forEach((field) => {
      if (FIELD_ALIASES[field].indexOf(normalized) >= 0 && map[field] === undefined) {
        map[field] = index
      }
    })

    Object.keys(OPTION_FIELD_ALIASES).forEach((field) => {
      if (OPTION_FIELD_ALIASES[field].indexOf(normalized) >= 0 && map[field] === undefined) {
        map[field] = index
      }
    })
  })

  return map
}

/** 把表格转成「表头映射 + 数据行」；第一行不是表头时按位置兜底 */
function parseTable(text) {
  const clean = stripBom(text)
  const delimiter = detectDelimiter(clean)
  const rows = parseDelimitedText(clean, delimiter)

  if (!rows.length) {
    return {
      delimiter,
      headerMap: {},
      rows: [],
      missing: REQUIRED_FIELDS.slice(),
      brokenEncoding: false
    }
  }

  const headerMap = buildHeaderMap(rows[0])
  const looksLikeHeader = headerMap.type !== undefined || headerMap.stem !== undefined
  const dataRows = looksLikeHeader ? rows.slice(1) : rows
  const missing = REQUIRED_FIELDS.filter((field) => headerMap[field] === undefined)

  return {
    delimiter,
    headerMap,
    rows: dataRows,
    missing,
    brokenEncoding: hasBrokenChars(clean)
  }
}

// ---------- 归一化 ----------

function normalizeType(value) {
  const key = String(value || '').trim().toLowerCase()

  return TYPE_ALIASES[key] || ''
}

function normalizeDifficulty(value) {
  const key = String(value || '').trim().toLowerCase()

  return DIFFICULTY_ALIASES[key] || 'normal'
}

function splitList(value) {
  return String(value || '')
    .split(/[|｜、,，;；/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 答案归一化。三种写法都要能吃：
 * - 字母：A / AC / A,C / A|C
 * - 判断题写成「正确 / 错误 / √ / ×」
 * - 选项文本（把答案写成选项内容本身）
 */
function normalizeAnswerKeys(rawAnswer, options, type) {
  const text = String(rawAnswer || '').trim()

  if (!text) {
    return []
  }

  if (type === 'judge') {
    const lower = text.toLowerCase()

    if (TRUE_ALIASES.indexOf(lower) >= 0) {
      return ['A']
    }

    if (FALSE_ALIASES.indexOf(lower) >= 0) {
      return ['B']
    }
  }

  const letters = text.toUpperCase().match(/[A-F]/g) || []

  if (letters.length) {
    return letters.filter((letter, index) => letters.indexOf(letter) === index)
  }

  // 没字母：按选项文本匹配
  return options
    .filter((option) => option.text === text)
    .map((option) => option.key)
}

function buildOptions(row, headerMap, type) {
  if (type === 'judge') {
    return JUDGE_OPTIONS.map((option) => Object.assign({}, option))
  }

  const combined = headerMap.options !== undefined ? splitList(row[headerMap.options]) : []
  const fromColumns = OPTION_KEYS
    .map((key) => ({
      key,
      text: headerMap[`option${key}`] !== undefined ? String(row[headerMap[`option${key}`]] || '').trim() : ''
    }))
    .filter((option) => option.text)

  const source = fromColumns.length
    ? fromColumns
    : combined.map((text, index) => ({ key: OPTION_KEYS[index] || String(index), text }))

  return source.map((option) => ({
    key: option.key,
    label: option.key,
    text: option.text
  }))
}

// ---------- 校验与构建 ----------

/**
 * 逐行校验 → 题目对象。
 *
 * 四条硬规则（违反即该行判废）：
 * 1. 题型必须是单选 / 多选 / 判断；
 * 2. 至少两个非空选项；
 * 3. 答案必须落在选项里；
 * 4. 多选题答案至少两个，单选与判断只能一个
 *   —— 答案写成「ABD」但选项只有 A/B/C 是最常见的录入错误，必须在导入时拦下。
 *
 * 行号从 2 开始（第 1 行是表头），报错要能直接对应到 Excel 里的行。
 */
function buildQuestions(rows, headerMap, bankId) {
  const questions = []
  const errors = []
  const warnings = []
  const seenIds = {}
  const seenStems = {}
  let autoIndex = 0

  rows.forEach((row, rowIndex) => {
    const lineNumber = rowIndex + 2
    const rawType = headerMap.type !== undefined ? row[headerMap.type] : ''
    const type = normalizeType(rawType)
    const stem = String((headerMap.stem !== undefined ? row[headerMap.stem] : '') || '').trim()
    const rawAnswer = headerMap.answer !== undefined ? row[headerMap.answer] : ''

    if (!type) {
      errors.push({ line: lineNumber, field: '题型', reason: `无法识别的题型「${rawType}」` })
      return
    }

    if (!stem) {
      errors.push({ line: lineNumber, field: '题干', reason: '题干为空' })
      return
    }

    const options = buildOptions(row, headerMap, type)

    if (options.length < 2) {
      errors.push({ line: lineNumber, field: '选项', reason: '至少需要两个非空选项' })
      return
    }

    const answerKeys = normalizeAnswerKeys(rawAnswer, options, type)

    if (!answerKeys.length) {
      errors.push({ line: lineNumber, field: '答案', reason: `答案「${rawAnswer}」不在选项内` })
      return
    }

    const unknownKeys = answerKeys.filter((key) => !options.some((option) => option.key === key))

    if (unknownKeys.length) {
      errors.push({ line: lineNumber, field: '答案', reason: `答案 ${unknownKeys.join('')} 超出选项范围` })
      return
    }

    if (type === 'multiple' && answerKeys.length < 2) {
      errors.push({ line: lineNumber, field: '答案', reason: '多选题至少要有两个答案' })
      return
    }

    if (type !== 'multiple' && answerKeys.length > 1) {
      errors.push({ line: lineNumber, field: '答案', reason: `${type === 'judge' ? '判断题' : '单选题'}只能有一个答案` })
      return
    }

    autoIndex += 1

    const rawId = headerMap.id !== undefined ? String(row[headerMap.id] || '').trim() : ''
    const id = rawId || `${bankId}-q${String(autoIndex).padStart(3, '0')}`

    if (seenIds[id]) {
      errors.push({ line: lineNumber, field: 'id', reason: `题目 id 重复：${id}` })
      return
    }

    if (seenStems[stem]) {
      warnings.push({ line: lineNumber, field: '题干', reason: `与第 ${seenStems[stem]} 行题干重复` })
    }

    seenIds[id] = true
    seenStems[stem] = lineNumber

    questions.push({
      id,
      type,
      stem,
      options,
      answerKeys,
      weight: 1,
      difficulty: normalizeDifficulty(headerMap.difficulty !== undefined ? row[headerMap.difficulty] : ''),
      tags: headerMap.tags !== undefined ? splitList(row[headerMap.tags]) : [],
      explanation: String((headerMap.explanation !== undefined ? row[headerMap.explanation] : '') || '').trim() || '本题暂无解析。'
    })
  })

  return { questions, errors, warnings }
}

/** JSON 输入：题目已成形，只做与表格同一套规则的结构校验 */
function validateJsonQuestions(questions, bankId) {
  const errors = []
  const warnings = []
  const normalized = []
  const seenIds = {}

  questions.forEach((question, index) => {
    const lineNumber = index + 2
    const type = normalizeType(question && question.type)
    const stem = String((question && question.stem) || '').trim()

    if (!type) {
      errors.push({ line: lineNumber, field: '题型', reason: `无法识别的题型「${question && question.type}」` })
      return
    }

    if (!stem) {
      errors.push({ line: lineNumber, field: '题干', reason: '题干为空' })
      return
    }

    const options = (Array.isArray(question.options) ? question.options : [])
      .map((option) => ({
        key: String(option.key || option.label || '').trim().toUpperCase(),
        label: String(option.label || option.key || '').trim(),
        text: String(option.text || '').trim()
      }))
      .filter((option) => option.key && option.text)

    if (options.length < 2) {
      errors.push({ line: lineNumber, field: '选项', reason: '至少需要两个非空选项' })
      return
    }

    const answerKeys = normalizeAnswerKeys(question.answerKeys, options, type)
    const unknownKeys = answerKeys.filter((key) => !options.some((option) => option.key === key))

    if (!answerKeys.length || unknownKeys.length) {
      errors.push({ line: lineNumber, field: '答案', reason: `答案 ${JSON.stringify(question.answerKeys)} 与选项不匹配` })
      return
    }

    const id = String((question && question.id) || `${bankId}-q${String(normalized.length + 1).padStart(3, '0')}`).trim()

    if (seenIds[id]) {
      errors.push({ line: lineNumber, field: 'id', reason: `题目 id 重复：${id}` })
      return
    }

    seenIds[id] = true

    normalized.push({
      id,
      type,
      stem,
      options,
      answerKeys,
      weight: Number(question.weight) || 1,
      difficulty: normalizeDifficulty(question.difficulty),
      tags: Array.isArray(question.tags) ? question.tags.filter(Boolean) : [],
      explanation: String(question.explanation || '').trim() || '本题暂无解析。'
    })
  })

  return { questions: normalized, errors, warnings }
}

/** 题型分布：导入预览要显示「单选 12 / 多选 3 / 判断 5」 */
function summarizeTypeCounts(questions) {
  const counts = { single: 0, multiple: 0, judge: 0 }

  questions.forEach((question) => {
    const key = counts[question.type] === undefined ? 'single' : question.type
    counts[key] += 1
  })

  return counts
}

/**
 * 组装成一份可直接被 catalog 消费的题库对象。
 * 用户题库与内置题库用同一形状，加载链路才不用分叉。
 */
function buildBank(meta, questions) {
  return {
    status: 'released',
    subjectId: meta.subjectId,
    subjectName: meta.subjectName,
    bankId: meta.bankId,
    bankName: meta.bankName,
    sourceChapterId: meta.sourceChapterId || '',
    questionCount: questions.length,
    questions
  }
}

module.exports = {
  DIFFICULTY_ALIASES,
  FALSE_ALIASES,
  FIELD_ALIASES,
  JUDGE_OPTIONS,
  OPTION_KEYS,
  REQUIRED_FIELDS,
  TRUE_ALIASES,
  TYPE_ALIASES,
  VALID_TYPES,
  buildBank,
  buildHeaderMap,
  buildOptions,
  buildQuestions,
  detectDelimiter,
  hasBrokenChars,
  normalizeAnswerKeys,
  normalizeDifficulty,
  normalizeHeader,
  normalizeType,
  parseDelimitedText,
  parseTable,
  splitList,
  stripBom,
  summarizeTypeCounts,
  validateJsonQuestions
}
