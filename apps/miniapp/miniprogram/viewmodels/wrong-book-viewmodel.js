const practiceRepository = require('../repositories/practice-repository.js')
const { getMasteredIds, getPendingIds } = require('../utils/wrong-book.js')

const TAB_WRONG = 'wrong'
const TAB_FAVORITE = 'favorite'
const FILTER_PENDING = 'pending'
const FILTER_MASTERED = 'mastered'

const EMPTY_TEXT = {
  wrongPending: '还没有错题，先去练习几道吧',
  wrongMastered: '还没有已攻克的错题',
  favorite: '还没有收藏的题目，答题时点「收藏」即可加入'
}

function createNullStorage() {
  return {
    get() {
      return null
    },

    set() {},

    remove() {}
  }
}

function getInitialWrongBookViewData() {
  return {
    activeTab: TAB_WRONG,
    wrongFilter: FILTER_PENDING,
    tabs: [
      { key: TAB_WRONG, text: '错题本', count: 0 },
      { key: TAB_FAVORITE, text: '我的收藏', count: 0 }
    ],
    filters: [
      { key: FILTER_PENDING, text: '待复习' },
      { key: FILTER_MASTERED, text: '已攻克' }
    ],
    items: [],
    pendingCount: 0,
    masteredCount: 0,
    favoriteCount: 0,
    currentCount: 0,
    practiceText: '开始练习',
    emptyText: EMPTY_TEXT.wrongPending
  }
}

class WrongBookViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.state = getInitialWrongBookViewData()
  }

  static getInitialData() {
    return getInitialWrongBookViewData()
  }

  load(options) {
    const normalizedOptions = options || {}
    const activeTab = normalizedOptions.tab === TAB_FAVORITE ? TAB_FAVORITE : TAB_WRONG

    return this.refresh({ activeTab })
  }

  refresh(patch) {
    this.state = Object.assign({}, this.state, patch || {})
    const data = this.buildViewData()
    // items 同步回 state，供「清空当前列表」取 id
    this.state.items = data.items

    return {
      data
    }
  }

  buildViewData() {
    const wrongBook = this.repository.getWrongBook(this.storage)
    const favorites = this.repository.getFavorites(this.storage)
    const pendingIds = getPendingIds(wrongBook)
    const masteredIds = getMasteredIds(wrongBook)
    const favoriteIds = this.repository.getFavoriteIds(favorites)
    const isWrongTab = this.state.activeTab === TAB_WRONG
    const targetIds = isWrongTab
      ? (this.state.wrongFilter === FILTER_MASTERED ? masteredIds : pendingIds)
      : favoriteIds
    const items = this.buildItems(targetIds, wrongBook, favorites)
    const tabs = [
      { key: TAB_WRONG, text: '错题本', count: pendingIds.length },
      { key: TAB_FAVORITE, text: '我的收藏', count: favoriteIds.length }
    ]

    return {
      activeTab: this.state.activeTab,
      wrongFilter: this.state.wrongFilter,
      tabs,
      filters: [
        { key: FILTER_PENDING, text: `待复习 ${pendingIds.length}` },
        { key: FILTER_MASTERED, text: `已攻克 ${masteredIds.length}` }
      ],
      items,
      pendingCount: pendingIds.length,
      masteredCount: masteredIds.length,
      favoriteCount: favoriteIds.length,
      currentCount: items.length,
      practiceText: isWrongTab ? `重练错题 ${items.length} 题` : `练习收藏 ${items.length} 题`,
      emptyText: isWrongTab
        ? (this.state.wrongFilter === FILTER_MASTERED ? EMPTY_TEXT.wrongMastered : EMPTY_TEXT.wrongPending)
        : EMPTY_TEXT.favorite
    }
  }

  buildItems(questionIds, wrongBook, favorites) {
    return this.repository.findQuestionEntries(questionIds).map((entry, index) => {
      const record = wrongBook[entry.id] || null

      return {
        id: entry.id,
        number: index + 1,
        stem: entry.question.stem,
        typeText: entry.question.typeText,
        subjectName: entry.subjectName,
        bankName: entry.bankName,
        sourceText: `${entry.subjectName} · ${entry.bankName}`,
        wrongCount: record ? record.wrongCount : 0,
        rightCount: record ? record.rightCount : 0,
        streak: record ? record.streak : 0,
        mastered: record ? record.mastered : false,
        isFavorite: this.repository.hasFavorite
          ? this.repository.hasFavorite(favorites, entry.id)
          : favorites.ids.indexOf(entry.id) >= 0,
        metaText: record
          ? `错 ${record.wrongCount} 次 · 对 ${record.rightCount} 次${record.mastered ? ' · 已攻克' : ''}`
          : entry.question.typeText,
        answerText: entry.question.answerKeys.join('') || '-',
        explanation: entry.question.explanation
      }
    })
  }

  getTargetIds() {
    return this.state.items ? this.state.items.map((item) => item.id) : []
  }

  switchTab(tabKey) {
    const activeTab = tabKey === TAB_FAVORITE ? TAB_FAVORITE : TAB_WRONG

    if (activeTab === this.state.activeTab) {
      return null
    }

    return this.refresh({ activeTab })
  }

  switchFilter(filterKey) {
    const wrongFilter = filterKey === FILTER_MASTERED ? FILTER_MASTERED : FILTER_PENDING

    if (wrongFilter === this.state.wrongFilter) {
      return null
    }

    return this.refresh({ wrongFilter })
  }

  removeItem(questionId) {
    return this.withMutation(() => {
      if (this.state.activeTab === TAB_WRONG) {
        this.repository.removeWrongQuestions(this.storage, [questionId])
        return '已从错题本移除'
      }

      this.repository.removeQuestionFavorites(this.storage, [questionId])
      return '已取消收藏'
    })
  }

  toggleFavorite(questionId) {
    return this.withMutation(() => {
      const result = this.repository.toggleQuestionFavorite(this.storage, questionId)
      return result.value ? '已收藏本题' : '已取消收藏'
    })
  }

  clearCurrent() {
    return this.withMutation(() => {
      if (this.state.activeTab === TAB_WRONG) {
        const count = this.getTargetIds().length
        this.repository.removeWrongQuestions(this.storage, this.getTargetIds())
        return `已移除 ${count} 道错题`
      }

      this.repository.clearFavorites(this.storage)
      return '已清空收藏'
    })
  }

  /**
   * 把当前列表的题目组成练习卷，走答题页的 scope=custom 入口。
   */
  createPracticeCommand() {
    const ids = this.buildViewData().items.map((item) => item.id)
    const isWrongTab = this.state.activeTab === TAB_WRONG

    if (!ids.length) {
      return null
    }

    this.repository.saveCustomQuiz(this.storage, ids, isWrongTab ? '错题重练' : '收藏练习')

    return {
      command: {
        type: 'navigate',
        url: `/page/practice/index?scope=custom&mode=practice&seed=${Date.now()}`
      }
    }
  }

  withMutation(mutate) {
    const message = mutate() || '操作完成'
    const result = this.refresh({})

    result.command = {
      type: 'toast',
      title: message
    }

    return result
  }
}

module.exports = {
  FILTER_MASTERED,
  FILTER_PENDING,
  TAB_FAVORITE,
  TAB_WRONG,
  WrongBookViewModel
}
