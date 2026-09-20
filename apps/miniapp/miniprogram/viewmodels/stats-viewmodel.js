const practiceRepository = require('../repositories/practice-repository.js')
const {
  summarizeOverallProgress,
  summarizeSubjectProgress
} = require('../utils/practice-progress.js')
const { getPendingIds, getMasteredIds } = require('../utils/wrong-book.js')
const { countFavorites } = require('../utils/favorites.js')
const { formatStudyDuration } = require('../utils/study-time.js')
const {
  buildRadarAxes,
  buildTrendSeries,
  calcRadarScore
} = require('../utils/study-insight.js')
const { buildRadarSvg, buildRingSvg, buildTrendSvg, toDataUri } = require('../utils/chart-svg.js')

const BEST_SCORE_PREFIX = 'qandaBestScore:'
const TREND_DAYS = 7

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

function getInitialStatsViewData() {
  return {
    catalog: {
      subjectCount: 0,
      bankCount: 0,
      questionCount: 0
    },
    overall: null,
    // 总览卡：环形进度 + 一句状态标题
    hero: {
      ringDataUri: '',
      headline: '今天开始第一次练习'
    },
    // 雷达图：六维归一化后的数值 + 画好的 SVG（base64 data URI）
    radar: {
      axes: [],
      score: 0,
      hasData: false,
      strongest: null,
      weakest: null,
      dataUri: ''
    },
    // 趋势图：近 7 天逐日答题数
    trend: {
      points: [],
      maxValue: 0,
      peak: 0,
      hasData: false,
      dataUri: ''
    },
    daily: {
      answered: 0,
      correct: 0,
      accuracyText: '0%',
      activeDays: 0,
      streak: 0,
      peakDayText: '',
      hasData: false
    },
    subjectStats: [],
    wrongCount: 0,
    masteredCount: 0,
    favoriteCount: 0,
    studyTimeText: '尚未开始',
    studySessionCount: 0,
    studyMinutes: 0,
    records: []
  }
}

/**
 * 统计页：只读汇总，不产生任何写副作用。
 * 数据来自四个来源：做题进度、错题本、收藏、每日学习日志（含时长）。
 */
class StatsViewModel {
  constructor(options) {
    const normalizedOptions = options || {}
    this.repository = normalizedOptions.repository || practiceRepository
    this.storage = normalizedOptions.storage || createNullStorage()
  }

  static getInitialData() {
    return getInitialStatsViewData()
  }

  load() {
    const progress = this.repository.getProgress(this.storage)
    // 汇总进度需要科目下的题库列表，因此取完整科目对象而非摘要
    const details = this.repository.getSubjectSummaries()
      .map((subject) => this.repository.getSubjectDetail(subject.id))
      .filter(Boolean)
    const wrongBook = this.repository.getWrongBook(this.storage)
    const studyTime = this.repository.getStudyTime
      ? this.repository.getStudyTime(this.storage)
      : { totalSeconds: 0, sessionCount: 0 }
    const daily = this.getDailySummary()
    const overall = summarizeOverallProgress(progress, details)
    const pendingWrongCount = getPendingIds(wrongBook).length
    const masteredCount = getMasteredIds(wrongBook).length
    const studyMinutes = Math.floor((Number(studyTime.totalSeconds) || 0) / 60)

    return {
      data: {
        catalog: this.repository.getCatalogStats(),
        overall,
        hero: this.buildHero(overall, daily),
        radar: this.buildRadar({
          progressPercent: overall.progressPercent,
          accuracy: overall.accuracy,
          masteredCount,
          pendingWrongCount,
          recentAnswered: daily.recent.answered,
          recentActiveDays: daily.activeDays,
          studyMinutes
        }),
        trend: this.buildTrend(daily.days),
        daily: {
          answered: daily.recent.answered,
          correct: daily.recent.correct,
          accuracyText: daily.recent.accuracyText,
          activeDays: daily.activeDays,
          streak: daily.streak,
          peakDayText: daily.recent.peakDayText,
          hasData: daily.recent.hasData
        },
        subjectStats: details.map((detail) => this.buildSubjectStat(progress, detail)),
        wrongCount: pendingWrongCount,
        masteredCount,
        favoriteCount: countFavorites(this.repository.getFavorites(this.storage)),
        studyTimeText: formatStudyDuration(studyTime.totalSeconds),
        studySessionCount: studyTime.sessionCount,
        studyMinutes,
        records: this.collectRecords()
      }
    }
  }

