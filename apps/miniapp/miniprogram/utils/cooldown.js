/**
 * 验证码倒计时的页面控制器（注册页 / 找回密码页共用）。
 *
 * **按结束时刻算剩余秒数，不按每秒自减。**
 * 小程序退到后台时定时器会被系统掐断，我们在 onHide 里也主动停掉了定时器；
 * 若靠自减，`cooldown` 会冻在半路 —— 回到前台按钮显示「45s 后重发」且永远不归零，
 * 用户只能杀掉页面重进。用绝对结束时刻重算，onShow 里 resume 一次就无缝接上。
 *
 * 约束：本模块只做「计算 + 驱动 setData」，不碰 wx API，
 * 页面把自身传入即可，便于纯函数式测试。
 */

/** 结束时刻 → 剩余整秒；已过期返回 0 */
function remainingSeconds(endAt, now) {
  const end = Number(endAt) || 0
  const base = Number(now) > 0 ? Number(now) : Date.now()

  if (end <= base) {
    return 0
  }

  return Math.ceil((end - base) / 1000)
}

/** 只停定时器，**不清**结束时刻 —— 让 onShow 还能接着算 */
function stop(page) {
  if (page && page.cooldownTimer) {
    clearInterval(page.cooldownTimer)
    page.cooldownTimer = null
  }
}

/**
 * 按 `page.cooldownEndAt` 驱动展示值。
 * 每秒重算而不是减一，避免定时器被系统延后导致累计漂移。
 */
function start(page) {
  stop(page)

  const tick = () => {
    const remain = remainingSeconds(page.cooldownEndAt)

    page.setData({ cooldown: remain })

    if (remain <= 0) {
      page.cooldownEndAt = 0
      stop(page)
    }
  }

  tick()
  page.cooldownTimer = setInterval(tick, 1000)
}

/** 设定秒数并开始倒数（秒数非法时退回 60 秒） */
function begin(page, seconds) {
  const value = Number(seconds) > 0 ? Number(seconds) : 60

  page.cooldownEndAt = Date.now() + value * 1000
  start(page)
}

/** 回到前台：没走完就接着跑，已经走完就把按钮放出来 */
function resume(page) {
  if (!page || !page.cooldownEndAt) {
    return
  }

  if (remainingSeconds(page.cooldownEndAt) > 0) {
    start(page)
    return
  }

  page.cooldownEndAt = 0

  if (page.data && page.data.cooldown !== 0) {
    page.setData({ cooldown: 0 })
  }
}

/**
 * 页面 data 里 `cooldown` 字段的初始值。
 *
 * 这个字段只由本模块写入，初始值也一并在本模块给出 ——
 * 由 A 声明、由 B 修改的字段最容易在静态检查里「查无此人」，
 * 也会让页面看不出这个数字是从哪来的。
 */
function getInitialCooldownData() {
  return {
    cooldown: 0
  }
}

module.exports = {
  begin,
  getInitialCooldownData,
  remainingSeconds,
  resume,
  start,
  stop
}
