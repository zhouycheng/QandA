const { wrapComponentMethods } = require('../../utils/tap-trace.js')

Component(wrapComponentMethods({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    }
  },

  methods: {
    handleMaskTap() {
      this.triggerEvent('close')
    },

    handleCloseTap() {
      this.triggerEvent('close')
    },

    noop() {
      return false
    }
  }
}), 'bottom-sheet')
