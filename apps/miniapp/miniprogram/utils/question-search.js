/**
 * 首页题目搜索：纯计算模块，在 index 上按关键词打分排序。
 *
 * 为什么单独成文件：
 *   1. 首页是 tabBar 主页面，搜索必须**完全本地**完成——没有后端、不能联网，
 *      也不该为了搜一道题把整卷加载出来；
 *   2. 排序规则要能被单测锁死：题干命中比选项命中更相关、开场命中比中途命中更相关，
 *      否则搜「行政」会把「行政复议」和「不涉及行政」排成一样前。
 */

const MAX_KEYWORD_LENGTH = 40
const DEFAULT_LIMIT = 20

/**
 * 关键词切分：整体当一个短语优先，再拆成单字做兜底。
 * 中文没有空格分词，拆字是唯一不引入词库的做法；
 * 单字只用于「都出现在题干里」的宽松匹配，不会把无关题排到前面。
 */
function normalizeKeyword(keyword) {
  const text = typeof keyword === 'string' ? keyword.trim() : ''

  return text.slice(0, MAX_KEYWORD_LENGTH)
}

function scoreEntry(entry, keyword, chars) {
  const phrase = keyword.toLowerCase()
  const stem = (entry.question.stem || '').toLowerCase()
  const optionText = (entry.question.options || []).map((option) => (option.text || '').toLowerCase()).join(' ')

  let score = 0

  const stemIndex = stem.indexOf(phrase)

  if (stemIndex === 0) {
    // 题干开头命中：相关性最高
    score += 100
  } else if (stemIndex > 0) {
    score += 70 - Math.min(stemIndex, 30)
  }

  if (optionText.indexOf(phrase) >= 0) {
    score += 40
  }

  if (score === 0) {
    // 短语没命中时，退化成「所有字都出现在题干或选项里」
    const haystack = `${stem} ${optionText}`
    const allPresent = chars.every((char) => haystack.indexOf(char) >= 0)

    if (allPresent) {
      score += 20
    }
  }

  if (score === 0) {
    return 0
  }

  // 题干越短越可能是用户要找的那道题（长材料题容易误命中）
  score += Math.max(0, 20 - Math.floor(stem.length / 20))

  return score
}

/**
 * @param {object} index questionId → { id, question, subjectId, subjectName, bankId, bankName }
 * @param {string} keyword 用户输入
 * @param {number} limit 返回条数上限
 * @returns {Array} 结果项，带高亮所需的片段字段
 */
function searchQuestions(index, keyword, limit) {
  const phrase = normalizeKeyword(keyword)
  const max = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT

  if (!phrase || !index) {
    return []
  }

  const chars = Array.from(new Set(phrase.toLowerCase().split(''))).filter((char) => char.trim())

  if (!chars.length) {
    return []
  }

  const matched = []

  Object.keys(index).forEach((questionId) => {
    const entry = index[questionId]
    const score = scoreEntry(entry, phrase, chars)

    if (score <= 0) {
      return
    }

    matched.push({
      score,
      questionId,
      stem: entry.question.stem || '',
      typeText: entry.question.typeText || '',
      subjectName: entry.subjectName || '',
      bankName: entry.bankName || ''
    })
  })

  matched.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return left.questionId < right.questionId ? -1 : 1
  })

  return matched.slice(0, max).map((item) => ({
    questionId: item.questionId,
    stem: item.stem,
    typeText: item.typeText,
    sourceText: [item.subjectName, item.bankName].filter(Boolean).join(' · ')
  }))
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_KEYWORD_LENGTH,
  normalizeKeyword,
  searchQuestions
}
