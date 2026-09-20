const practiceRepository = require('../repositories/practice-repository.js')
const { getPendingIds } = require('../utils/wrong-book.js')
const { countFavorites } = require('../utils/favorites.js')

const BEST_SCORE_PREFIX = 'qandaBestScore:'

function createNullStorage() {
  return {
    get() {
      return 0
    },

    keys() {
      return []
    },

    remove() {}
  }
}

/**
 * 注意：这里不声明 version。版本号由页面从全局配置读取后 setData，
 * 若 ViewModel 也用空值参与 setData，会把页面已写入的版本号覆盖回空白。
 */
function getInitialMyViewData() {
  return {
    subjectCount: 0,
    bankCount: 0,
    questionCount: 0,
    wrongCount: 0,
    favoriteCount: 0,
    records: []
  }
}

class MyViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialMyViewData()
  }

  load() {
    const stats = this.repository.getCatalogStats()
    const wrongBook = this.repository.getWrongBook(this.storage)
    const favorites = this.repository.getFavorites(this.storage)

    return {
      data: Object.assign(getInitialMyViewData(), stats, {
        wrongCount: getPendingIds(wrongBook).length,
        favoriteCount: countFavorites(favorites)
      })
    }
  }

  /**
   * 清空本机全部学习数据。
   * 只清历史最佳成绩是不够的：进度、错题本、收藏、学习时长都是同一个
   * 「本机学习数据」的一部分，留一部分会让用户以为没清干净。
   */
  clearRecords() {
    const keys = this.storage.keys ? this.storage.keys() : []
    const recordKeys = keys.filter((key) => key.indexOf(BEST_SCORE_PREFIX) === 0)

    recordKeys.forEach((key) => this.storage.remove(key))

    if (this.repository.clearProgress) {
      this.repository.clearProgress(this.storage)
    }

    if (this.repository.clearWrongBook) {
      this.repository.clearWrongBook(this.storage)
    }

    if (this.repository.clearFavorites) {
      this.repository.clearFavorites(this.storage)
    }

    if (this.repository.clearCustomQuiz) {
      this.repository.clearCustomQuiz(this.storage)
    }

    if (this.repository.clearStudyTime) {
      this.repository.clearStudyTime(this.storage)
    }

    if (this.repository.clearDailyLog) {
      this.repository.clearDailyLog(this.storage)
    }

    // 学习偏好属于「设置」而不是「学习数据」，刻意不清：
    // 用户调好的字号与开关不应该因为清空成绩而丢失。

    const result = this.load()

    result.command = {
      type: 'toast',
      title: '已清空本机学习数据'
    }

    return result
  }
}

module.exports = {
  MyViewModel
}
