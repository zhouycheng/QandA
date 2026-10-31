const metrics = require('./loading-metrics.js')
const { getInitialHomeHeaderData } = require('./home-header.js')
function headerData() {
  const platform = typeof wx === 'undefined' ? {} : wx
  return getInitialHomeHeaderData(platform.getWindowInfo ? platform.getWindowInfo() : {}, platform.getMenuButtonBoundingClientRect ? platform.getMenuButtonBoundingClientRect() : null)
}
function stopBinding(page) {
  page._viewActive = false
  if (page._storeBinding) page._storeBinding.destroyStoreBindings()
  page._storeBinding = null
}
function bindViewModel(page) {
  if (!page.viewModel || typeof page.viewModel.projectRemote !== 'function' || typeof Behavior !== 'function') return
  stopBinding(page)
  page._viewActive = true
  const { createStoreBindings } = require('mobx-miniprogram-bindings')
  page._storeBinding = createStoreBindings({ setData(patch) {
    if (page._viewActive && patch.projection) page.applyViewModelResult({ data: patch.projection })
  } }, { fields: { projection: () => page.viewModel.projectRemote() }, structuralComparison: true })
  page._storeBinding.updateStoreBindings()
}
function withPageLifecycle(definition) {
  const result = Object.assign({}, definition)
  if (definition.customHeader) {
    result.data = Object.assign({}, definition.data, headerData())
    result.onResize = function () {
      this.setData(headerData())
      if (definition.onResize) return definition.onResize.apply(this, arguments)
    }
  }
  ;['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload'].forEach(name => {
    result[name] = function () {
      if (name === 'onLoad') this._pageUnloaded = false
      if (name === 'onUnload') this._pageUnloaded = true
      if (name === 'onHide' || name === 'onUnload') stopBinding(this)
      metrics.record(name, { route: this.route || '' })
      const value = definition[name] && definition[name].apply(this, arguments)
      if (name === 'onShow') bindViewModel(this)
      if (name === 'onHide') {
        const patch = {}
        ;['announcementSheetVisible', 'searchVisible', 'configSheetVisible', 'collegePickerVisible', 'routeLoadingVisible'].forEach(key => { if (this.data[key]) patch[key] = false })
        if (this.data.sheet) patch.sheet = ''
        if (Object.keys(patch).length) this.setData(patch)
      }
      return value
    }
  })
  if (definition.applyViewModelResult) result.applyViewModelResult = function () {
    if (!this._pageUnloaded) return definition.applyViewModelResult.apply(this, arguments)
  }
  Object.keys(definition).filter(name => /^handle[A-Z]/.test(name) && typeof definition[name] === 'function').forEach(name => {
    result[name] = function () {
      metrics.record('tap', { route: this.route || '', action: name })
      return definition[name].apply(this, arguments)
    }
  })
  return result
}
module.exports = { withPageLifecycle, bindViewModel, stopBinding }
