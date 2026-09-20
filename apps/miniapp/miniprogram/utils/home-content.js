/**
 * 首页文案：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 首页三段文案都由当前学习状态推导，而不是写死：
 *   1. 问候语   —— 按设备本地时间落在哪个时段
 *   2. 横幅建议 —— 按「有没有错题 / 有没有进度 / 是否全新用户」给一句具体的话
 *   3. 公告条   —— 同源规则，但额外带一个可直达的入口
 *
 * 这样首页对新用户、练了一半的人、错题堆积的人是三种不同的口径，
 * 而不是对所有人说同一句「欢迎使用」。
 */

const { getDailyQuote } = require('./daily-quotes.js')

const TIP_ACTIONS = {
  BANK: 'bank',
  STATS: 'stats',
  WRONG_BOOK: 'wrongBook'
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const PERIODS = [
  { from: 5, to: 11, text: '早上好' },
  { from: 11, to: 13, text: '中午好' },
  { from: 13, to: 18, text: '下午好' },
  { from: 18, to: 23, text: '晚上好' }
]

function toTimestamp(timestamp) {
  const time = Number(timestamp)

  return Number.isFinite(time) && time > 0 ? time : Date.now()
}

function getGreetingText(timestamp) {
  const hour = new Date(toTimestamp(timestamp)).getHours()
  const matched = PERIODS.find((period) => hour >= period.from && hour < period.to)

  // 23:00 - 05:00 都不在 PERIODS 里，落到这句
  return matched ? matched.text : '夜深了'
}

function getDateText(timestamp) {
  const date = new Date(toTimestamp(timestamp))

  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${WEEKDAYS[date.getDay()]}`
}

/**
 * 横幅副标题：给一句和当前状态对得上的建议。
 * @param {object} summary { pendingWrong, answered, accuracyText }
 */
function getGreetingAdvice(summary) {
  const stats = summary || {}
  const pendingWrong = Math.max(Number(stats.pendingWrong) || 0, 0)
  const answered = Math.max(Number(stats.answered) || 0, 0)

  if (pendingWrong > 0) {
    return `先把这 ${pendingWrong} 道错题消化掉，比刷新题更划算。`
  }

  if (answered > 0) {
    return `已经做了 ${answered} 题，正确率 ${stats.accuracyText || '0%'}，保持这个节奏。`
  }

  return '挑一个科目，先做 10 道题找找感觉。'
}

/**
 * 公告条：一条可点击直达的行动提示。
 * @param {object} summary { pendingWrong, masteredWrong, answered, total }
 * @returns {object} { key, tag, text, detail, actionText, action }
 */
function buildHomeTip(summary) {
  const stats = summary || {}
  const pendingWrong = Math.max(Number(stats.pendingWrong) || 0, 0)
  const masteredWrong = Math.max(Number(stats.masteredWrong) || 0, 0)
  const answered = Math.max(Number(stats.answered) || 0, 0)
  const total = Math.max(Number(stats.total) || 0, 0)

  if (pendingWrong > 0) {
    return {
      key: 'wrong-pending',
      tag: '待复习',
      text: `错题本里还有 ${pendingWrong} 道题没攻克。`,
      detail:
        `错题本收录的是你答错或跳过的题目，一共 ${pendingWrong} 道待复习。\n\n` +
        '同一道题连续答对 2 次，就会被判定为已攻克，移入「已攻克」列表，不再占用待复习名额。' +
        (masteredWrong > 0 ? `目前你已经攻克了 ${masteredWrong} 道。` : ''),
      actionText: '去复习',
      action: TIP_ACTIONS.WRONG_BOOK
    }
  }

  if (answered > 0) {
    const remaining = Math.max(total - answered, 0)

    return {
      key: 'keep-going',
      tag: '进行中',
      text: remaining > 0
        ? `已完成 ${answered} 题，还剩 ${remaining} 题没做过。`
        : '所有题目都做过了，可以随机抽题巩固一遍。',
      detail: remaining > 0
        ? `你已经完成 ${answered} 题，题库还剩 ${remaining} 题没有做过。\n\n` +
          '建议按科目逐个清空，避免在几个科目之间反复切换，记忆效果会更好。'
        : `题库里的 ${total} 道题你都做过了。\n\n` +
          '这个阶段比起刷新题，更推荐用「随机练习」打散顺序重做一遍，' +
          '或者去错题本检查还有没有没攻克的题。',
      actionText: '去刷题',
      action: TIP_ACTIONS.BANK
    }
  }

  return {
    key: 'fresh-start',
    tag: '新手上路',
    text: `${total} 道题已经就绪，先做 10 道熟悉一下。`,
    detail:
      `当前题库共有 ${total} 道题，覆盖多个科目。\n\n` +
      '每个科目都提供背题、顺序、随机三种练习方式：背题模式直接显示答案，适合第一遍过知识点；' +
      '顺序与随机模式会即时判对错并给出解析。做题进度和错题都保存在本机，不需要登录。',
    actionText: '去刷题',
    action: TIP_ACTIONS.BANK
  }
}

/**
 * 首页文案总入口。
 * @param {object} summary 学习状态汇总
 * @param {number} timestamp 可选，便于测试固定时间
 */
function buildHomeContent(summary, timestamp) {
  const time = toTimestamp(timestamp)

  return {
    greeting: getGreetingText(time),
    dateText: getDateText(time),
    advice: getGreetingAdvice(summary),
    // 每日一句：按当天日期取值，同一天稳定、次日自动更换
    quote: getDailyQuote(time).text,
    tip: buildHomeTip(summary)
  }
}

module.exports = {
  TIP_ACTIONS,
  WEEKDAYS,
  buildHomeContent,
  buildHomeTip,
  getDateText,
  getGreetingAdvice,
  getGreetingText
}
