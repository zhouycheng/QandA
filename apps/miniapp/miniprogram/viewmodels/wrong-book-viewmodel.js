const practiceRepository = require('../repositories/practice-repository.js')
const { getPendingIds, getMasteredIds } = require('../utils/wrong-book.js')

/**
 * 错题本 / 收藏本：设计稿「错题本」「收藏本」两张画板。
 *
 * 同一个页面类承载两种模式，靠 `type` 区分（路由仍是 page/wrong-book/index）：
 *   type=wrong    错题本：错题统计 + 反复错 / 近 7 天更新筛选 + 「开始错题练习」
 *   type=favorite 收藏本：收藏统计 + 待练习 / 已练习筛选 + 「开始收藏练习」
 *
 * 为什么不是两个页面：两页的骨架（统计卡 → 科目分布 → 筛选 → 列表 → 分页 → 底部按钮）
 * 完全一样，只在文案、指标口径与筛选项上分叉。两份代码会立刻长歪。
 */

const TYPE_WRONG = 'wrong'
const TYPE_FAVORITE = 'favorite'

/** 每页几道。设计稿是 3 道一页，26 道就翻了 9 页 —— 手机上翻页太碎，这里给 5 道 */
const PAGE_SIZE = 5

const CHIPS = {
  wrong: [
    { key: 'all', text: '全部' },
    { key: 'repeat', text: '反复错' },
    { key: 'recent', text: '近 7 天更新' }
  ],
  favorite: [
    { key: 'all', text: '全部' },
    { key: 'pending', text: '待练习' },
    { key: 'practiced', text: '已练习' }
  ]
}

/** 反复错的门槛：错 2 次以上才叫「反复」，错 1 次是手滑 */
const REPEAT_THRESHOLD = 2

const SORT_OPTIONS = {
  wrong: [
    { key: 'urgent', text: '最需复习' },
    { key: 'recent', text: '最近更新' }
  ],
  favorite: [
    { key: 'recent', text: '最近保存' },
    { key: 'old' , text: '最早收藏' }
  ]
}

const DIST_TONES = ['tone-0', 'tone-1', 'tone-2', 'tone-3']

const EMPTY_TEXT = {
  wrong: '错题本是空的，练习中答错的题会自动进来',
  favorite: '还没有收藏，答题时点「收藏」即可加入'
}