  /**
   * 每日日志：仓储提供不了时退化为空序列，
   * 保证统计页在「刚装上、还没交过卷」的情况下也能正常渲染。
   */
  getDailySummary() {
    if (this.repository.getDailySummary) {
      return this.repository.getDailySummary(this.storage, TREND_DAYS)
    }

    return {
      log: {},
      days: [],
      recent: { answered: 0, correct: 0, accuracyText: '0%', hasData: false, peakDayText: '' },
      activeDays: 0,
      streak: 0
    }
  }

  /**
   * 总览卡：环形进度画的是「完成度」，标题按连续天数给一句状态。
   * 深色卡上要给足对比度，所以环用浅色描边而不是品牌蓝。
   */
  buildHero(overall, daily) {
    const svg = buildRingSvg({
      percent: overall.progressPercent,
      size: 240,
      stroke: 22,
      color: '#7fd7ff',
      gradientTo: '#ffffff',
      trackColor: 'rgba(255, 255, 255, 0.22)',
      labelColor: '#ffffff',
      caption: '完成度',
      captionColor: 'rgba(255, 255, 255, 0.72)'
    })

    return {
      ringDataUri: toDataUri(svg),
      headline: daily.streak > 0
        ? `连续学习 ${daily.streak} 天`
        : (overall.answered > 0 ? '保持节奏，别断档' : '今天开始第一次练习')
    }
  }

  buildRadar(summary) {
    const axes = buildRadarAxes(summary)
    const hasData = axes.some((axis) => axis.value > 0)
    const svg = hasData ? buildRadarSvg(axes) : ''
    const sorted = axes.slice().sort((left, right) => right.value - left.value)

    return {
      axes,
      score: calcRadarScore(axes),
      hasData,
      // 直接点出长短项，比让用户自己看多边形更省事
      strongest: sorted.length ? sorted[0] : null,
      weakest: sorted.length ? sorted[sorted.length - 1] : null,
      // 六维全为 0 时多边形会退化成中心一个点，看着像渲染失败，因此不给图
      dataUri: svg ? toDataUri(svg) : ''
    }
  }

  buildTrend(days) {
    const series = buildTrendSeries(days)
    const svg = series.points.length >= 2 ? buildTrendSvg(series) : ''

    return {
      points: series.points,
      maxValue: series.maxValue,
      peak: series.peak,
      hasData: series.hasData,
      dataUri: svg ? toDataUri(svg) : ''
    }
  }

  buildSubjectStat(progress, detail) {
    const stats = summarizeSubjectProgress(progress, detail)

    return {
      id: detail.id,
      name: detail.name,
      shortName: detail.shortName || detail.name,
      theme: detail.theme,
      questionCount: detail.questionCount,
      answered: stats.answered,
      answeredText: stats.answeredText,
      accuracy: stats.accuracy,
      accuracyText: stats.accuracyText,
      accuracyLevel: this.getAccuracyLevel(stats.accuracy, stats.answered),
      progressPercent: stats.progressPercent,
      hasProgress: stats.hasProgress
    }
  }

  /** 正确率分级，用于给数字上色：有数据才评级，没做过不评判 */
  getAccuracyLevel(accuracy, answered) {
    if (!answered) {
      return 'none'
    }

    if (accuracy >= 80) {
      return 'good'
    }

    return accuracy >= 60 ? 'mid' : 'low'
  }

  /**
   * 历史最佳：按「题库 + 模式 + 时长」分别缓存在 qandaBestScore: 前缀下。
   */
  collectRecords() {
    const keys = this.storage.keys ? this.storage.keys() : []

    return keys
      .filter((key) => key.indexOf(BEST_SCORE_PREFIX) === 0)
      .map((key) => {
        const meta = this.repository.getBankMetaByStorageKey(key.slice(BEST_SCORE_PREFIX.length))
        const score = Number(this.storage.get(key)) || 0

        return {
          key,
          title: meta ? meta.title : key.slice(BEST_SCORE_PREFIX.length),
          score,
          level: this.getAccuracyLevel(score, 1)
        }
      })
      .sort((left, right) => right.score - left.score)
  }
}

module.exports = {
  StatsViewModel
}
