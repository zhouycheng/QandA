Component({
  properties: {
    /**
     * 章节行数据，由题库页的 ViewModel 组装：
     * { bankId, title, metaText, isComplete, progressPercent, ... }
     * 组件只负责显示与转发点击，不再自己算进度 —— 统计口径只允许有一处真源。
     */
    bank: {
      type: Object,
      value: null
    }
  },

  methods: {
    handleOpenTap() {
      this.triggerEvent('open', {
        bank: this.data.bank
      })
    }
  }
})
