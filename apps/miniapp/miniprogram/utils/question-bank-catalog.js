const catalog = require('../data/catalog.js')
const playgroundSwitch = require('./playground-switch.js')
const playgroundFixtures = require('../playground/playground-fixtures.js')

/**
 * 微信小程序的 require 不支持完全动态路径（require(`../data/banks/${id}.js`) 无法被静态分析），
 * 必须显式列出所有可加载的题库模块。新增题库时在此登记。
 */
const BANK_LOADERS = {
  'chinese-ch001': () => require('../data/banks/chinese-ch001.js'),
  'chinese-ch002': () => require('../data/banks/chinese-ch002.js'),
  'chinese-ch003': () => require('../data/banks/chinese-ch003.js'),
  'mental-ch001': () => require('../data/banks/mental-ch001.js'),
  'mental-ch002': () => require('../data/banks/mental-ch002.js'),
  'mental-ch003': () => require('../data/banks/mental-ch003.js'),
  'english-ch001': () => require('../data/banks/english-ch001.js'),
  'english-ch002': () => require('../data/banks/english-ch002.js'),
  'english-ch003': () => require('../data/banks/english-ch003.js'),
  // Playground 题库（PRD 7）：题目运行时生成，空题库必须真的是 0 题
  'playground-normal': () => ({ questions: playgroundFixtures.getPlaygroundQuestions('playground-normal') }),
  'playground-empty': () => ({ questions: playgroundFixtures.getPlaygroundQuestions('playground-empty') }),
  'playground-stress': () => ({ questions: playgroundFixtures.getPlaygroundQuestions('playground-stress') })
}

const SUBJECT_UI = {
  'subject-chinese': {
    theme: 'chinese',
    shortName: '语',
    description: '覆盖课文理解、文学常识与语言运用，适合课前预习和课后复习。'
  },
  'subject-mental-health': {
    theme: 'mental',
    shortName: '心',
    description: '覆盖大学适应、自我认知、情绪管理与人际沟通，适合日常自测。'
  },
  'subject-english': {
    theme: 'english',
    shortName: '英',
    description: '覆盖单元词汇、语法与阅读理解，适合阶段性巩固。'
  },
  // theme 复用 chinese：Playground 没有专属配色，用未知值会掉到无样式状态
  'subject-playground': {
    theme: 'chinese',
    shortName: 'P',
    description: '开发工具专用：正常题库 / 空题库 / 100 题压力，随 Playground 开关出现。'
  }
}

const QUESTION_TYPE_TEXT = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题'
}

const DEFAULT_PRACTICE_COUNT = 10

/**
 * 正式科目 +（开关打开时的）Playground 科目。
 * Playground 题库只有这样才能被真实页面走到——「空题库」「100 题压力」
 * 光在单元测试里跑一遍说明不了页面会不会白屏。
 */
function getRawSubjects() {
  const subjects = Array.isArray(catalog.subjects) ? catalog.subjects : []

  return playgroundSwitch.isEnabled()
    ? subjects.concat(playgroundFixtures.getPlaygroundSubjects())
    : subjects
}

function getSubjectUi(subjectId) {
  return SUBJECT_UI[subjectId] || {}
}

