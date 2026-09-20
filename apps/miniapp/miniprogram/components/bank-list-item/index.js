const { wrapComponentMethods } = require('../../utils/tap-trace.js')

Component(wrapComponentMethods({
  properties: {
    bank: {
      type: Object,
      value: null
    },

    theme: {
      type: String,
      value: 'english'
    }
  },

  methods: {
    handleOpenTap() {
      this.triggerEvent('open', {
        bank: this.data.bank
      })
    }
  }
}), 'bank-list-item')
