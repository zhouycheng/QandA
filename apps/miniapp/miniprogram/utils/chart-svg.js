/**
 * 图表绘制：把数据折算成 SVG 字符串，再转成 base64 data URI 交给 WXSS 渲染。
 *
 * 为什么不引图表库：小程序运行时是零依赖、零构建的，
 * 而且图表画在 canvas 上时需要 `createSelectorQuery` 拿节点、处理 DPR、监听重绘，
 * 页面一多很容易出错。这里沿用项目已有的做法 ——
 * 内联 SVG 当背景图渲染，尺寸固定、无副作用，纯字符串函数还能在 Node 里直接断言。
 *
 * 字号说明：viewBox 宽 640（雷达 620）而实际显示宽度约 654rpx，
 * 缩放比约 1.02rpx/单位，因此 viewBox 里的 font-size 单位数 ≈ 最终 rpx 值。
 * 想让标签落在 24rpx 这一档，字号就写 24，不要按「画布像素」直觉去写 12。
 */

const { encodeBase64Utf8 } = require('./base64.js')

const COLORS = {
  brand: '#2b7ffc',
  brandSoft: 'rgba(43, 127, 252, 0.18)',
  success: '#17b26a',
  grid: '#e7ecf3',
  gridStrong: '#d7dfea',
  text: '#667085',
  textStrong: '#1f2a37',
  muted: '#98a2b3'
}

const FONT_FAMILY = 'PingFang SC, Helvetica Neue, Helvetica, Arial, sans-serif'

function round(value, digits) {
  const factor = Math.pow(10, digits === undefined ? 1 : digits)

  return Math.round((Number(value) || 0) * factor) / factor
}

function escapeXml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textNode(x, y, content, options) {
  const config = options || {}
  const anchor = config.anchor || 'middle'
  const size = config.size || 24
  const weight = config.weight || 400
  const fill = config.fill || COLORS.text

  return `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" ` +
    `font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" ` +
    `fill="${fill}">${escapeXml(content)}</text>`
}

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${encodeBase64Utf8(svg)}`
}

/**
 * 雷达图。
 * @param {Array} axes buildRadarAxes 的输出，每项含 label / value / valueText
 * @param {object} options { width, height, radius }
 */
function buildRadarSvg(axes, options) {
  const list = (axes || []).filter(Boolean)

  if (list.length < 3) {
    return ''
  }

  const config = options || {}
  const width = config.width || 620
  const height = config.height || 410
  const radius = config.radius || 118
  const centerX = width / 2
  const centerY = config.centerY || 196
  const labelRadius = radius + 34
  const count = list.length
  const step = (Math.PI * 2) / count
  const startAngle = -Math.PI / 2

  const pointAt = (ratio, index) => {
    const angle = startAngle + step * index

    return {
      angle,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      x: centerX + Math.cos(angle) * radius * ratio,
      y: centerY + Math.sin(angle) * radius * ratio
    }
  }

  const toPoints = (ratio) => list
    .map((item, index) => {
      const point = pointAt(ratio, index)

      return `${round(point.x)},${round(point.y)}`
    })
    .join(' ')

  const rings = [0.25, 0.5, 0.75, 1]
    .map((ratio) => `<polygon points="${toPoints(ratio)}" fill="none" ` +
      `stroke="${ratio === 1 ? COLORS.gridStrong : COLORS.grid}" stroke-width="1.4"/>`)
    .join('')

  const spokes = list
    .map((item, index) => {
      const point = pointAt(1, index)

      return `<line x1="${round(centerX)}" y1="${round(centerY)}" ` +
        `x2="${round(point.x)}" y2="${round(point.y)}" stroke="${COLORS.grid}" stroke-width="1.4"/>`
    })
    .join('')

  const valuePoints = list
    .map((item, index) => {
      const ratio = Math.max(Math.min((Number(item.value) || 0) / 100, 1), 0)
      const point = pointAt(ratio, index)

      return `${round(point.x)},${round(point.y)}`
    })
    .join(' ')

  const dots = list
    .map((item, index) => {
      const ratio = Math.max(Math.min((Number(item.value) || 0) / 100, 1), 0)
      const point = pointAt(ratio, index)

      return `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="4.6" ` +
        `fill="#ffffff" stroke="${COLORS.brand}" stroke-width="3"/>`
    })
    .join('')

  const labels = list
    .map((item, index) => {
      const angle = startAngle + step * index
      const x = centerX + Math.cos(angle) * labelRadius
      const y = centerY + Math.sin(angle) * labelRadius
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const anchor = cos > 0.25 ? 'start' : (cos < -0.25 ? 'end' : 'middle')
      // SVG 的 baseline 各家实现有差异，这里用偏移量替代 dominant-baseline
      const labelY = y + (sin < -0.3 ? -8 : (sin > 0.3 ? 16 : 4))
      const valueY = labelY + 28

      return textNode(x, labelY, item.label, {
        anchor,
        size: 24,
        weight: 600,
        fill: COLORS.textStrong
      }) + textNode(x, valueY, item.valueText || `${item.value}`, {
        anchor,
        size: 22,
        fill: COLORS.brand
      })
    })
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<g>${rings}${spokes}</g>` +
    `<polygon points="${valuePoints}" fill="${COLORS.brandSoft}" ` +
    `stroke="${COLORS.brand}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<g>${dots}</g>` +
    `<g>${labels}</g>` +
    '</svg>'

  return svg
}

