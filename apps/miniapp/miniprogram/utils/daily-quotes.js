/**
 * 每日语录：纯计算模块，不依赖微信 API，便于在 Node 中直接测试。
 *
 * 取值规则：按「一年中的第几天」对语录池取模。
 *   - 同一天多次打开得到同一条 —— 可预期，不会刷新一下就变；
 *   - 次日自动换成下一条；
 *   - 池子用完后从头循环，第 N+1 天重新开始。
 *
 * 不用随机数的原因：随机会导致同一天反复刷新出现不同语录，
 * 也会让「今天的句子」无法被用户记住或分享。
 */

const QUOTES = [
  '今天的努力，是明天的底气。',
  '不怕慢，就怕站；一直走，总会到达彼岸。',
  '真正的进步，常常发生在你想放弃的下一秒。',
  '把简单的事重复做，重复的事用心做。',
  '每天多懂一点，考试时就少慌一点。',
  '你不是不够聪明，只是还没有练够次数。',
  '坚持的意义，是让未来的你感谢现在的自己。',
  '别怕起步晚，怕的是一直在原地看别人往前走。',
  '积累总是慢的，但它给的是复利。',
  '现在每一次卡壳，都是在给大脑重新铺路。',
  '与其焦虑结果，不如专注眼前这道题。',
  '学习没有捷径，但一定有方法。',
  '做错的题，才是真正帮你提分的题。',
  '你不一定要赢过别人，但要赢过昨天的自己。',
  '千里之行，始于翻开这一页。',
  '停下来休息可以，但别把放弃当成休息。',
  '今天偷的懒，明天会变成拦路的坎。',
  '别人看到的是结果，只有你知道过程有多难。',
  '把大目标拆成今天就能做完的一小步。',
  '专注二十五分钟，胜过心不在焉两小时。',
  '背不下来的知识点，多见几次就熟了。',
  '你的沉稳，来自过去无数次想放弃又坚持下来。',
  '不怕不会，就怕不问；不怕慢，就怕停。',
  '认真这种能力，比任何天赋都可靠。',
  '努力不一定立刻有回报，但一定会留下痕迹。',
  '考场上的从容，来自平时的反复练习。',
  '别让「来不及」成为你放弃的理由。',
  '每天的十分钟，一年就是六十个小时。',
  '你偷偷努力的那些日子，终会发光。',
  '学到的东西不会背叛你，它会一直跟着你。',
  '想象一年后想成为的样子，然后做今天该做的事。',
  '进度条再短，也比停在 0% 强。',
  '把「我记不住」换成「我还没找到记住的方法」。',
  '真正的自由是拥有选择权，而选择权来自能力。',
  '今天多刷十道题，明天考场就多一分把握。',
  '慢慢来，比较快。'
]

function toTimestamp(timestamp) {
  const time = Number(timestamp)

  return Number.isFinite(time) && time > 0 ? time : Date.now()
}

/**
 * 一年中的第几天（1 月 1 日返回 1）。
 * 用本地时间计算，和用户看到的「日期」保持一致。
 */
function getDayOfYear(timestamp) {
  const date = new Date(toTimestamp(timestamp))
  const startOfYear = new Date(date.getFullYear(), 0, 0)

  return Math.floor((date.getTime() - startOfYear.getTime()) / 86400000)
}

/**
 * 取今日语录。
 * @returns {{ text: string, index: number, total: number }}
 */
function getDailyQuote(timestamp) {
  const dayOfYear = getDayOfYear(timestamp)
  const index = dayOfYear % QUOTES.length

  return {
    text: QUOTES[index],
    index,
    total: QUOTES.length
  }
}

module.exports = {
  QUOTES,
  getDailyQuote,
  getDayOfYear
}
