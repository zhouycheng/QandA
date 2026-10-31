const questionBankCatalog = require('../utils/question-bank-catalog.js')
const questionLookup = require('../utils/question-lookup.js')
const progressRepository = require('./progress-repository.js')
const favoriteRepository = require('./favorite-repository.js')
const wrongBookRepository = require('./wrong-book-repository.js')
const customQuizRepository = require('./custom-quiz-repository.js')
const studyTimeRepository = require('./study-time-repository.js')
const dailyLogRepository = require('./daily-log-repository.js')
const preferenceRepository = require('./preference-repository.js')
const sessionRepository = require('./session-repository.js')
const practiceGateway = require('./practice-gateway.js')
const mockScenario = require('../utils/mock-scenario.js')
const playgroundSwitch = require('../utils/playground-switch.js')
const userBankRepository = require('./user-bank-repository.js')
const authRepository = require('./auth-repository.js')
const reminderRepository = require('./reminder-repository.js')

/**
 * 仓储层：页面与 ViewModel 只依赖这里，不直接依赖 utils。
 * 未来接入服务端接口时，只需替换本文件的实现，上层保持不变。
 */

/**
 * 冷启动时把 storage 里的用户题库同步进 catalog 快照。
 * 不做这一步，上一次导入的题库在这次启动里会凭空消失。
 */
function syncUserBanks(storage) {
  return questionBankCatalog.registerUserBanks(userBankRepository.getUserBanks(storage))
}

module.exports = {
  syncUserBanks,
  getSubjectSummaries: questionBankCatalog.getSubjectSummaries,
  getSubjectDetail: questionBankCatalog.getSubjectDetail,
  getBankQuiz: questionBankCatalog.getBankQuiz,
  getSubjectQuiz: questionBankCatalog.getSubjectQuiz,
  getSubjectDrawQuiz: questionBankCatalog.getSubjectDrawQuiz,
  getFirstBankQuiz: questionBankCatalog.getFirstBankQuiz,
  getCatalogStats: questionBankCatalog.getCatalogStats,
  getBankMetaByStorageKey: questionBankCatalog.getBankMetaByStorageKey,
  getScopeMeta: questionBankCatalog.getScopeMeta,
  // 按题目 id 反查（错题本 / 收藏用）
  getQuizByIds: questionLookup.getQuizByIds,
  findQuestionEntries: questionLookup.findQuestionEntries,
  // 首页本地搜索：题目索引（题目 id → 题干/选项/来源）
  getQuestionIndex: questionLookup.getQuestionIndex,
  // 做题进度读写（storage 由页面注入）
  getProgress: progressRepository.getProgress,
  saveScopeProgress: progressRepository.saveScopeProgress,
  clearProgress: progressRepository.clearProgress,
  // 收藏夹读写
  getFavorites: favoriteRepository.getFavorites,
  getFavoriteIds: favoriteRepository.getFavoriteIds,
  hasFavorite: favoriteRepository.hasFavorite,
  addQuestionFavorite: favoriteRepository.addQuestionFavorite,
  removeQuestionFavorite: favoriteRepository.removeQuestionFavorite,
  toggleQuestionFavorite: favoriteRepository.toggleQuestionFavorite,
  removeQuestionFavorites: favoriteRepository.removeQuestionFavorites,
  clearFavorites: favoriteRepository.clearFavorites,
  // 错题本读写
  getWrongBook: wrongBookRepository.getWrongBook,
  getPendingIds: wrongBookRepository.getPendingIds,
  getMasteredIds: wrongBookRepository.getMasteredIds,
  summarizeWrongBook: wrongBookRepository.summarizeWrongBook,
  saveWrongResults: wrongBookRepository.saveResults,
  removeWrongQuestions: wrongBookRepository.removeQuestions,
  clearWrongBook: wrongBookRepository.clearWrongBook,
  // 自定义练习（错题重练 / 收藏练习）
  getCustomQuiz: customQuizRepository.getCustomQuiz,
  saveCustomQuiz: customQuizRepository.saveCustomQuiz,
  clearCustomQuiz: customQuizRepository.clearCustomQuiz,
  // 学习时长
  getStudyTime: studyTimeRepository.getStudyTime,
  addStudyTime: studyTimeRepository.addStudyTime,
  clearStudyTime: studyTimeRepository.clearStudyTime,
  // 每日学习日志（趋势图与连续天数的数据源）
  getDailyLog: dailyLogRepository.getDailyLog,
  addDailyLog: dailyLogRepository.addDailyLog,
  getDailySummary: dailyLogRepository.getDailySummary,
  clearDailyLog: dailyLogRepository.clearDailyLog,
  // 学习偏好（答题页与设置页共用）
  getPreferences: preferenceRepository.getPreferences,
  savePreferences: preferenceRepository.savePreferences,
  updatePreferenceSwitch: preferenceRepository.updatePreferenceSwitch,
  updatePreferenceChoice: preferenceRepository.updatePreferenceChoice,
  updatePreferenceText: preferenceRepository.updatePreferenceText,
  resetPreferences: preferenceRepository.resetPreferences,
  // PracticeSession 读写（未完成会话检测、退出恢复、提交重试）
  getSession: sessionRepository.getSession,
  getResumableSession: sessionRepository.getResumableSession,
  getPendingSession: sessionRepository.getPendingSession,
  saveSession: sessionRepository.saveSession,
  clearSession: sessionRepository.clearSession,
  // PracticeGateway（PRD 8）：Mock ⇄ HTTP 的切换边界，页面不感知具体实现
  getSubjects: practiceGateway.getSubjects,
  getQuestionBanks: practiceGateway.getQuestionBanks,
  createSession: practiceGateway.createSession,
  submitSession: practiceGateway.submitSession,
  retrySubmit: practiceGateway.retrySubmit,
  // API PRD 8 的两个读接口：补齐 HTTP 契约，端内暂不主动调用
  getRemoteSession: practiceGateway.getSession,
  getRemoteResult: practiceGateway.getResult,
  setGateway: practiceGateway.setGateway,
  resetGateway: practiceGateway.resetGateway,
  getGatewayName: practiceGateway.getGatewayName,
  // Playground（PRD 7）：开发工具，默认关闭
  isPlaygroundEnabled: playgroundSwitch.isEnabled,
  setPlaygroundEnabled: playgroundSwitch.setEnabled,
  syncPlaygroundEnabled: playgroundSwitch.syncFromStorage,
  listPlaygroundScenarios: (...args) => require('../playground/playground-scenarios.js').listScenarios(...args),
  applyPlaygroundScenario: (...args) => require('../playground/playground-scenarios.js').applyScenario(...args),
  // Playground 场景开关
  getMockScenario: mockScenario.getScenario,
  setMockScenario: mockScenario.setScenario,
  getMockScenarioConfig: mockScenario.getScenarioConfig,
  // 用户自助导入的题库（存在 storage 里，与内置题库走同一套取卷逻辑）
  registerUserBanks: questionBankCatalog.registerUserBanks,
  getUserBanks: userBankRepository.getUserBanks,
  getUserBank: userBankRepository.getUserBank,
  saveUserBank: userBankRepository.saveUserBank,
  removeUserBank: userBankRepository.removeUserBank,
  clearUserBanks: userBankRepository.clearUserBanks,
  parseBankText: userBankRepository.parseBankText,
  buildUserBank: userBankRepository.buildUserBank,
  // 登录态：邮箱密码 / 微信登录（后端已配时）⇄ 本地身份（降级），页面不感知走哪条路
  getAuth: authRepository.getAuth,
  login: authRepository.login,
  loginWithEmail: authRepository.loginWithEmail,
  registerAccount: authRepository.register,
  sendAuthCode: authRepository.sendCode,
  resetPassword: authRepository.resetPassword,
  logout: authRepository.logout,
  updateAuthProfile: authRepository.updateProfile,
  clearAuth: authRepository.clearAuth,
  // 邮箱提醒设置（设计稿 781:2043）：端上只存「想收到什么提醒」，发信在后端
  getReminder: reminderRepository.getReminder,
  saveReminder: reminderRepository.saveReminder,
  updateReminderSwitch: reminderRepository.updateReminderSwitch,
  updateReminderTime: reminderRepository.updateReminderTime,
  updateReminderFrequency: reminderRepository.updateReminderFrequency,
  toggleAdvanceDay: reminderRepository.toggleAdvance,
  addReminderExam: reminderRepository.addReminderExam,
  removeReminderExam: reminderRepository.removeReminderExam
}

