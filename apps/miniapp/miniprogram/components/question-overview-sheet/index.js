const { wrapComponentMethods } = require('../../utils/tap-trace.js')

Component(wrapComponentMethods({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    items: {
      type: Array,
      value: []
    },
    unansweredCount: {
      type: Number,
      value: 0
    },
    /** 「已答 X题 / 未答 Y题 / 标记 Z题」这一行用的三个数，由页面算好传进来 */
    answeredCount: {
      type: Number,
      value: 0
    },
    markedCount: {
      type: Number,
      value: 0
    },
    total: {
      type: Number,
      value: 0
    },
    showStatus: {
      type: Boolean,
      value: true
    },
    /** 查看模式（mode=view）不提交：交卷一个空卷会把 0 分记录写进复盘统计 */
    canSubmit: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    handleMaskTap() {
      this.triggerEvent('close')
    },

    handleItemTap(e) {
      this.triggerEvent('jump', {
        index: Number(e.currentTarget.dataset.index)
      })
    },

    /** 「确认结束」交给页面：未答完时页面会先弹二次确认，这里不自己判 */
    handleSubmitTap() {
      this.triggerEvent('submit')
    },

    /** 「看标记」：交卷前想到还有打了记号的题没看，直接跳过去 */
    handleJumpMarkedTap() {
      this.triggerEvent('jumpmarked')
    },

    noop() {
      return false
    }
  }
}), 'question-overview-sheet')