function shuffleQuestions(questions, seed) {
  const items = questions.slice()
  const seedText = String(seed === undefined || seed === null || seed === '' ? Date.now() : seed)
  let hash = 2166136261

  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  let cursor = Math.abs(hash) || 1

  for (let index = items.length - 1; index > 0; index -= 1) {
    // 必须用 Math.imul 保持 32 位整数运算：cursor * 1103515245 会超出 IEEE754 安全整数范围，
    // 精度丢失会让不同 seed 产生相同的打散结果。
    cursor = (Math.imul(cursor, 1103515245) + 12345) >>> 0

    if (cursor === 0) {
      cursor = 1
    }

    const swapIndex = cursor % (index + 1)
    const temp = items[index]
    items[index] = items[swapIndex]
    items[swapIndex] = temp
  }

  return items
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function normalizeQuestionView(question) {
  const type = question.type === 'multiple' ? 'multiple' : question.type === 'judge' ? 'judge' : 'single'

  return {
    id: question.id,
    type,
    isMultiple: type === 'multiple',
    isJudge: type === 'judge',
    typeText: QUESTION_TYPE_TEXT[type] || '单选题',
    stem: question.stem || '',
    options: (question.options || []).map((option) => ({
      key: option.key,
      label: option.label || option.key,
      text: option.text || ''
    })),
    answerKeys: question.answerKeys || [],
    explanation: question.explanation || '本题暂无解析。',
    weight: typeof question.weight === 'number' ? question.weight : 1,
    difficulty: question.difficulty || 'normal',
    tags: question.tags || []
  }
}

function getSubjectSummaries() {
  return getRawSubjects()
    .map((subject, index) => ({
      id: subject.id,
      name: subject.name,
      theme: getSubjectUi(subject.id).theme || 'chinese',
      shortName: getSubjectUi(subject.id).shortName || String(subject.name || '').slice(0, 1),
      description: getSubjectUi(subject.id).description || '',
      bankCount: subject.bankCount || 0,
      questionCount: subject.questionCount || 0,
      bankText: `${subject.bankCount || 0} 个题库`,
      questionText: `${subject.questionCount || 0} 道题目`,
      order: typeof subject.order === 'number' ? subject.order : 1000 + index,
      detailUrl: getSubjectDetailUrl(subject.id),
      // 供进度统计按题库汇总，不参与渲染
      banks: (subject.banks || []).map((bank) => ({
        id: bank.id,
        name: bank.name,
        questionCount: Number(bank.questionCount) || 0
      }))
    }))
    .sort((left, right) => left.order - right.order)
}

function getSubjectDetail(subjectId) {
  const subjects = getRawSubjects()
  const subject = subjects.find((item) => item.id === subjectId)

  if (!subject) {
    return null
  }

  const ui = getSubjectUi(subject.id)
  const banks = (subject.banks || []).map((bank, index) => ({
    id: bank.id,
    subjectId: subject.id,
    subjectName: subject.name,
    name: bank.name,
    label: `题库 ${index + 1}`,
    unitText: `单元 ${index + 1}`,
    unitIndex: index + 1,
    questionCount: Number(bank.questionCount) || 0,
    questionText: `${Number(bank.questionCount) || 0} 题`,
    practiceUrl: getBankPracticeUrl(subject.id, bank.id)
  }))

  return {
    id: subject.id,
    name: subject.name,
    theme: ui.theme || 'chinese',
    description: ui.description || '题库内容来自已发布运行态题库。',
    bankCount: banks.length,
    questionCount: banks.reduce((total, bank) => total + bank.questionCount, 0),
    bankBadgeText: `${banks.length} 个题库`,
    questionBadgeText: `${subject.questionCount || 0} 道题目`,
    banks
  }
}

function loadBank(bankId) {
  const loader = BANK_LOADERS[bankId]
  return loader ? loader() : null
}

function getBankQuiz(subjectId, bankId, options) {
  const subject = getRawSubjects().find((item) => item.id === subjectId)
  const bankMeta = subject ? (subject.banks || []).find((item) => item.id === bankId) : null
  const bank = loadBank(bankId)

  if (!subject || !bankMeta || !bank) {
    return null
  }

  const normalizedOptions = options || {}
  const rawQuestions = (bank.questions || []).map(normalizeQuestionView)
  const questions = normalizedOptions.shuffle
    ? shuffleQuestions(rawQuestions, normalizedOptions.seed)
    : rawQuestions

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    bankId,
    bankName: bankMeta.name,
    title: `${subject.name} · ${bankMeta.name}`,
    sharePath: getBankPracticeUrl(subject.id, bankId),
    storageKey: `qandaBestScore:${bankId}`,
    questions
  }
}

function getSubjectQuiz(subjectId) {
  const subject = getRawSubjects().find((item) => item.id === subjectId)

  if (!subject) {
    return null
  }

  const questions = (subject.banks || []).reduce((items, bank) => {
    const quiz = getBankQuiz(subjectId, bank.id)
    return quiz ? items.concat(quiz.questions) : items
  }, [])

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    bankId: '',
    bankName: '全部题库',
    title: `${subject.name} · 抽题练习`,
    sharePath: getSubjectDrawUrl(subjectId),
    storageKey: `qandaBestScore:${subjectId}:draw`,
    questions
  }
}

/**
 * 整科练习卷：同一套逻辑覆盖两种用法。
 * - 不传 count：整科全量（对应「开始练习」）
 * - 传 count：按题量抽取（对应「模拟测试」）
 *
 * options.shuffle === false 时保持题库原顺序，供顺序练习与背题模式使用；
 * 否则按 seed 洗牌，保证抽题与测试每次题序不同。
 */
function getSubjectDrawQuiz(subjectId, count, seed, options) {
  const quiz = getSubjectQuiz(subjectId)

  if (!quiz) {
    return null
  }

  const requested = Number(count)
  const questionCount = requested > 0
    ? Math.min(normalizePositiveInteger(count, DEFAULT_PRACTICE_COUNT), quiz.questions.length)
    : quiz.questions.length
  const shouldShuffle = !(options && options.shuffle === false)
  const pool = shouldShuffle ? shuffleQuestions(quiz.questions, seed) : quiz.questions
  const questions = pool.slice(0, questionCount)

  return Object.assign({}, quiz, {
    title: `${quiz.subjectName} · 整科练习`,
    sharePath: getSubjectDrawUrl(subjectId, { count: questionCount, seed }),
    storageKey: `qandaBestScore:${subjectId}:draw:${questionCount}`,
    questions
  })
}

