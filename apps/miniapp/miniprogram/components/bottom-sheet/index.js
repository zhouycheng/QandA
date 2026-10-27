Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    },
    /**
     * 'bottom' 从底部升起（默认）；'center' 居中弹窗。
     *
     * 为什么要 center：微信的自定义 tabBar 是独立图层，永远盖在页面内容之上，
     * 页面里任何 fixed 弹层都会被它压住（公告的正文和按钮就是这样被挡的）。
     * 居中弹窗够不到底部那一条，与其斗争不如让它避开。
     */
    placement: {
      type: String,
      value: 'bottom'
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
})
