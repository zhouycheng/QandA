/**
 * 微信本地存储适配器。
 * 注入给 ViewModel / Repository，避免业务层直接依赖全局 wx。
 */
function createWxStorageAdapter(options) {
  const normalizedOptions = options || {}
  const storage = normalizedOptions.storage || (typeof wx !== 'undefined' ? wx : null)

  if (!storage) {
    return {
      get() {
        return null
      },

      set() {},

      remove() {},

      keys() {
        return []
      }
    }
  }

  return {
    get(key) {
      return storage.getStorageSync(key)
    },

    set(key, value) {
      storage.setStorageSync(key, value)
    },

    remove(key) {
      storage.removeStorageSync(key)
    },

    keys() {
      try {
        return storage.getStorageInfoSync().keys || []
      } catch (error) {
        return []
      }
    }
  }
}

module.exports = {
  createWxStorageAdapter
}
