function getInitialHomeHeaderData(windowInfo, menuButton) {
  const info = windowInfo || {}
  const statusBarHeight = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0 ? info.statusBarHeight : 20
  const hasMenu = menuButton && menuButton.height > 0 && menuButton.top >= statusBarHeight
  return {
    homeStatusBarHeight: statusBarHeight,
    homeNavigationBarHeight: hasMenu ? (menuButton.top - statusBarHeight) * 2 + menuButton.height : 44
  }
}

module.exports = { getInitialHomeHeaderData }
