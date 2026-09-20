const {
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
} = require('../utils/favorites.js')

/**
 * 仓储层：收藏夹读写。计算逻辑在 utils/favorites.js。
 * storage 由页面注入（微信端传 wx 适配器），未注入时退化为空实现，便于在 Node 中测试。
 */
function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getStorageAdapter(storage) {
  return storage || createNullStorage()
}

function getFavorites(storage) {
  const adapter = getStorageAdapter(storage)
  let raw = null

  try {
    raw = adapter.get(FAVORITE_STORAGE_KEY)
  } catch (error) {
    raw = null
  }

  return normalizeFavorites(raw)
}

function saveFavorites(storage, favorites) {
  const adapter = getStorageAdapter(storage)
  const normalized = normalizeFavorites(favorites)

  try {
    adapter.set(FAVORITE_STORAGE_KEY, normalized)
  } catch (error) {
    return normalized
  }

  return normalized
}

function toggleQuestionFavorite(storage, questionId) {
  const result = toggleFavorite(getFavorites(storage), questionId, Date.now())

  return {
    favorites: saveFavorites(storage, result.favorites),
    value: result.value
  }
}

function addQuestionFavorite(storage, questionId) {
  return saveFavorites(storage, addFavorite(getFavorites(storage), questionId, Date.now()))
}

function removeQuestionFavorite(storage, questionId) {
  return saveFavorites(storage, removeFavorite(getFavorites(storage), questionId, Date.now()))
}

function removeQuestionFavorites(storage, questionIds) {
  return saveFavorites(storage, removeFavorites(getFavorites(storage), questionIds, Date.now()))
}

function clearFavorites(storage) {
  const adapter = getStorageAdapter(storage)

  try {
    adapter.remove(FAVORITE_STORAGE_KEY)
  } catch (error) {
    return createEmptyFavorites()
  }

  return createEmptyFavorites()
}

module.exports = {
  addQuestionFavorite,
  clearFavorites,
  countFavorites,
  getFavoriteIds,
  getFavorites,
  hasFavorite,
  removeQuestionFavorite,
  removeQuestionFavorites,
  saveFavorites,
  toggleQuestionFavorite
}
