/**
 * 统计口径：把分散的原始数据折算成「雷达图维度」和「趋势序列」。
 * 纯计算模块，不依赖微信 API，也不产生任何绘制动作 —— 绘制在 chart-svg.js。
 *
 * 雷达图六维全部归一化到 0-100，才有资格画在同一张图上。
 * 归一化的分母（目标值）集中写在 RADAR_TARGETS 里，便于日后调整：
 * 这些是「达到即可认为该维度满分」的量，不是硬性指标。
 */

const RADAR_TARGETS = {
  // 近 7 天累计答题数目标：按每天 20 题算
  recentAnswered: 140,
  // 累计学习时长目标：10 小时
  studyMinutes: 600,
  // 坚持度目标：近 7 天全部有练习
  activeDays: 7
}

/**
 * 六个维度的定义。
 * 每一项的 normalize 接收原始 summary，返回 0-1 的达成度。
 */
const RADAR_DIMENSIONS = [
  {
    key: 'progress',
    label: '完成度',
    hint: '已做题目 / 题库总题量',
    normalize(summary) {
      return summary.progressPercent / 100
    },
    valueText(summary) {
      return `${summary.progressPercent}%`
    }
  },
  {
    key: 'accuracy',
    label: '正确率',
    hint: '答对题目 / 已做题目',
    normalize(summary) {
      return summary.accuracy / 100
    },
    valueText(summary) {
      return `${summary.accuracy}%`
    }
  },
  {
    key: 'wrongMastered',
    label: '错题攻克',
    hint: '已攻克 / 错题本收录总量',
    normalize(summary) {
      const total = summary.masteredCount + summary.pendingWrongCount

      return total ? summary.masteredCount / total : 0
    },
    valueText(summary) {
      const total = summary.masteredCount + summary.pendingWrongCount

      return total ? `${summary.masteredCount}/${total}` : '—'
    }
  },
  {
    key: 'volume',
    label: '刷题量',
    hint: `近 7 天答题数 / ${RADAR_TARGETS.recentAnswered} 题`,
    normalize(summary) {
      return summary.recentAnswered / RADAR_TARGETS.recentAnswered
    },
    valueText(summary) {
      return `${summary.recentAnswered} 题`
    }
  },
  {
    key: 'persistence',
    label: '坚持度',
    hint: `近 7 天有练习的天数 / ${RADAR_TARGETS.activeDays} 天`,
    normalize(summary) {
      return summary.recentActiveDays / RADAR_TARGETS.activeDays
    },
    valueText(summary) {
      return `${summary.recentActiveDays} 天`
    }
  },
  {
    key: 'duration',
    label: '学习时长',
    hint: `累计分钟数 / ${RADAR_TARGETS.studyMinutes} 分钟`,
    normalize(summary) {
      return summary.studyMinutes / RADAR_TARGETS.studyMinutes
    },
    valueText(summary) {
      return summary.studyMinutes >= 60
        ? `${Math.round(summary.studyMinutes / 6) / 10} 时`
        : `${summary.studyMinutes} 分`
    }
  }
]

function clamp01(value) {
  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    return 0
  }

  return number > 1 ? 1 : number
}

/**
 * 构造雷达图数据。
 * @param {object} summary 原始汇总，字段缺失按 0 处理
 */
function buildRadarAxes(summary) {
  const safe = Object.assign({
    progressPercent: 0,
    accuracy: 0,
    masteredCount: 0,
    pendingWrongCount: 0,
    recentAnswered: 0,
    recentActiveDays: 0,
    studyMinutes: 0
  }, summary || {})

  return RADAR_DIMENSIONS.map((dimension) => {
    const ratio = clamp01(dimension.normalize(safe))

    return {
      key: dimension.key,
      label: dimension.label,
      hint: dimension.hint,
      value: Math.round(ratio * 100),
      valueText: dimension.valueText(safe)
    }
  })
}

/**
 * 雷达图整体达成度，用于卡片右侧的总评分。
 * 取六维均值：任何一维为 0 都会被平均进来，是有意为之 ——
 * 只猛练一个维度不该拿到高分。
 */
function calcRadarScore(axes) {
  if (!axes || !axes.length) {
    return 0
  }

  const total = axes.reduce((sum, axis) => sum + (Number(axis.value) || 0), 0)

  return Math.round(total / axes.length)
}

/**
 * 折线图数据：补上统一的纵轴上限，避免每天在个小位数里上下乱跳。
 * @param {Array} days getRecentDays 的输出
 */
function buildTrendSeries(days) {
  const points = (days || []).map((day) => ({
    key: day.key,
    label: day.monthDayText,
    dayText: day.dayText,
    weekdayText: day.weekdayText,
    isToday: !!day.isToday,
    answered: Math.max(Number(day.answered) || 0, 0),
    correct: Math.max(Number(day.correct) || 0, 0)
  }))

  const peak = points.reduce((max, point) => Math.max(max, point.answered), 0)
  // 纵轴至少留到 5，否则一串 0 会被画成贴着顶端的直线，看着像有数据
  const maxValue = Math.max(peak, 5)

  return {
    points,
    maxValue,
    peak,
    hasData: points.some((point) => point.answered > 0)
  }
}

module.exports = {
  RADAR_DIMENSIONS,
  RADAR_TARGETS,
  buildRadarAxes,
  buildTrendSeries,
  calcRadarScore,
  clamp01
}
