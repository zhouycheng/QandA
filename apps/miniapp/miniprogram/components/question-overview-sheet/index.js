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
    showStatus: {
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

    noop() {
      return false
    }
  }
}), 'question-overview-sheet')