function createNullStorage() {
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

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function formatMonthDay(timestamp) {
  const value = Number(timestamp) || 0

  if (!value) {
    return ''
  }

  const date = new Date(value)

  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`
}

function getInitialWrongBookViewData() {
  return {
    // 页面身份：wrong = 错题本，favorite = 收藏本
    type: TYPE_WRONG,
    title: '错题本',
    statTitle: '错题统计',
    statHint: '',
    stats: [],
    // 科目分布（分段条 + 图例）
    dist: [],
    hasDist: false,
    // 筛选
    subjectFilters: [{ id: 'all', name: '全部科目' }],
    subjectFilter: 'all',
    subjectFilterText: '全部科目',
    subjectMenuOpen: false,
    sortText: '最需复习',
    // 状态筛选 chips
    chips: [],
    activeChip: 'all',
    // 列表
    items: [],
    totalCount: 0,
    pageCount: 1,
    page: 1,
    pageText: '',
    manage: false,
    // 底部
    footerText: '开始练习',
    footerHint: '',
    emptyText: EMPTY_TEXT.wrong
  }
}

class WrongBookViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.state = {
      type: TYPE_WRONG,
      subjectFilter: 'all',
      sort: 'urgent',
      activeChip: 'all',
      page: 1,
      manage: false,
      subjectMenuOpen: false
    }
  }

  static getInitialData() {
    return getInitialWrongBookViewData()
  }

  /** 只在首次进入时读参数；之后 onShow 走 refresh，避免把用户切到一半的筛选重置掉 */
  load(options) {
    const normalizedOptions = options || {}
    const rawType = normalizedOptions.type || normalizedOptions.tab

    this.state.type = rawType === TYPE_FAVORITE ? TYPE_FAVORITE : TYPE_WRONG
    this.state.subjectFilter = 'all'
    this.state.activeChip = 'all'
    this.state.page = 1
    this.state.manage = false
    this.state.subjectMenuOpen = false
    this.state.sort = this.state.type === TYPE_WRONG ? 'urgent' : 'recent'

    return this.refresh({})
  }

  refresh(patch) {
    this.state = Object.assign({}, this.state, patch || {})

    const data = this.buildViewData()
    // items 同步回 state，供「清空当前列表」取 id
    this.state.items = data.items

    return { data }
  }

  // ---------- 数据 ----------

  readSources() {
    const wrongBook = this.repository.getWrongBook(this.storage)
    const favorites = this.repository.getFavorites(this.storage)
    const favoriteIds = this.repository.getFavoriteIds
      ? this.repository.getFavoriteIds(favorites)
      : (favorites && favorites.ids ? favorites.ids : [])
    const progress = this.repository.getProgress(this.storage)
    const answeredIds = this.collectAnsweredIds(progress)

    return { wrongBook, favorites, favoriteIds, answeredIds }
  }

  collectAnsweredIds(progress) {
    const answered = {}

    Object.keys(progress || {}).forEach((scopeKey) => {
      const entry = progress[scopeKey]

      if (!entry || !entry.answers) {
        return
      }

      Object.keys(entry.answers).forEach((questionId) => {
        answered[questionId] = true
      })
    })

    return answered
  }

  /**
   * 错题本自己的正确率：只看本子里这些题的答对/答错次数。
   *
   * 不能用全站近 7 天正确率 —— 那会把「错题本里全是难题」显示成 80% 正确率，
   * 数字看着漂亮但和这一页的主题（这些题我还没掌握）自相矛盾。
   * 记录里 wrongCount / rightCount 只统计进入错题本之后的作答，正是这里要的口径。
   */
  readBookAccuracy(items) {
    let right = 0
    let wrong = 0

    items.forEach((item) => {
      right += Number(item.rightCount) || 0
      wrong += Number(item.wrongCount) || 0
    })

    const total = right + wrong

    return total ? Math.round((right / total) * 100) : 0
  }

  buildViewData() {
    const isWrongType = this.state.type === TYPE_WRONG
    const sources = this.readSources()
    const base = getInitialWrongBookViewData()
    // 全集（未受筛选影响）：统计卡与 chips 的数字都看这个
    const allItems = isWrongType
      ? this.buildWrongItems(sources)
      : this.buildFavoriteItems(sources)
    const filtered = this.applyFilters(allItems, isWrongType)
    const pageCount = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1)
    const page = Math.min(Math.max(this.state.page, 1), pageCount)
    const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const chips = this.buildChips(isWrongType, allItems)
    const subjects = this.buildSubjectOptions(isWrongType, allItems)

    return Object.assign({}, base, {
      type: this.state.type,
      title: isWrongType ? '错题本' : '收藏本',
      statTitle: isWrongType ? '错题统计' : '收藏统计',
      statHint: isWrongType
        ? '按重要程度，逐个攻克'
        : `已完成 ${this.buildFavoriteDoneRate(allItems)}%`,
      stats: isWrongType ? this.buildWrongStats(allItems) : this.buildFavoriteStats(allItems),
      dist: this.buildDist(allItems),
      hasDist: allItems.length > 0,
      subjectFilters: subjects,
      subjectFilter: this.state.subjectFilter,
      subjectFilterText: this.getSubjectFilterText(subjects),
      subjectMenuOpen: !!this.state.subjectMenuOpen,
      sortText: this.getSortText(),
      chips,
      activeChip: this.state.activeChip,
      items,
      totalCount: allItems.length,
      pageCount,
      page,
      pageText: filtered.length
        ? `共 ${filtered.length} 题 · 第 ${page} 页`
        : '没有符合条件的题目',
      manage: !!this.state.manage,
      footerText: isWrongType
        ? `开始错题练习 · ${allItems.length} 道`
        : `开始收藏练习 · ${allItems.length} 道`,
      footerHint: isWrongType
        ? '错题会自动进入复习；连续两次答对会自动移出'
        : '做错的题会自动进入错题本',
      emptyText: this.getEmptyText(isWrongType, allItems.length)
    })
  }

  /**
   * 错题条目：只取「待复习」的（攻克的不算错题，和设计稿的 26 道口径一致）。
   * 存储里没有逐条收藏时间，所以「最近更新」用 wrongBook 记录的 updatedAt。
   */
  buildWrongItems(sources) {
    const pendingIds = getPendingIds(sources.wrongBook)

    if (!pendingIds.length) {
      return []
    }

    return this.repository.findQuestionEntries(pendingIds).map((entry) => {
      const record = sources.wrongBook[entry.id] || {}
      const updatedAt = Number(record.updatedAt) || 0

      return {
        id: entry.id,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        title: `${entry.subjectName} · ${entry.bankName}`,
        stem: entry.question.stem,
        typeText: entry.question.typeText,
        wrongCount: Number(record.wrongCount) || 0,
        rightCount: Number(record.rightCount) || 0,
        streak: Number(record.streak) || 0,
        updatedAt,
        dateText: formatMonthDay(updatedAt),
        badgeText: `错 ${Number(record.wrongCount) || 0} 次`,
        badgeTone: 'wrong'
      }
    })
  }

  /** 收藏条目：收藏夹只存 id（后收藏的在前），练习状态拿进度表反查 */
  buildFavoriteItems(sources) {
    if (!sources.favoriteIds.length) {
      return []
    }

    return this.repository.findQuestionEntries(sources.favoriteIds).map((entry) => {
      const practiced = !!sources.answeredIds[entry.id]

      return {
        id: entry.id,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        title: `${entry.subjectName} · ${entry.bankName}`,
        stem: entry.question.stem,
        typeText: entry.question.typeText,
        practiced,
        wrongCount: 0,
        dateText: '',
        badgeText: practiced ? '已练习' : '待练习',
        badgeTone: practiced ? 'done' : 'todo'
      }
    })
  }

  // ---------- 统计 ----------

  buildWrongStats(items) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = items.filter((item) => item.updatedAt >= since).length

    return [
      { key: 'total', label: '错题总数', value: `${items.length}`, unit: '道' },
      { key: 'accuracy', label: '正确率', value: `${this.readBookAccuracy(items)}`, unit: '%' },
      { key: 'recent', label: '近 7 天更新', value: `${recent}`, unit: '道' }
    ]
  }

  buildFavoriteStats(items) {
    const practiced = items.filter((item) => item.practiced).length

    return [
      { key: 'total', label: '收藏题', value: `${items.length}`, unit: '道' },
      { key: 'practiced', label: '已练习', value: `${practiced}`, unit: '道' },
      { key: 'pending', label: '待练习', value: `${items.length - practiced}`, unit: '道' }
    ]
  }

  buildFavoriteDoneRate(items) {
    if (!items.length) {
      return 0
    }

    return Math.round((items.filter((item) => item.practiced).length / items.length) * 100)
  }

  /** 科目分布：按数量降序，前 4 个上色，其余并进「其它」 */
  buildDist(items) {
    const buckets = {}
    const order = []

    items.forEach((item) => {
      const name = item.subjectName || '未分类'

      if (!buckets[name]) {
        buckets[name] = 0
        order.push(name)
      }

      buckets[name] += 1
    })

    const sorted = order
      .map((name) => ({ name, count: buckets[name] }))
      .sort((left, right) => right.count - left.count)

    if (!sorted.length) {
      return []
    }

    const total = sorted.reduce((sum, item) => sum + item.count, 0)
    const head = sorted.slice(0, 4)
    const rest = sorted.slice(4)
    const merged = rest.length
      ? head.concat([{ name: '其它', count: rest.reduce((sum, item) => sum + item.count, 0) }])
      : head

    return merged.map((item, index) => ({
      name: item.name,
      count: item.count,
      percent: total ? Math.max(Math.round((item.count / total) * 100), 4) : 0,
      tone: DIST_TONES[index % DIST_TONES.length]
    }))
  }

  // ---------- 筛选 ----------

  buildChips(isWrong, items) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const source = CHIPS[isWrong ? 'wrong' : 'favorite']
    const counters = {
      all: items.length,
      repeat: items.filter((item) => item.wrongCount >= REPEAT_THRESHOLD).length,
      recent: items.filter((item) => item.updatedAt >= since).length,
      pending: items.filter((item) => !item.practiced).length,
      practiced: items.filter((item) => item.practiced).length
    }

    return source.map((chip) => ({
      key: chip.key,
      text: `${chip.text} ${counters[chip.key] || 0}`
    }))
  }

  buildSubjectOptions(isWrong, items) {
    const seen = {}
    const options = [{ id: 'all', name: '全部科目' }]

    items.forEach((item) => {
      if (item.subjectId && !seen[item.subjectId]) {
        seen[item.subjectId] = true
        options.push({ id: item.subjectId, name: item.subjectName })
      }
    })

    return options
  }

  getSubjectFilterText(options) {
    const matched = options.find((option) => option.id === this.state.subjectFilter)

    return matched ? matched.name : '全部科目'
  }

  getSortText() {
    const list = SORT_OPTIONS[this.state.type] || SORT_OPTIONS.wrong
    const matched = list.find((option) => option.key === this.state.sort)

    return matched ? matched.text : list[0].text
  }

  applyFilters(items, isWrong) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    let result = items

    if (this.state.subjectFilter !== 'all') {
      result = result.filter((item) => item.subjectId === this.state.subjectFilter)
    }

    if (this.state.activeChip === 'repeat') {
      result = result.filter((item) => item.wrongCount >= REPEAT_THRESHOLD)
    } else if (this.state.activeChip === 'recent') {
      result = result.filter((item) => item.updatedAt >= since)
    } else if (this.state.activeChip === 'pending') {
      result = result.filter((item) => !item.practiced)
    } else if (this.state.activeChip === 'practiced') {
      result = result.filter((item) => item.practiced)
    }

    if (isWrong) {
      if (this.state.sort === 'urgent') {
        return result.slice().sort((left, right) =>
          (right.wrongCount - left.wrongCount) || (right.updatedAt - left.updatedAt))
      }

      return result.slice().sort((left, right) => right.updatedAt - left.updatedAt)
    }

    // 收藏夹本身就是「后收藏的在前」，最早收藏就是原序倒过来
    return this.state.sort === 'old' ? result.slice().reverse() : result
  }

  getEmptyText(isWrong, total) {
    if (!total) {
      return isWrong ? EMPTY_TEXT.wrong : EMPTY_TEXT.favorite
    }

    return '当前筛选下没有题目，换个条件试试'
  }

  // ---------- 交互 ----------

  setChip(key) {
    const keys = (CHIPS[this.state.type] || []).map((chip) => chip.key)

    if (keys.indexOf(key) === -1 || key === this.state.activeChip) {
      return null
    }

    this.state.activeChip = key

    return this.refresh({ page: 1 })
  }

  toggleSort() {
    const list = SORT_OPTIONS[this.state.type] || SORT_OPTIONS.wrong
    const index = Math.max(list.findIndex((option) => option.key === this.state.sort), 0)
    const next = list[(index + 1) % list.length]

    return this.refresh({ sort: next.key, page: 1 })
  }

  toggleSubjectMenu() {
    return this.refresh({ subjectMenuOpen: !this.state.subjectMenuOpen })
  }

  setSubject(subjectId) {
    const nextSubject = subjectId || 'all'

    return this.refresh({
      subjectFilter: nextSubject,
      subjectMenuOpen: false,
      page: 1
    })
  }

  setPage(page) {
    const pageCount = this.buildViewData().pageCount
    const target = Math.min(Math.max(Number(page) || 1, 1), pageCount)

    if (target === this.state.page) {
      return null
    }

    return this.refresh({ page: target })
  }

  goPrevPage() {
    return this.setPage((this.state.page || 1) - 1)
  }

  goNextPage() {
    return this.setPage((this.state.page || 1) + 1)
  }

  toggleManage() {
    return this.refresh({ manage: !this.state.manage })
  }

  // ---------- 写操作 ----------

  removeItem(questionId) {
    if (!questionId) {
      return null
    }

    if (this.state.type === TYPE_WRONG) {
      this.repository.removeWrongQuestions(this.storage, [questionId])
    } else {
      this.repository.removeQuestionFavorites(this.storage, [questionId])
    }

    return this.withToast(this.state.type === TYPE_WRONG ? '已移出错题本' : '已取消收藏')
  }

  clearAll() {
    const count = this.buildViewData().totalCount

    if (!count) {
      return null
    }

    if (this.state.type === TYPE_WRONG) {
      this.repository.removeWrongQuestions(this.storage, getPendingIds(this.readSources().wrongBook))
    } else {
      this.repository.clearFavorites(this.storage)
    }

    return this.withToast(this.state.type === TYPE_WRONG ? `已移除 ${count} 道错题` : '已清空收藏')
  }

  withToast(title) {
    const result = this.refresh({})

    result.command = { type: 'toast', title }

    return result
  }

  /**
   * 把**当前筛选后的全部题目**组成练习卷（不是当前页）。
   * 走答题页的 scope=custom 入口，和「重练错题」是同一条路径。
   */
  createPracticeCommand() {
    const isWrong = this.state.type === TYPE_WRONG
    const items = this.applyFilters(
      isWrong ? this.buildWrongItems(this.readSources()) : this.buildFavoriteItems(this.readSources()),
      isWrong
    )
    const ids = items.map((item) => item.id)

    if (!ids.length) {
      return {
        command: {
          type: 'toast',
          title: '当前没有可练习的题目'
        }
      }
    }

    this.repository.saveCustomQuiz(this.storage, ids, isWrong ? '错题重练' : '收藏练习')

    return {
      command: {
        type: 'navigate',
        url: `/page/practice/index?scope=custom&mode=practice&seed=${Date.now()}`
      }
    }
  }
}

module.exports = {
  PAGE_SIZE,
  REPEAT_THRESHOLD,
  TYPE_FAVORITE,
  TYPE_WRONG,
  WrongBookViewModel,
  // 兼容旧引用
  TAB_FAVORITE: TYPE_FAVORITE,
  TAB_WRONG: TYPE_WRONG
}
