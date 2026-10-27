import type {
  ActivityRecord,
  Announcement,
  ManagedUser,
  SecuritySettings,
  StoredAdminAccount,
} from '../../src/types/operations'

export const defaultSecurity: SecuritySettings = {
  lockEnabled: true,
  maxAttempts: 5,
  lockMinutes: 30,
  sessionMinutes: 30,
  newDeviceVerification: false,
  minPasswordLength: 8,
  requireLetter: true,
  requireNumber: true,
  requireMixedCase: false,
  changeInitialPassword: false,
}

// The existing demo credential remains admin / mock. New accounts use the configured password rules.
const demoPasswordHash = 'ec864fe99b539704b8872ac591067ef22d836a8d942087f2dba274b301ebe6e5'
export const adminAccountFixtures: StoredAdminAccount[] = [
  ['admin', '小林'],
  ['content_editor', '小陈'],
  ['ops_01', '小周'],
  ['auditor_02', '小许'],
  ['security_01', '小王'],
].map(([username, name], i) => ({
  id: `admin-${i + 1}`,
  name,
  username,
  passwordHash: demoPasswordHash,
  status: i === 3 ? 'INACTIVE' : 'ACTIVE',
  createdAt: `2026-0${i + 1}-10T02:20:00.000Z`,
  lastLoginAt: '2026-10-24T01:15:00.000Z',
}))

export const userFixtures: ManagedUser[] = ['林', '陈', '周', '许', '王', '赵'].map((surname, i) => ({
  id: `user-${i + 1}`,
  name: `${surname}同学`,
  account: ['A103', 'A104', 'A105', 'B208', 'C016', 'B317'][i],
  email: `student${i + 1}@example.cn`,
  wechatBound: i % 3 !== 0,
  collegeId: i === 4 ? '' : i === 5 ? 'college-foreign-languages' : 'college-computer-science',
  majorId:
    i === 4
      ? ''
      : i === 5
        ? 'major-english'
        : i % 2
          ? 'major-software-engineering'
          : 'major-computer-science',
  enrollmentYear: i === 4 ? undefined : i % 2 ? 2024 : 2025,
  registeredAt: `2026-10-${String(10 + i).padStart(2, '0')}T08:00:00Z`,
  status: i === 3 ? 'DISABLED' : 'ACTIVE',
  answeredCount: [1248, 856, 2315, 412, 1892, 298][i],
  activeDays: [28, 25, 27, 18, 26, 12][i],
  preferredHours: ['19:00–21:00', '20:00–22:00', '18:00–20:00'][i % 3],
  platforms: i % 2 ? ['WEB'] : ['MINIAPP', 'WEB'],
  lastActiveAt: `2026-10-2${5 - i}T01:15:00.000Z`,
}))

export const announcementFixtures: Announcement[] = [
  '本周题库已更新',
  '平台维护通知',
  '新用户答题指南',
  '英语题库内容调整说明',
  '考试提醒功能上线',
].map((title, i) => ({
  id: `announcement-${i + 1}`,
  title,
  summary: '查看平台最新动态与学习内容。',
  body: '一、更新内容\n本周新增部分题目，并修订题目表述与解析。\n\n二、使用建议\n请进入对应科目完成相关练习，巩固所学知识。',
  audience: 'ALL',
  userIds: [],
  platforms: ['MINIAPP', 'WEB'],
  status: i === 2 ? 'DRAFT' : i === 3 ? 'SCHEDULED' : 'PUBLISHED',
  publishAt: i === 3 ? '2099-12-05T01:00:00.000Z' : i === 2 ? undefined : '2026-10-24T02:00:00.000Z',
  updatedAt: '2026-10-24T02:00:00.000Z',
}))

export function createActivityFixtures(): ActivityRecord[] {
  const records: ActivityRecord[] = []
  for (let i = 0; i < 90; i++) {
    const day = new Date()
    day.setDate(day.getDate() - (89 - i))
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    for (const platform of ['MINIAPP', 'WEB'] as const) {
      const userIds = userFixtures
        .filter((u, j) => u.platforms.includes(platform) && (i + j) % 4 !== 0)
        .map((u) => u.id)
      const answeredCount = userIds.length * (20 + (i % 11))
      records.push({
        date,
        platform,
        userIds,
        newUsers: i < 7 ? userIds.length : 0,
        returningUsers: i < 7 ? 0 : userIds.length,
        answeredCount,
        correctCount: Math.round(answeredCount * (0.65 + (i % 5) / 20)),
        hours: [2, 5, 8, 14, 7].map((n) => n * userIds.length),
      })
    }
  }
  return records
}
