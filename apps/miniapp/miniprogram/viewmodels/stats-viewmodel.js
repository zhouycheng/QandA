const practiceRepository = require('../repositories/practice-repository.js')
const { summarizeOverallProgress } = require('../utils/practice-progress.js')
const { getPendingIds, getMasteredIds } = require('../utils/wrong-book.js')
const { countFavorites } = require('../utils/favorites.js')
const { formatStudyDuration } = require('../utils/study-time.js')
const { getRecentDays, formatDateKey, shiftDays } = require('../utils/daily-log.js')
const { describeAuth } = require('../utils/auth-session.js')
const { buildAreaTrendSvg, buildHeatmapSvg, toDataUri, COLORS } = require('../utils/chart-svg.js')

/**
 * 复盘页（设计稿 Figma「统计」画板；tab 文案叫「复盘」）。
 *
 * 历史包袱：文件与类名还叫 stats / StatsViewModel，因为路由 `page/stats/index`
 * 是 tabBar 的注册项，改名要同步 app.json、深链和 4 个自检文件，收益为零。
 * 但这一页的内容已经换了：不再是一张「成绩总表」（环形进度 + 六维雷达 + 科目进度 +
 * 历史最佳），而是回答「这段时间我练得怎么样」—— 区间切换 + 三个数字 + 活跃度 + 趋势。
 */

const HEATMAP_DAYS = 182 // 26 周，正好是设计稿说的「近半年」
const HEATMAP_WEEKS = HEATMAP_DAYS / 7

/** 答题量 → 热力档位。固定阈值而不是按最大值归一：同样的量永远同一个颜色 */
const HEAT_LEVELS = [0, 1, 5, 10, 20]

const RANGE_OPTIONS = [
  { value: '7d', label: '近 7 天', days: 7 },
  { value: '30d', label: '近 30 天', days: 30 },
  { value: 'all', label: '累计', days: 0 }
]

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

/** 复盘页顶部的两张入口卡（点进去是错题本 / 收藏本两个独立页面） */
function getInitialEntries() {
  return {
    wrong: {
      key: 'wrong',
      title: '错题本',
      value: '0',
      unit: '道',
      caption: '',
      url: '/page/wrong-book/index?type=wrong'
    },
    favorite: {
      key: 'favorite',
      title: '收藏本',
      value: '0',
      unit: '道',
      caption: '',
      url: '/page/wrong-book/index?type=favorite'
    }
  }
}

/**
 * 所有做过题的 id 集合（跨 scope 合并）。
 * 收藏本要判断「这道收藏题练过没有」，进度表是按 scope 分组的，先摊平再查。
 */