/**
 * 近 N 天答题趋势：柱状面积表示答题数，折线表示其中答对数。
 * 两条线同一个单位（题），因此可以共用一个纵轴，不需要双 Y 轴。
 * @param {object} series buildTrendSeries 的输出
 */
function buildTrendSvg(series, options) {
  const data = series && series.points ? series : { points: [], maxValue: 5, hasData: false }
  const points = data.points

  if (points.length < 2) {
    return ''
  }

  const config = options || {}
  const width = config.width || 640
  const height = config.height || 300
  const paddingLeft = 22
  const paddingRight = 22
  const paddingTop = 30
  const baseline = height - 44
  const plotWidth = width - paddingLeft - paddingRight
  const plotHeight = baseline - paddingTop
  const step = plotWidth / points.length
  const maxValue = Math.max(Number(data.maxValue) || 5, 1)
  const barWidth = Math.min(step * 0.46, 34)

  const xAt = (index) => paddingLeft + step * (index + 0.5)
  const yAt = (value) => baseline - (Math.max(Number(value) || 0, 0) / maxValue) * plotHeight

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = baseline - plotHeight * ratio

      return `<line x1="${paddingLeft}" y1="${round(y)}" x2="${width - paddingRight}" y2="${round(y)}" ` +
        `stroke="${COLORS.grid}" stroke-width="1.2" stroke-dasharray="4 6"/>`
    })
    .join('')

  const axisText = textNode(paddingLeft, paddingTop - 12, `纵轴上限 ${round(maxValue, 0)} 题`, {
    anchor: 'start',
    size: 20,
    fill: COLORS.muted
  })

  const bars = points
    .map((point, index) => {
      const x = xAt(index) - barWidth / 2
      const y = yAt(point.answered)
      const barHeight = Math.max(baseline - y, 0)
      const isToday = point.isToday
      const fill = isToday ? COLORS.brand : '#9cc4ff'

      if (barHeight <= 0) {
        return ''
      }

      return `<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" ` +
        `height="${round(barHeight)}" rx="${round(barWidth / 2.6)}" fill="${fill}"/>`
    })
    .join('')

  const answeredLine = points
    .map((point, index) => `${round(xAt(index))},${round(yAt(point.answered))}`)
    .join(' ')

  const correctLine = points
    .map((point, index) => `${round(xAt(index))},${round(yAt(point.correct))}`)
    .join(' ')

  const answeredDots = points
    .map((point, index) => `<circle cx="${round(xAt(index))}" cy="${round(yAt(point.answered))}" ` +
      `r="3.6" fill="#ffffff" stroke="${COLORS.brand}" stroke-width="2.4"/>`)
    .join('')

  const correctDots = points
    .map((point, index) => `<circle cx="${round(xAt(index))}" cy="${round(yAt(point.correct))}" ` +
      `r="3.2" fill="#ffffff" stroke="${COLORS.success}" stroke-width="2.2"/>`)
    .join('')

  const valueLabels = points
    .map((point, index) => {
      if (!point.answered) {
        return ''
      }

      return textNode(xAt(index), yAt(point.answered) - 14, `${point.answered}`, {
        anchor: 'middle',
        size: 20,
        weight: 600,
        fill: COLORS.brand
      })
    })
    .join('')

  const axisLabels = points
    .map((point, index) => textNode(xAt(index), baseline + 28, point.label, {
      anchor: 'middle',
      size: 20,
      weight: point.isToday ? 700 : 400,
      fill: point.isToday ? COLORS.brand : COLORS.muted
    }))
    .join('')

  const emptyHint = data.hasData
    ? ''
    : textNode(width / 2, paddingTop + plotHeight / 2, '近 7 天还没有练习记录，做完一套题就会出现曲线', {
      anchor: 'middle',
      size: 24,
      fill: COLORS.muted
    })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<g>${grid}</g>${axisText}` +
    `<g>${bars}</g>` +
    `<polyline points="${answeredLine}" fill="none" stroke="${COLORS.brand}" ` +
    `stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<polyline points="${correctLine}" fill="none" stroke="${COLORS.success}" ` +
    `stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<g>${answeredDots}${correctDots}</g>` +
    `<g>${valueLabels}</g>` +
    `<g>${axisLabels}</g>` +
    `<g>${emptyHint}</g>` +
    '</svg>'

  return svg
}

/**
 * 环形进度：统计页总览卡的主视觉。
 * 用 stroke-dasharray 画弧，起点转到 12 点方向（rotate -90）。
 * @param {object} options { percent, size, stroke, color, trackColor, gradientTo }
 */
function buildRingSvg(options) {
  const config = options || {}
  const percent = Math.max(Math.min(Number(config.percent) || 0, 100), 0)
  const size = config.size || 240
  const strokeWidth = config.stroke || 22
  const radius = (size - strokeWidth) / 2
  const center = size / 2
  const circumference = round(2 * Math.PI * radius, 2)
  const dash = round((percent / 100) * circumference, 2)
  const color = config.color || COLORS.brand
  const trackColor = config.trackColor || '#e7ecf3'
  const gradientTo = config.gradientTo || ''
  const label = config.label === undefined ? `${percent}%` : config.label
  const gradientId = 'ringGradient'
  const strokeValue = gradientTo ? `url(#${gradientId})` : color

  const gradient = gradientTo
    ? `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${color}"/>` +
      `<stop offset="100%" stop-color="${gradientTo}"/></linearGradient></defs>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="${size}" height="${size}">${gradient}` +
    `<circle cx="${center}" cy="${center}" r="${round(radius, 2)}" fill="none" ` +
    `stroke="${trackColor}" stroke-width="${strokeWidth}"/>` +
    (percent > 0
      ? `<circle cx="${center}" cy="${center}" r="${round(radius, 2)}" fill="none" ` +
        `stroke="${strokeValue}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
        `stroke-dasharray="${dash} ${round(circumference - dash, 2)}" ` +
        `transform="rotate(-90 ${center} ${center})"/>`
      : '') +
    textNode(center, center + 8, label, {
      anchor: 'middle',
      size: 46,
      weight: 700,
      fill: config.labelColor || color
    }) +
    (config.caption
      ? textNode(center, center + 38, config.caption, {
        anchor: 'middle',
        size: 22,
        fill: config.captionColor || COLORS.muted
      })
      : '') +
    '</svg>'

  return svg
}

module.exports = {
  COLORS,
  buildRadarSvg,
  buildRingSvg,
  buildTrendSvg,
  escapeXml,
  round,
  toDataUri
}
