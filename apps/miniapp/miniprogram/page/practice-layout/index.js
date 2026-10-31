const { withPageLifecycle } = require('../../utils/page-lifecycle.js')
const { createWxStorageAdapter } = require('../../utils/wx-storage.js')
const { PracticeLayoutViewModel } = require('../../viewmodels/practice-layout-viewmodel.js')
Page(withPageLifecycle({
  data: PracticeLayoutViewModel.getInitialData(),
  onLoad() { this.viewModel = new PracticeLayoutViewModel({ storage: createWxStorageAdapter() }); this.applyViewModelResult(this.viewModel.load()) },
  onReady() { this.measure() },
  onResize() { this.cancelDrag(); this.measure() },
  onHide() { this.cancelDrag() },
  onUnload() { clearInterval(this.edgeTimer) },
  measure() {
    if (this._pageUnloaded) return
    const query = this.createSelectorQuery()
    query.select('.pra-body').boundingClientRect()
    query.selectAll('.pra-module').boundingClientRect()
    query.select('.pra-content').boundingClientRect()
    query.exec(results => {
      if (!results || !results[0]) return
      this.viewport = results[0]
      this.blocks = results[1] || []
      this.scrollHeight = results[2] ? results[2].height : this.viewport.height
      this.measuredScroll = this.actualScroll || 0
    })
  },
  handleScroll(event) {
    this.actualScroll = event.detail.scrollTop
    this.scrollHeight = event.detail.scrollHeight
    if (this.drag) {
      this.setData({ dragScroll: this.actualScroll - this.drag.scroll })
      this.targetAt(this.drag.y)
    } else this.measure()
  },
  handleDragStart(event) {
    if (!this.blocks || !this.viewport) { this.measure(); return }
    this.drag = { id: event.id, y: event.y, scroll: this.actualScroll || 0, index: this.viewModel.order.indexOf(event.id) }
    this.setData({ dragId: event.id, dragTarget: '', dragScroll: 0 })
    clearInterval(this.edgeTimer)
    this.edgeTimer = setInterval(() => {
      if (!this.drag) return
      const y = this.drag.y
      const direction = y < this.viewport.top + 52 ? -1 : y > this.viewport.bottom - 52 ? 1 : 0
      if (!direction) return
      const max = Math.max(0, (this.scrollHeight || 0) - this.viewport.height)
      const next = Math.max(0, Math.min(max, (this.actualScroll || 0) + direction * 12))
      this.setData({ scrollTop: next })
    }, 32)
  },
  targetAt(y) {
    if (!this.drag) return
    const delta = (this.actualScroll || 0) - (this.measuredScroll || 0)
    const others = this.blocks.filter(block => block.dataset.module !== this.drag.id).sort((a, b) => a.top - b.top)
    const index = others.filter(block => y > (block.top + block.bottom) / 2 - delta).length
    this.drag.index = index
    const target = others[index] ? others[index].dataset.module : 'end'
    if (target !== this.data.dragTarget) this.setData({ dragTarget: target })
  },
  handleDragMove(event) { if (this.drag) { this.drag.y = event.y; this.targetAt(event.y) } },
  handleDragEnd(event) {
    if (!this.drag) return
    this.targetAt(event.y)
    const result = this.viewModel.drop(this.drag.id, this.drag.index)
    this.cancelDrag()
    this.applyViewModelResult(result)
  },
  handleDragCancel() { this.cancelDrag() },
  cancelDrag() {
    clearInterval(this.edgeTimer)
    this.drag = null
    if (!this._pageUnloaded) this.setData({ dragId: '', dragTarget: '', dragScroll: 0, dragReset: (this.data.dragReset || 0) + 1 }, () => this.measure())
  },
  handleResetLayout() { this.cancelDrag(); this.applyViewModelResult(this.viewModel.reset()) },
  applyViewModelResult(result) {
    if (result.data) this.setData(result.data, () => this.measure())
    if (result.command) wx.showToast({ title: result.command.title, icon: 'none' })
  },
  selectOption() {}, inputAnswerText() {}, assessShortAnswer() {}, toggleExplanation() {}, toggleFavorite() {}, openOverview() {}, toggleMark() {}, goPrev() {}, goNext() {}
}))