function getFirstBankQuiz() {
  const subjects = getRawSubjects()

  for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
    const banks = subjects[subjectIndex].banks || []

    for (let bankIndex = 0; bankIndex < banks.length; bankIndex += 1) {
      const quiz = getBankQuiz(subjects[subjectIndex].id, banks[bankIndex].id)

      if (quiz && quiz.questions.length > 0) {
        return quiz
      }
    }
  }

  return null
}

function getCatalogStats() {
  const subjects = getRawSubjects()

  return {
    version: catalog.version || '',
    subjectCount: typeof catalog.subjectCount === 'number' ? catalog.subjectCount : subjects.length,
    bankCount: typeof catalog.bankCount === 'number'
      ? catalog.bankCount
      : subjects.reduce((total, subject) => total + (subject.bankCount || 0), 0),
    questionCount: typeof catalog.questionCount === 'number'
      ? catalog.questionCount
      : subjects.reduce((total, subject) => total + (subject.questionCount || 0), 0)
  }
}

function getBankMetaByStorageKey(rawKey) {
  if (!rawKey) {
    return null
  }

  const firstSegment = String(rawKey).split(':')[0]
  const subjects = getRawSubjects()
  const subject = subjects.find((item) => item.id === firstSegment)

  if (subject) {
    return {
      title: `${subject.name} · 抽题练习`
    }
  }

  for (let index = 0; index < subjects.length; index += 1) {
    const bank = (subjects[index].banks || []).find((item) => item.id === firstSegment)

    if (bank) {
      const isTest = String(rawKey).indexOf(':test') >= 0

      return {
        title: `${subjects[index].name} · ${bank.name}${isTest ? ' · 模拟测试' : ''}`
      }
    }
  }

  return null
}

function getSubjectDetailUrl(subjectId) {
  return `/page/bank-detail/index?subjectId=${encodeURIComponent(subjectId)}`
}

function getBankPracticeUrl(subjectId, bankId, extra) {
  const query = [
    `subjectId=${encodeURIComponent(subjectId)}`,
    `bankId=${encodeURIComponent(bankId)}`
  ]

  if (extra && extra.mode) {
    query.push(`mode=${encodeURIComponent(extra.mode)}`)
  }

  if (extra && extra.seed) {
    query.push(`seed=${encodeURIComponent(extra.seed)}`)
  }

  return `/page/practice/index?${query.join('&')}`
}

function getSubjectDrawUrl(subjectId, extra) {
  const query = [`subjectId=${encodeURIComponent(subjectId)}`, 'scope=subject']

  if (extra && extra.count) {
    query.push(`count=${encodeURIComponent(extra.count)}`)
  }

  if (extra && extra.seed) {
    query.push(`seed=${encodeURIComponent(extra.seed)}`)
  }

  return `/page/practice/index?${query.join('&')}`
}

/**
 * 由进度表的 scopeKey 反查练习入口，用于首页「继续上次练习」。
 * scopeKey 可能是题库 id，也可能是科目 id（整科练习）。
 */
function getScopeMeta(scopeKey) {
  if (!scopeKey) {
    return null
  }

  const subjects = getRawSubjects()
  const subject = subjects.find((item) => item.id === scopeKey)

  if (subject) {
    return {
      type: 'subject',
      scopeKey,
      subjectId: subject.id,
      bankId: '',
      title: `${subject.name} · 整科练习`,
      description: `${subject.name} 全部题库`,
      url: getSubjectDrawUrl(subject.id, { count: DEFAULT_PRACTICE_COUNT })
    }
  }

  for (let index = 0; index < subjects.length; index += 1) {
    const bank = (subjects[index].banks || []).find((item) => item.id === scopeKey)

    if (bank) {
      return {
        type: 'bank',
        scopeKey,
        subjectId: subjects[index].id,
        bankId: bank.id,
        title: bank.name,
        description: `${subjects[index].name} · ${Number(bank.questionCount) || 0} 题`,
        url: getBankPracticeUrl(subjects[index].id, bank.id, { mode: 'order' })
      }
    }
  }

  return null
}

module.exports = {
  DEFAULT_PRACTICE_COUNT,
  QUESTION_TYPE_TEXT,
  catalog,
  getSubjectSummaries,
  getSubjectDetail,
  getBankQuiz,
  getSubjectQuiz,
  getSubjectDrawQuiz,
  getFirstBankQuiz,
  getSubjectDetailUrl,
  getBankPracticeUrl,
  getSubjectDrawUrl,
  getCatalogStats,
  loadBank,
  getBankMetaByStorageKey,
  getScopeMeta,
  normalizeQuestionView,
  shuffleQuestions
}
