const metrics = require('./loading-metrics.js')
let navigating = null
function navigate(method, options) {
  if (navigating) return false
  const input = typeof options === 'string' ? { url: options } : options || {}
  if (!input.url) return false
  const attempt = {}
  navigating = attempt
  const started = Date.now()
  metrics.record('route-call', { method, route: input.url.split('?')[0] })
  const complete = result => {
    if (navigating === attempt) navigating = null
    metrics.record('route-complete', { method, route: input.url.split('?')[0], duration: Date.now() - started })
    if (input.complete) input.complete(result)
  }
  try {
    wx[method](Object.assign({}, input, {
      success: result => {
        if (navigating === attempt) navigating = null
        if (input.success) input.success(result)
      },
      fail: error => {
        if (navigating === attempt) navigating = null
        if (input.fail) input.fail(error)
        else wx.showToast({ title: '页面暂不可用，请重试', icon: 'none' })
      }, complete
    }))
  } catch (error) { complete(error); if (input.fail) input.fail(error); else throw error }
  return true
}
module.exports = {
  navigateTo: options => navigate('navigateTo', options),
  switchTab: options => navigate('switchTab', options),
  redirectTo: options => navigate('redirectTo', options),
  reLaunch: options => navigate('reLaunch', options)
}
