/**
 * 收藏夹：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 存储结构（qandaFavorites）：
 * {
 *   ids: ["q-cc-ch001-homework-001", "..."],
 *   updatedAt: 1758000000000
 * }
 *
 * 只存题目 id，题目正文由 utils/question-lookup.js 按 id 反查，避免题库更新后收藏内容过期。
 */

const FAVORITE_STORAGE_KEY = 'qandaFavorites'

function createEmptyFavorites() {
  return {
    ids: [],
    updatedAt: 0
  }
}

function normalizeFavorites(rawFavorites) {
  if (!rawFavorites || typeof rawFavorites !== 'object') {
    return createEmptyFavorites()
  }

  // 兼容早期格式：直接存数组
  const rawIds = Array.isArray(rawFavorites) ? rawFavorites : rawFavorites.ids
  const ids = []

  if (Array.isArray(rawIds)) {
    rawIds.forEach((id) => {
      if (typeof id === 'string' && id && ids.indexOf(id) === -1) {
        ids.push(id)
      }
    })
  }

  return {
    ids,
    updatedAt: Number(rawFavorites.updatedAt) || 0
  }
}

function hasFavorite(favorites, questionId) {
  if (!questionId) {
    return false
  }

  const ids = favorites && favorites.ids ? favorites.ids : []
  return ids.indexOf(questionId) >= 0
}

function withIds(favorites, ids, timestamp) {
  return {
    ids,
    updatedAt: Number(timestamp) || Date.now()
  }
}

function addFavorite(favorites, questionId, timestamp) {
  const normalized = normalizeFavorites(favorites)

  if (hasFavorite(normalized, questionId)) {
    return normalized
  }

  return withIds(normalized, normalized.ids.concat([questionId]), timestamp)
}

function removeFavorite(favorites, questionId, timestamp) {
  const normalized = normalizeFavorites(favorites)

  if (!hasFavorite(normalized, questionId)) {
    return normalized
  }

  return withIds(
    normalized,
    normalized.ids.filter((id) => id !== questionId),
    timestamp
  )
}

function toggleFavorite(favorites, questionId, timestamp) {
  const normalized = normalizeFavorites(favorites)
  const value = !hasFavorite(normalized, questionId)

  return {
    favorites: value
      ? addFavorite(normalized, questionId, timestamp)
      : removeFavorite(normalized, questionId, timestamp),
    value
  }
}

function removeFavorites(favorites, questionIds, timestamp) {
  const normalized = normalizeFavorites(favorites)
  const targetIds = questionIds || []

  return withIds(
    normalized,
    normalized.ids.filter((id) => targetIds.indexOf(id) === -1),
    timestamp
  )
}

/**
 * 按「后收藏的排前面」输出，收藏夹没有时间戳时退化到原顺序倒序。
 */
function getFavoriteIds(favorites) {
  return normalizeFavorites(favorites).ids.slice().reverse()
}

function countFavorites(favorites) {
  return normalizeFavorites(favorites).ids.length
}

module.exports = {
  FAVORITE_STORAGE_KEY,
  addFavorite,
  countFavorites,
  createEmptyFavorites,
  getFavoriteIds,
  hasFavorite,
  normalizeFavorites,
  removeFavorite,
  removeFavorites,
  toggleFavorite
}