function collectAnsweredIds(progress) {
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

function getInitialStatsViewData() {
  return {
    identity: {
      subtitle: '学习记录只存本机'
    },
    entries: getInitialEntries(),
    // 区间切换：7d / 30d / all
    range: '7d',
    rangeOptions: RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    rangeIndex: 0,
    metrics: {
      answered: '0',
      accuracy: '0',
      duration: '0'
    },
    // 学习活动热力图（始终是近半年，不随区间变）
    activity: {
      dataUri: '',
      hasData: false,
      legend: ['lv-0', 'lv-1', 'lv-2', 'lv-3', 'lv-4']
    },
    trend: {
      dataUri: '',
      hasData: false,
      caption: '答题量'
    },
    // 汇总口径：给别的页面（如首页摘要）与自检复用，本页不用它渲染
    overall: null,
    wrongCount: 0,
    masteredCount: 0,
    favoriteCount: 0,
    studyTimeText: '尚未开始',
    studyMinutes: 0
  }
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function heatLevel(answered) {
  const count = Number(answered) || 0
  let level = 0

  HEAT_LEVELS.forEach((threshold, index) => {
    if (count >= threshold) {
      level = index
    }
  })

  return level
}

class StatsViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
    this.range = '7d'
    // load() 的缓存：切区间时不必重新扫一遍存储
    this.cache = null
  }

  static getInitialData() {
    return getInitialStatsViewData()
  }

  load() {
    const progress = this.repository.getProgress(this.storage)
    const details = this.repository.getSubjectSummaries()
      .map((subject) => this.repository.getSubjectDetail(subject.id))
      .filter(Boolean)
    const wrongBook = this.repository.getWrongBook(this.storage)
    const studyTime = this.repository.getStudyTime
      ? this.repository.getStudyTime(this.storage)
      : { totalSeconds: 0, sessionCount: 0 }
    const overall = summarizeOverallProgress(progress, details)
    const days = this.getRecentPoints()

    this.cache = { overall, days, studySeconds: Number(studyTime.totalSeconds) || 0 }

    const favorites = this.repository.getFavorites(this.storage)

    return {
      data: Object.assign(getInitialStatsViewData(), {
        identity: this.buildIdentity(),
        overall,
        wrongCount: getPendingIds(wrongBook).length,
        masteredCount: getMasteredIds(wrongBook).length,
        favoriteCount: countFavorites(favorites),
        entries: this.buildEntries(wrongBook, favorites, progress),
        studyTimeText: formatStudyDuration(studyTime.totalSeconds),
        activity: this.buildActivity(days)
      }, this.buildRangeView())
    }
  }

  /**
   * 两张入口卡的数字与摘要。
   *
   * 摘要只写**算得出来**的东西：
   * - 错题本的记录只有「最后变动时间」，所以是「近 7 天更新 N 道」而不是「新增」——
   *   答对一次也会刷新 updatedAt，写成「新增」会虚报；
   * - 收藏夹只存 id 列表（没有逐条时间），所以给「待练习 N 道」：拿收藏 id 去进度表里查。
   */
  buildEntries(wrongBook, favorites, progress) {
    const entries = getInitialEntries()
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const pendingIds = getPendingIds(wrongBook)
    const recentCount = pendingIds.filter((questionId) => {
      const record = wrongBook[questionId]

      return !!record && record.updatedAt >= since
    }).length
    const favoriteIds = this.repository.getFavoriteIds
      ? this.repository.getFavoriteIds(favorites)
      : (favorites && favorites.ids ? favorites.ids : [])
    const answeredIds = collectAnsweredIds(progress)
    const pendingPractice = favoriteIds.filter((questionId) => !answeredIds[questionId]).length

    entries.wrong.value = `${pendingIds.length}`
    entries.wrong.caption = pendingIds.length
      ? (recentCount ? `近 7 天更新 ${recentCount} 道` : '近 7 天没有变动')
      : '还没有错题'
    entries.favorite.value = `${favoriteIds.length}`
    entries.favorite.caption = favoriteIds.length
      ? (pendingPractice ? `待练习 ${pendingPractice} 道` : '收藏的题都练过了')
      : '还没有收藏'

    return entries
  }

  /** 切换区间：只重算三个数字与趋势图，热力图与身份不重算 */
  setRange(value) {
    const matched = RANGE_OPTIONS.find((option) => option.value === value)

    if (!matched || matched.value === this.range) {
      return null
    }

    if (!this.cache) {
      return { data: this.load().data }
    }

    this.range = matched.value

    return { data: this.buildRangeView() }
  }

  /** 当前区间的指标 + 趋势，load 与 setRange 共用 */
  buildRangeView() {
    const option = RANGE_OPTIONS.find((item) => item.value === this.range) || RANGE_OPTIONS[0]
    const cache = this.cache || { overall: null, days: [], studySeconds: 0 }
    const trend = this.buildTrend(option)

    return {
      range: option.value,
      rangeIndex: RANGE_OPTIONS.indexOf(option),
      metrics: this.buildMetrics(option, cache),
      trend: {
        dataUri: trend.hasData ? toDataUri(trend.svg) : '',
        hasData: trend.hasData,
        caption: '答题量'
      }
    }
  }

  /**
   * 三个数字。
   * 近 7 天 / 近 30 天从每日日志里加总；累计直接用做题进度的全量与总时长，
   * 因为日志只留半年，拿它算「累计」会漏掉更早的记录。
   */
  buildMetrics(option, cache) {
    if (option.days > 0) {
      const window = cache.days.slice(-option.days)
      const answered = window.reduce((sum, day) => sum + day.answered, 0)
      const correct = window.reduce((sum, day) => sum + day.correct, 0)
      const seconds = window.reduce((sum, day) => sum + day.seconds, 0)

      return {
        answered: `${answered}`,
        accuracy: `${answered ? Math.round((correct / answered) * 100) : 0}`,
        duration: `${Math.floor(seconds / 60)}`
      }
    }

    const overall = cache.overall || { answered: 0, accuracy: 0 }

    return {
      answered: `${overall.answered || 0}`,
      accuracy: `${overall.accuracy || 0}`,
      duration: `${Math.floor((Number(cache.studySeconds) || 0) / 60)}`
    }
  }

  /** 近半年的逐日记录（含今天），热力图与趋势都从这里取 */
  getRecentPoints() {
    if (!this.repository.getDailyLog) {
      return getRecentDays({}, HEATMAP_DAYS)
    }

    return getRecentDays(this.repository.getDailyLog(this.storage), HEATMAP_DAYS)
  }

  /**
   * 身份副标题：学院 · 昵称。
   * 未登录时不给空字符串 —— 设计稿那一行是页面标题的延伸，空着像渲染失败。
   */
  buildIdentity() {
    try {
      const view = describeAuth(this.repository.getAuth(this.storage))

      if (!view.loggedIn) {
        return { subtitle: '登录后可跨设备同步学习记录' }
      }

      const name = view.displayName || view.accountTag || ''

      return {
        subtitle: view.college ? `${view.college} · ${name}` : name
      }
    } catch (error) {
      return { subtitle: '学习记录只存本机' }
    }
  }

  /**
   * 热力图：26 列 × 7 行，列 = 周（周一起），最后一列是本周且允许留空。
   * 月份标签只在「这一列的周一换月」时打一个，跟设计稿的 5月 / 6月 … 一致。
   *
   * ⚠️ daily-log 的 shiftDays / formatDateKey 只吃**时间戳数字**，
   * 传 '2026-10-27T00:00:00' 这种字符串会被 Number() 变成 NaN 并静默回退到 today，
   * 整张热力图就永远画成「最近 26 周都从今天开始」。所以这里先把日期键拆成年月日。
   */
  buildActivity(days) {
    const total = days.length

    if (!total) {
      return { dataUri: '', hasData: false, legend: getInitialStatsViewData().activity.legend }
    }

    const lastDay = days[total - 1]
    const [lastYear, lastMonth, lastDate] = lastDay.key.split('-').map(Number)
    const lastTs = new Date(lastYear, lastMonth - 1, lastDate).getTime()
    const weekday = (new Date(lastTs).getDay() + 6) % 7 // 0 = 周一
    const byKey = days.reduce((map, day) => {
      map[day.key] = day

      return map
    }, {})
    // 最后一列是本周：从本周一往回排 26 周
    const lastColumnMonday = shiftDays(lastTs, -weekday)

    const columns = []
    const months = []
    let lastSeenMonth = -1

    for (let col = 0; col < HEATMAP_WEEKS; col += 1) {
      const mondayTs = shiftDays(lastColumnMonday, -(HEATMAP_WEEKS - 1 - col) * 7)
      const monday = new Date(mondayTs)
      const column = []

      for (let row = 0; row < 7; row += 1) {
        const dateKey = formatDateKey(shiftDays(mondayTs, row))
        const entry = byKey[dateKey]

        // 未来的日子（本周还没到的几天）画成空白，不能画成「0 题」
        column.push(entry ? { level: heatLevel(entry.answered), key: dateKey, answered: entry.answered } : null)
      }

      columns.push(column)

      if (monday.getMonth() !== lastSeenMonth) {
        lastSeenMonth = monday.getMonth()
        months.push({ col, text: `${monday.getMonth() + 1}月` })
      }
    }

    // 第一列的月份可能只剩几天，标签会贴在左边缘；留出 2 列余量就不打
    const trimmed = months.filter((month, index) => index > 0 || month.col <= 2)
    const svg = buildHeatmapSvg({ columns, months: trimmed })

    return {
      dataUri: svg ? toDataUri(svg) : '',
      hasData: days.some((day) => day.answered > 0),
      legend: getInitialStatsViewData().activity.legend
    }
  }

  /**
   * 趋势曲线。
   * 7 天 / 30 天按日；累计按月（日志只留半年，按月聚合才不会把「累计」画成半年）。
   * 标签只打 3~5 个，打多了在 375px 宽的手机上会糊成一片。
   */
  buildTrend(option) {
    if (option.value === 'all') {
      return this.buildMonthlyTrend()
    }

    const window = (this.cache ? this.cache.days : []).slice(-option.days)
    const labelStep = option.days <= 7 ? 3 : 7
    const points = window.map((day, index) => ({
      value: day.answered,
      // 首尾必标，中间按步长标
      label: index === 0 || index === window.length - 1 || index % labelStep === 0 ? day.monthDayText : ''
    }))

    return this.renderTrend(points)
  }

  buildMonthlyTrend() {
    const days = this.cache ? this.cache.days : []
    const buckets = []
    const byMonth = {}

    days.forEach((day) => {
      const monthKey = day.key.slice(0, 7)

      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { monthKey, value: 0, month: Number(day.key.slice(5, 7)) }
        buckets.push(byMonth[monthKey])
      }

      byMonth[monthKey].value += day.answered
    })

    // 只画最近 6 个月，和热力图的视窗对齐
    return this.renderTrend(buckets.slice(-6).map((bucket) => ({
      value: bucket.value,
      label: `${bucket.month}月`
    })))
  }

  renderTrend(points) {
    const hasData = points.some((point) => point.value > 0)

    if (!hasData) {
      return { svg: '', hasData: false }
    }

    return { svg: buildAreaTrendSvg(points, { width: 640, height: 240 }), hasData: true }
  }
}

module.exports = {
  HEAT_LEVELS,
  RANGE_OPTIONS,
  StatsViewModel,
  // 供自检直接验证颜色档位与区间定义
  COLORS
}