// 在线运行由 App 启用；开发场景继续使用显式的本地仓储。
const remoteData = require('./remote-data-repository.js')
;['addQuestionFavorite', 'removeQuestionFavorite', 'getSubjectSummaries', 'getSubjectDetail', 'getCatalogStats', 'getBankQuiz', 'getSubjectQuiz', 'getQuestionIndex', 'findQuestionEntries', 'getFavorites', 'getWrongBook', 'getDailyLog', 'getStudyTime', 'getProgress', 'getScopeMeta', 'toggleQuestionFavorite', 'removeQuestionFavorites', 'clearFavorites', 'removeWrongQuestions'].forEach((name) => {
  const local = module.exports[name]
  module.exports[name] = function () { return (remoteData.isEnabled() ? remoteData[name] : local).apply(null, arguments) }
})
module.exports.refreshRemote = remoteData.refresh
module.exports.isRemoteEnabled = remoteData.isEnabled
module.exports.getRemoteStatistics = remoteData.getStatistics
module.exports.getRemoteRecent = function (storage) {
  return remoteData.isEnabled() && !authRepository.getAuth(storage).loggedIn ? require('./trial-practice.js').recent(storage) : remoteData.getRecent(storage)
}
module.exports.getResumableSession = function (storage) {
  if (!remoteData.isEnabled()) return sessionRepository.getResumableSession(storage)
  const auth = authRepository.getAuth(storage)
  const snapshot = !auth.loggedIn ? require('./trial-practice.js').resumable(storage) : storage.get(`qandaOnline:${auth.userId}:${storage.get(`qandaOnlineLast:${auth.userId}`) || ''}`)
  return snapshot && snapshot.status !== 'SUBMITTED' ? Object.assign({}, snapshot.localState || {}, { sessionId: snapshot.id, config: snapshot.route }) : null
}
module.exports.getRemoteHistory = remoteData.getHistory
module.exports.getRemoteAnnouncements = remoteData.getAnnouncements
module.exports.loadRemoteQuestion = remoteData.loadQuestion

module.exports.searchRemoteQuestions = remoteData.searchQuestions

module.exports.getRemoteOverview = remoteData.getOverview
module.exports.getRemoteCollection = remoteData.getCollection
module.exports.getRemoteCollectionSummary = remoteData.getCollectionSummary
module.exports.getRemoteCatalogPage = remoteData.getCatalogPage
module.exports.getRemoteSubjectPage = remoteData.getSubjectPage
module.exports.getRemoteResourceState = remoteData.getResourceState
module.exports.getRemoteAnnouncementTotal = remoteData.getAnnouncementTotal
module.exports.loadRemoteSubjects = remoteData.refreshSubjects
module.exports.loadRemoteBanks = remoteData.refreshBanks
module.exports.loadRemoteBank = remoteData.loadBank
module.exports.loadRemoteChapters = remoteData.loadChapters
module.exports.previewRemotePracticeScope = remoteData.previewPracticeScope
