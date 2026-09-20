/**
 * 自定义练习（错题重练 / 收藏练习）：纯计算模块。
 *
 * 题目 id 列表可能很长，直接拼在 navigateTo 的 URL 上有长度风险，
 * 因此改为写入本地存储，跳转时只在 URL 上带 scope=custom。
 *
 * 存储结构（qandaCustomQuiz）：
 * { ids: ["q-cc-ch001-homework-001"], title: "错题重练", createdAt: 1758000000000 }
 */

const CUSTOM_QUIZ_STORAGE_KEY = 'qandaCustomQuiz'

function createEmptyCustomQuiz() {
  return {
    ids: [],
    title: '',
    createdAt: 0
  }
}

function normalizeCustomQuiz(rawCustomQuiz) {
  if (!rawCustomQuiz || typeof rawCustomQuiz !== 'object') {
    return createEmptyCustomQuiz()
  }

  const ids = []

  if (Array.isArray(rawCustomQuiz.ids)) {
    rawCustomQuiz.ids.forEach((id) => {
      if (typeof id === 'string' && id && ids.indexOf(id) === -1) {
        ids.push(id)
      }
    })
  }

  return {
    ids,
    title: typeof rawCustomQuiz.title === 'string' ? rawCustomQuiz.title : '',
    createdAt: Number(rawCustomQuiz.createdAt) || 0
  }
}

function createCustomQuiz(questionIds, title, timestamp) {
  const ids = []

  ;(questionIds || []).forEach((id) => {
    if (typeof id === 'string' && id && ids.indexOf(id) === -1) {
      ids.push(id)
    }
  })

  return {
    ids,
    title: title || '自定义练习',
    createdAt: Number(timestamp) || Date.now()
  }
}

module.exports = {
  CUSTOM_QUIZ_STORAGE_KEY,
  createCustomQuiz,
  createEmptyCustomQuiz,
  normalizeCustomQuiz
}
