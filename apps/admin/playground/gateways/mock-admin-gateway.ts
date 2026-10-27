import type { AdminContentGateway } from '../../src/gateways/admin-content-gateway'
import type {
  BankPublicationStatus,
  Chapter,
  CreateQuestionBankInput as BankInput,
  CollegeQuery,
  CreateCollegeInput,
  CreateMajorInput,
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateSubjectInput,
  MajorQuery,
  QuestionBankQuery,
  QuestionQuery,
  SubjectQuery,
  UpdateCollegeInput,
  UpdateMajorInput,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
  UpdateSubjectInput,
} from '../../src/types/admin'
import { getMockAdminState } from '../store/mock-admin-store'
import type {
  StudentFeedback,
  UserStatus,
  ActivityQuery,
  AdminAccountInput,
  AnnouncementInput,
  ImportQuestionsInput,
  LogQuery,
  SecuritySettings,
  UserQuery,
} from '../../src/types/operations'
import { hashPassword, validateQuestion } from '../../src/lib/content-rules'
import { getAdminSession } from '../../src/lib/auth'
import { localDate } from '../../src/lib/format'

const DEFAULT_DELAY = 300

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

async function simulateRequest(operation: 'read' | 'write' = 'read') {
  const { scenario, scenarioRevision } = getMockAdminState()
  const delay = scenario === 'slow' ? 3000 : DEFAULT_DELAY
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (getMockAdminState().scenario !== scenario || getMockAdminState().scenarioRevision !== scenarioRevision)
    throw new Error('演示场景已切换，请重试。')
  if (scenario === 'error' || (scenario === 'write-error' && operation === 'write')) {
    throw new Error('Playground 已模拟服务异常，请切换场景后重试。')
  }
}

function normalize(value?: string) {
  return value?.trim().toLocaleLowerCase() ?? ''
}

export function recordOperation(module: string, content: string, result: 'SUCCESS' | 'FAILURE' = 'SUCCESS') {
  const state = getMockAdminState()
  state.setOperations({
    operationLogs: [
      {
        id: createId('log'),
        createdAt: new Date().toISOString(),
        actor: getAdminSession()?.username ?? 'admin',
        module,
        content,
        result,
        ip: '本地演示',
      },
      ...state.operationLogs,
    ].slice(0, 1000),
  })
}

function publicAccount(account: import('../../src/types/operations').StoredAdminAccount) {
  const { passwordHash: _passwordHash, ...publicFields } = account
  return publicFields
}

export class MockAdminContentGateway implements AdminContentGateway {
  private validateQuestionPlacement(input: CreateQuestionInput) {
    if (
      getMockAdminState().questionBanks.some(
        (b) => b.id === input.questionBankId && b.publicationStatus === 'PUBLISHED',
      ) &&
      input.status === 'ACTIVE' &&
      !input.explanation?.trim()
    )
      throw new Error('已发布题库中的启用题目必须有解析。可先下架题库整理。')
    if (
      input.chapterId &&
      !getMockAdminState().chapters.some(
        (c) => c.id === input.chapterId && c.questionBankId === input.questionBankId,
      )
    )
      throw new Error('章节不存在或不属于当前题库。')
  }

  private validateBank(input: BankInput) {
    const state = getMockAdminState()
    if (!input.name.trim() || input.name.trim().length > 80 || (input.description?.length ?? 0) > 2000)
      throw new Error('题库名称必填且最多 80 字，说明最多 2000 字。')
    if ((input.textbook?.length ?? 0) > 120 || (input.owner?.length ?? 0) > 60)
      throw new Error('教材说明最多 120 字，负责人最多 60 字。')
    const scopeType = input.scopeType ?? 'ALL'
    if (!['ALL', 'TARGETED'].includes(scopeType)) throw new Error('适用范围类型无效。')
    const audiences = scopeType === 'ALL' ? [] : structuredClone(input.audiences ?? [])
    if (scopeType === 'TARGETED' && audiences.length === 0) throw new Error('请至少添加一条有效推荐条件。')
    for (const audience of audiences) {
      if (!audience.collegeId && !audience.majorId && !audience.enrollmentYear)
        throw new Error('每条推荐条件至少填写一个条件。')
      if (audience.collegeId && !state.colleges.some((c) => c.id === audience.collegeId))
        throw new Error('推荐学院不存在。')
      if (
        audience.majorId &&
        !state.majors.some(
          (m) => m.id === audience.majorId && (!audience.collegeId || m.collegeId === audience.collegeId),
        )
      )
        throw new Error('推荐专业不存在或不属于所选学院。')
      if (
        audience.enrollmentYear !== undefined &&
        (!Number.isInteger(audience.enrollmentYear) ||
          audience.enrollmentYear < 2000 ||
          audience.enrollmentYear > new Date().getFullYear() + 1)
      )
        throw new Error('请输入有效的四位入学年份。')
    }
    return {
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      textbook: input.textbook?.trim() ?? '',
      owner: input.owner?.trim() ?? '',
      scopeType,
      audiences,
    }
  }

  async setUserStatus(id: string, status: UserStatus) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const user = state.users.find((u) => u.id === id)
    if (!user) throw new Error('用户不存在。')
    if (!['ACTIVE', 'DISABLED'].includes(status)) throw new Error('账号状态无效。')
    const updated = { ...user, status }
    state.setOperations({ users: state.users.map((u) => (u.id === id ? updated : u)) })
    recordOperation('用户管理', `${status === 'ACTIVE' ? '恢复' : '停用'}账号：${user.account}`)
    return updated
  }

  async listUserCourses(userId?: string) {
    await simulateRequest()
    return structuredClone(getMockAdminState().userCourses.filter((c) => !userId || c.userId === userId))
  }

  async listFeedback() {
    await simulateRequest()
    return structuredClone(getMockAdminState().feedback).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }

  async updateFeedback(id: string, input: Pick<StudentFeedback, 'status' | 'response'>) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.feedback.find((f) => f.id === id)
    if (!current) throw new Error('反馈不存在。')
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'].includes(input.status))
      throw new Error('反馈状态无效。')
    if (typeof input.response !== 'string' || input.response.length > 2000)
      throw new Error('处理说明最多 2000 字。')
    if (['RESOLVED', 'DISMISSED'].includes(input.status) && !input.response.trim())
      throw new Error('结束处理前请填写给学生的回复。')
    const updated = {
      ...current,
      status: input.status,
      response: input.response.trim(),
      updatedAt: new Date().toISOString(),
    }
    state.setOperations({ feedback: state.feedback.map((f) => (f.id === id ? updated : f)) })
    recordOperation(
      '学生反馈',
      `处理${current.kind === 'QUESTION' ? '题目纠错' : '缺课需求'}：${current.title}`,
    )
    return updated
  }

  async listChapters(questionBankId?: string) {
    await simulateRequest()
    return structuredClone(
      getMockAdminState().chapters.filter((c) => !questionBankId || c.questionBankId === questionBankId),
    ).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async saveChapter(id: string | undefined, input: Omit<Chapter, 'id'>) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.chapters.find((c) => c.id === id)
    if (id && !current) throw new Error('章节不存在。')
    if (!state.questionBanks.some((b) => b.id === input.questionBankId)) throw new Error('题库不存在。')
    if (current && current.questionBankId !== input.questionBankId)
      throw new Error('章节不能迁移至其他题库。')
    if (!input.name.trim() || input.name.length > 60) throw new Error('章节名称必填且最多 60 字。')
    if (
      state.chapters.some(
        (c) => c.id !== id && c.questionBankId === input.questionBankId && c.name === input.name.trim(),
      )
    )
      throw new Error('题库内已有同名章节。')
    const chapter = {
      ...input,
      name: input.name.trim(),
      id: id ?? createId('chapter'),
      sortOrder:
        current?.sortOrder ?? state.chapters.filter((c) => c.questionBankId === input.questionBankId).length,
    }
    state.setOperations({
      chapters: current
        ? state.chapters.map((c) => (c.id === id ? chapter : c))
        : [...state.chapters, chapter],
    })
    recordOperation('章节管理', `保存章节：${chapter.name}`)
    return chapter
  }

  async reorderChapters(questionBankId: string, ids: string[]) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const chapters = state.chapters.filter((c) => c.questionBankId === questionBankId)
    if (
      ids.length !== chapters.length ||
      new Set(ids).size !== ids.length ||
      chapters.some((c) => !ids.includes(c.id))
    )
      throw new Error('章节顺序无效，请刷新重试。')
    state.setOperations({
      chapters: state.chapters.map((c) =>
        c.questionBankId === questionBankId ? { ...c, sortOrder: ids.indexOf(c.id) } : c,
      ),
    })
    recordOperation('章节管理', '调整章节顺序')
  }

  async deleteChapter(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (!state.chapters.some((c) => c.id === id)) throw new Error('章节不存在。')
    if (state.questions.some((q) => q.chapterId === id))
      throw new Error('章节仍有题目，请先移动题目或设为未分章。')
    state.setOperations({ chapters: state.chapters.filter((c) => c.id !== id) })
    recordOperation('章节管理', '删除空章节')
  }

  async setBankPublication(id: string, status: BankPublicationStatus) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.questionBanks.find((b) => b.id === id)
    if (!current) throw new Error('题库不存在。')
    if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(status)) throw new Error('发布状态无效。')
    if (status === 'PUBLISHED') {
      if (!state.subjects.some((s) => s.id === current.subjectId && s.status === 'ACTIVE'))
        throw new Error('请先启用所属课程。')
      this.validateBank(current)
      const questions = state.questions.filter((q) => q.questionBankId === id && q.status === 'ACTIVE')
      if (!questions.length) throw new Error('题库至少需要一道启用的题目才能发布。')
      for (const q of questions) {
        validateQuestion(q)
        this.validateQuestionPlacement(q)
      }
      if (questions.some((q) => !q.explanation.trim())) throw new Error('发布前请补全所有启用题目的解析。')
      if (!current.description.trim()) throw new Error('发布前请填写题库说明，帮助学生选择。')
    }
    const updated = {
      ...current,
      publicationStatus: status,
      status: status === 'PUBLISHED' ? ('ACTIVE' as const) : ('INACTIVE' as const),
      updatedAt: new Date().toISOString(),
    }
    state.setQuestionBanks(state.questionBanks.map((b) => (b.id === id ? updated : b)))
    recordOperation('题库发布', `${status}：${current.name}`)
    return updated
  }

  async listUsers(query?: UserQuery) {
    await simulateRequest()
    return getMockAdminState().users.filter(
      (u) =>
        normalize(`${u.name} ${u.account} ${u.email}`).includes(normalize(query?.keyword)) &&
        (!query?.collegeId || u.collegeId === query.collegeId) &&
        (!query?.majorId || u.majorId === query.majorId) &&
        (!query?.status || u.status === query.status),
    )
  }

  async listAdminAccounts() {
    await simulateRequest()
    return getMockAdminState().adminAccounts.map(publicAccount)
  }

  async saveAdminAccount(id: string | undefined, input: AdminAccountInput) {
    await simulateRequest('write')
    const security = getMockAdminState().security
    if (!input.name.trim() || input.name.length > 40 || !/^[A-Za-z0-9_-]{3,30}$/.test(input.username))
      throw new Error('姓名必填，登录账号须为 3 至 30 位字母、数字、短横线或下划线。')
    if (!['ACTIVE', 'INACTIVE'].includes(input.status)) throw new Error('管理员状态无效。')
    if (!id && !input.password) throw new Error('请设置初始密码。')
    if (
      input.password &&
      (input.password.length < security.minPasswordLength ||
        (security.requireLetter && !/[A-Za-z]/.test(input.password)) ||
        (security.requireNumber && !/\d/.test(input.password)) ||
        (security.requireMixedCase && (!/[A-Z]/.test(input.password) || !/[a-z]/.test(input.password))))
    )
      throw new Error(`密码至少 ${security.minPasswordLength} 位，并满足已配置的字母、数字及大小写要求。`)
    const passwordHash = input.password ? await hashPassword(input.password) : undefined
    const state = getMockAdminState()
    const current = state.adminAccounts.find((a) => a.id === id)
    if (id && !current) throw new Error('管理员不存在。')
    if (state.adminAccounts.some((a) => a.id !== id && normalize(a.username) === normalize(input.username)))
      throw new Error('登录账号已存在。')
    if (id === getAdminSession()?.id && input.status === 'INACTIVE') throw new Error('不能停用当前登录账号。')
    if (input.status === 'INACTIVE' && !state.adminAccounts.some((a) => a.id !== id && a.status === 'ACTIVE'))
      throw new Error('至少保留一个启用的管理员。')
    const account = {
      id: current?.id ?? createId('admin'),
      name: input.name.trim(),
      username: input.username,
      status: input.status,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      lastLoginAt: current?.lastLoginAt,
      passwordHash: passwordHash ?? current!.passwordHash,
    }
    state.setOperations({
      adminAccounts: current
        ? state.adminAccounts.map((a) => (a.id === id ? account : a))
        : [account, ...state.adminAccounts],
    })
    recordOperation('管理员账号', `${id ? '编辑' : '新增'}账号：${account.username}`)
    return publicAccount(account)
  }

  async deleteAdminAccount(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (id === getAdminSession()?.id) throw new Error('不能删除当前登录账号。')
    if (!state.adminAccounts.some((a) => a.id === id)) throw new Error('管理员不存在。')
    if (!state.adminAccounts.some((a) => a.id !== id && a.status === 'ACTIVE'))
      throw new Error('至少保留一个启用的管理员。')
    const name = state.adminAccounts.find((a) => a.id === id)!.username
    state.setOperations({ adminAccounts: state.adminAccounts.filter((a) => a.id !== id) })
    recordOperation('管理员账号', `删除账号：${name}`)
  }

  async loginAdmin(username: string, password: string) {
    await simulateRequest()
    const state = getMockAdminState()
    const attemptKey = `qanda-login-attempt:${normalize(username)}`
    let attempt = { count: 0, until: 0 }
    try {
      const saved = JSON.parse(window.localStorage.getItem(attemptKey) ?? 'null')
      if (Number.isFinite(saved?.count) && Number.isFinite(saved?.until)) attempt = saved
    } catch {
      /* A damaged local demo counter starts over. */
    }
    if (state.security.lockEnabled && attempt.until > Date.now())
      throw new Error('登录失败次数过多，请在锁定时间结束后重试。')
    const passwordHash = await hashPassword(password)
    const account = getMockAdminState().adminAccounts.find(
      (a) =>
        normalize(a.username) === normalize(username) &&
        a.status === 'ACTIVE' &&
        a.passwordHash === passwordHash,
    )
    if (!account) {
      const count = attempt.until && attempt.until <= Date.now() ? 1 : attempt.count + 1
      window.localStorage.setItem(
        attemptKey,
        JSON.stringify({
          count,
          until:
            state.security.lockEnabled && count >= state.security.maxAttempts
              ? Date.now() + state.security.lockMinutes * 60000
              : 0,
        }),
      )
      recordOperation('安全设置', `账号登录失败：${username.slice(0, 30)}`, 'FAILURE')
      throw new Error('账号或密码错误，或账号已停用。')
    }
    window.localStorage.removeItem(attemptKey)
    const updated = { ...account, lastLoginAt: new Date().toISOString() }
    state.setOperations({
      adminAccounts: getMockAdminState().adminAccounts.map((a) => (a.id === account.id ? updated : a)),
    })
    recordOperation('管理员账号', `登录成功：${account.username}`)
    return publicAccount(updated)
  }

  async listAnnouncements() {
    await simulateRequest()
    // shortcut: Scheduled publishing is evaluated on reads; use a backend scheduler during HTTP integration.
    return getMockAdminState().announcements.map((a) =>
      a.status === 'SCHEDULED' && a.publishAt && new Date(a.publishAt).getTime() <= Date.now()
        ? { ...a, status: 'PUBLISHED' as const }
        : a,
    )
  }

  async saveAnnouncement(id: string | undefined, input: AnnouncementInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (id && !state.announcements.some((a) => a.id === id)) throw new Error('公告不存在。')
    if (!input.title.trim() || input.title.length > 80) throw new Error('公告标题必填，且最多 80 字。')
    if (
      !['DRAFT', 'PUBLISHED', 'SCHEDULED'].includes(input.status) ||
      !['ALL', 'SELECTED'].includes(input.audience)
    )
      throw new Error('公告状态或发布范围无效。')
    if (input.status !== 'DRAFT' && (!input.summary.trim() || !input.body.trim() || !input.platforms.length))
      throw new Error('请填写摘要、正文并选择展示端。')
    if (input.platforms.some((p) => p !== 'MINIAPP' && p !== 'WEB')) throw new Error('展示端无效。')
    if (
      input.audience === 'SELECTED' &&
      ((input.status !== 'DRAFT' && !input.userIds.length) ||
        input.userIds.some((id) => !state.users.some((u) => u.id === id)))
    )
      throw new Error('请选择有效的指定用户。')
    if (
      input.status === 'SCHEDULED' &&
      (!input.publishAt ||
        !Number.isFinite(Date.parse(input.publishAt)) ||
        Date.parse(input.publishAt) <= Date.now())
    )
      throw new Error('定时发布时间必须晚于当前时间。')
    const announcement = {
      ...input,
      id: id ?? createId('announcement'),
      title: input.title.trim(),
      userIds: input.audience === 'ALL' ? [] : [...new Set(input.userIds)],
      publishAt:
        input.status === 'PUBLISHED'
          ? new Date().toISOString()
          : input.status === 'SCHEDULED'
            ? input.publishAt
            : undefined,
      updatedAt: new Date().toISOString(),
    }
    state.setOperations({
      announcements: id
        ? state.announcements.map((a) => (a.id === id ? announcement : a))
        : [announcement, ...state.announcements],
    })
    recordOperation(
      '公告',
      `${input.status === 'DRAFT' ? '保存草稿' : input.status === 'SCHEDULED' ? '定时发布' : '发布公告'}：${announcement.title}`,
    )
    return announcement
  }

  async deleteAnnouncement(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) throw new Error('公告不存在。')
    state.setOperations({ announcements: state.announcements.filter((a) => a.id !== id) })
    recordOperation('公告', `删除公告：${announcement.title}`)
  }

  async getSecuritySettings() {
    await simulateRequest()
    return { ...getMockAdminState().security }
  }

  async saveSecuritySettings(input: SecuritySettings) {
    await simulateRequest('write')
    // shortcut: Device verification and first-login changes need a real identity service; enable them at integration.
    if (input.newDeviceVerification || input.changeInitialPassword)
      throw new Error('新设备验证和首次改密需接入真实身份服务，演示环境暂不可启用。')
    if (
      ![input.maxAttempts, input.lockMinutes, input.sessionMinutes, input.minPasswordLength].every(
        Number.isInteger,
      ) ||
      input.maxAttempts < 3 ||
      input.maxAttempts > 10 ||
      input.lockMinutes < 1 ||
      input.lockMinutes > 1440 ||
      input.sessionMinutes < 5 ||
      input.sessionMinutes > 1440 ||
      input.minPasswordLength < 8 ||
      input.minPasswordLength > 64
    )
      throw new Error('安全设置数值超出允许范围。')
    const security = { ...input, updatedAt: new Date().toISOString() }
    getMockAdminState().setOperations({ security })
    recordOperation('安全设置', '保存管理员登录与密码规则')
    return security
  }

  async listOperationLogs(query?: LogQuery) {
    await simulateRequest()
    return getMockAdminState().operationLogs.filter(
      (l) =>
        normalize(`${l.actor} ${l.content}`).includes(normalize(query?.keyword)) &&
        (!query?.module || l.module === query.module) &&
        (!query?.result || l.result === query.result) &&
        (!query?.start || localDate(new Date(l.createdAt)) >= query.start) &&
        (!query?.end || localDate(new Date(l.createdAt)) <= query.end),
    )
  }

  async getActivity(query: ActivityQuery) {
    await simulateRequest()
    const state = getMockAdminState()
    const records = state.activityRecords.filter(
      (r) =>
        r.date >= query.start && r.date <= query.end && (!query.platform || r.platform === query.platform),
    )
    const all = state.activityRecords.filter(
      (r) => r.date <= query.end && (!query.platform || r.platform === query.platform),
    )
    const last = (days: number) => {
      const d = new Date(`${query.end}T12:00:00`)
      d.setDate(d.getDate() - days + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const ids = (since: string, until = query.end) =>
      new Set(all.filter((r) => r.date >= since && r.date <= until).flatMap((r) => r.userIds))
    const recent = ids(last(7))
    const previous = ids(last(14), last(8))
    const counts = new Map<string, Set<string>>()
    for (const r of records)
      for (const id of r.userIds) {
        if (!counts.has(id)) counts.set(id, new Set())
        counts.get(id)!.add(r.date)
      }
    return {
      dailyActive: ids(query.end).size,
      weeklyActive: recent.size,
      monthlyActive: ids(last(30)).size,
      retention: previous.size
        ? Math.round(([...previous].filter((id) => recent.has(id)).length / previous.size) * 1000) / 10
        : 0,
      records,
      ranking: state.users
        .filter((u) => counts.has(u.id))
        .map((u) => ({ ...u, activeDays: counts.get(u.id)!.size }))
        .sort((a, b) => b.activeDays - a.activeDays || b.answeredCount - a.answeredCount),
    }
  }

  async importQuestions(input: ImportQuestionsInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (!state.questionBanks.some((b) => b.id === input.questionBankId)) throw new Error('目标题库不存在。')
    if (!input.questions.length || input.questions.length > 10000)
      throw new Error('一次最多导入 10000 道题。')
    const now = new Date().toISOString()
    // Validate the whole batch before writing so a bad question cannot leave a partial import.
    const questions = input.questions.map((q, index) => {
      const inputQuestion = { ...q, questionBankId: input.questionBankId }
      try {
        this.validateQuestionPlacement(inputQuestion)
        return {
          ...validateQuestion(inputQuestion),
          revision: 1,
          id: createId('question'),
          createdAt: now,
          updatedAt: now,
        }
      } catch (error) {
        throw new Error(`第 ${index + 1} 题：${error instanceof Error ? error.message : '内容无效'}`)
      }
    })
    state.setQuestions([...questions, ...state.questions])
    recordOperation('题库工作台', `导入题目（共 ${questions.length} 条）`)
    return questions.length
  }

  async getDashboardSummary() {
    await simulateRequest()
    const { colleges, subjects, questionBanks, questions, users, activityRecords } = getMockAdminState()
    return {
      collegeCount: colleges.length,
      subjectCount: subjects.length,
      questionBankCount: questionBanks.length,
      questionCount: questions.length,
      userCount: users.length,
      answeredCount: activityRecords.reduce((sum, r) => sum + r.answeredCount, 0),
      choiceCount: questions.filter((q) => q.type !== 'TRUE_FALSE').length,
      trueFalseCount: questions.filter((q) => q.type === 'TRUE_FALSE').length,
    }
  }

  async listColleges(query?: CollegeQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState().colleges.filter((college) =>
      normalize(`${college.name} ${college.code}`).includes(keyword),
    )
  }

  async createCollege(input: CreateCollegeInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (!name || !code) throw new Error('名称和代码不能为空。')
    if (state.colleges.some((college) => normalize(college.name) === normalize(name))) {
      throw new Error('学院名称已存在。')
    }
    if (state.colleges.some((college) => normalize(college.code) === normalize(code))) {
      throw new Error('学院代码已存在。')
    }
    const now = new Date().toISOString()
    const college = { ...input, name, code, id: createId('college'), createdAt: now, updatedAt: now }
    state.setColleges([college, ...state.colleges])
    recordOperation('学院管理', `保存：${college.name}`)
    return college
  }

  async updateCollege(id: string, input: UpdateCollegeInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.colleges.find((college) => college.id === id)
    if (!current) throw new Error('学院不存在。')
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (!name || !code) throw new Error('名称和代码不能为空。')
    if (state.colleges.some((college) => college.id !== id && normalize(college.name) === normalize(name))) {
      throw new Error('学院名称已存在。')
    }
    if (state.colleges.some((college) => college.id !== id && normalize(college.code) === normalize(code))) {
      throw new Error('学院代码已存在。')
    }
    const college = { ...current, ...input, name, code, updatedAt: new Date().toISOString() }
    state.setColleges(state.colleges.map((item) => (item.id === id ? college : item)))
    recordOperation('学院管理', `保存：${college.name}`)
    return college
  }

  async deleteCollege(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.questionBanks.some((b) => b.audiences.some((a) => a.collegeId === id)))
      throw new Error('学院仍被题库推荐范围引用，请先调整适用范围。')
    if (state.users.some((u) => u.collegeId === id)) throw new Error('学院仍有用户，请停用以保留资料关联。')
    if (state.majors.some((major) => major.collegeId === id)) {
      throw new Error('学院下仍有专业，请先删除或迁移专业。')
    }
    state.setColleges(state.colleges.filter((college) => college.id !== id))
    recordOperation('学院管理', `删除记录：${id}`)
  }

  async listMajors(query?: MajorQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState()
      .majors.filter((major) => !query?.collegeId || major.collegeId === query.collegeId)
      .filter((major) => normalize(`${major.name} ${major.code}`).includes(keyword))
  }

  async createMajor(input: CreateMajorInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (!state.colleges.some((college) => college.id === input.collegeId)) {
      throw new Error('所属学院不存在。')
    }
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (!name || !code) throw new Error('名称和代码不能为空。')
    if (
      state.majors.some(
        (major) => major.collegeId === input.collegeId && normalize(major.name) === normalize(name),
      )
    ) {
      throw new Error('该学院下已存在同名专业。')
    }
    if (
      state.majors.some(
        (major) => major.collegeId === input.collegeId && normalize(major.code) === normalize(code),
      )
    ) {
      throw new Error('该学院下已存在相同专业代码。')
    }
    const now = new Date().toISOString()
    const major = { ...input, name, code, id: createId('major'), createdAt: now, updatedAt: now }
    state.setMajors([major, ...state.majors])
    recordOperation('专业管理', `保存：${major.name}`)
    return major
  }

  async updateMajor(id: string, input: UpdateMajorInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.majors.find((major) => major.id === id)
    if (!current) throw new Error('专业不存在。')
    if (
      current.collegeId !== input.collegeId &&
      state.questionBanks.some((b) =>
        b.audiences.some((a) => a.majorId === id && a.collegeId && a.collegeId !== input.collegeId),
      )
    )
      throw new Error('迁移会使题库的学院与专业条件冲突，请先调整适用范围。')
    if (current.collegeId !== input.collegeId && state.users.some((u) => u.majorId === id))
      throw new Error('专业仍有用户，暂不能迁移学院。')
    if (!state.colleges.some((college) => college.id === input.collegeId)) {
      throw new Error('所属学院不存在。')
    }
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (!name || !code) throw new Error('名称和代码不能为空。')
    if (
      state.majors.some(
        (major) =>
          major.id !== id && major.collegeId === input.collegeId && normalize(major.name) === normalize(name),
      )
    ) {
      throw new Error('该学院下已存在同名专业。')
    }
    if (
      state.majors.some(
        (major) =>
          major.id !== id && major.collegeId === input.collegeId && normalize(major.code) === normalize(code),
      )
    ) {
      throw new Error('该学院下已存在相同专业代码。')
    }
    const major = { ...current, ...input, name, code, updatedAt: new Date().toISOString() }
    state.setMajors(state.majors.map((item) => (item.id === id ? major : item)))
    recordOperation('专业管理', `保存：${major.name}`)
    return major
  }

  async deleteMajor(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.users.some((u) => u.majorId === id)) throw new Error('专业仍有用户，请停用以保留资料关联。')
    if (state.questionBanks.some((bank) => bank.audiences.some((a) => a.majorId === id)))
      throw new Error('专业仍被题库推荐范围引用，请先调整适用范围。')
    state.setMajors(state.majors.filter((major) => major.id !== id))
    state.setSubjects(
      state.subjects.map((s) => ({ ...s, majorIds: s.majorIds.filter((majorId) => majorId !== id) })),
    )
    recordOperation('专业管理', `删除记录：${id}`)
  }

  async listSubjects(query?: SubjectQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState()
      .subjects.filter(
        (subject) =>
          !query?.majorId ||
          getMockAdminState().questionBanks.some(
            (bank) =>
              bank.subjectId === subject.id &&
              (bank.scopeType === 'ALL' || bank.audiences.some((a) => a.majorId === query.majorId)),
          ),
      )
      .filter((subject) => normalize(subject.name).includes(keyword))
  }

  async createSubject(input: CreateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const majorIds = [...new Set(input.majorIds)]
    if (!input.name.trim() || input.name.length > 50) throw new Error('课程名称必填，且最多 50 字。')
    if (majorIds.some((majorId) => !state.majors.some((major) => major.id === majorId))) {
      throw new Error('选择的专业不存在。')
    }
    if (state.subjects.some((subject) => normalize(subject.name) === normalize(input.name))) {
      throw new Error('课程名称已存在，请使用已有课程。')
    }
    const now = new Date().toISOString()
    const subject = {
      ...input,
      majorIds,
      name: input.name.trim(),
      id: createId('subject'),
      createdAt: now,
      updatedAt: now,
    }
    state.setSubjects([subject, ...state.subjects])
    recordOperation('课程管理', `保存：${subject.name}`)
    return subject
  }

  async updateSubject(id: string, input: UpdateSubjectInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.subjects.find((subject) => subject.id === id)
    if (!current) throw new Error('课程不存在。')
    const majorIds = [...new Set(input.majorIds)]
    if (!input.name.trim() || input.name.length > 50) throw new Error('课程名称必填，且最多 50 字。')
    if (majorIds.some((majorId) => !state.majors.some((major) => major.id === majorId))) {
      throw new Error('选择的专业不存在。')
    }
    if (
      state.subjects.some((subject) => subject.id !== id && normalize(subject.name) === normalize(input.name))
    ) {
      throw new Error('课程名称已存在。')
    }
    const subject = {
      ...current,
      ...input,
      majorIds,
      name: input.name.trim(),
      updatedAt: new Date().toISOString(),
    }
    state.setSubjects(state.subjects.map((item) => (item.id === id ? subject : item)))
    recordOperation('课程管理', `保存：${subject.name}`)
    return subject
  }

  async deleteSubject(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.userCourses.some((c) => c.subjectId === id))
      throw new Error('已有学生加入该课程，请停用以保留学习关联。')
    if (state.questionBanks.some((bank) => bank.subjectId === id)) {
      throw new Error('课程下仍有题库，请先删除或迁移题库。')
    }
    state.setSubjects(state.subjects.filter((subject) => subject.id !== id))
    recordOperation('课程管理', `删除记录：${id}`)
  }

  async listQuestionBanks(query?: QuestionBankQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    const { questionBanks, questions } = getMockAdminState()
    return questionBanks
      .filter((bank) => !query?.subjectId || bank.subjectId === query.subjectId)
      .filter((bank) => normalize(bank.name).includes(keyword))
      .map((bank) => ({
        ...bank,
        questionCount: questions.filter((question) => question.questionBankId === bank.id).length,
        activeQuestionCount: questions.filter((q) => q.questionBankId === bank.id && q.status === 'ACTIVE')
          .length,
      }))
  }

  async createQuestionBank(input: CreateQuestionBankInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (!state.subjects.some((s) => s.id === input.subjectId) || !input.name.trim())
      throw new Error('请选择有效课程并填写题库名称。')
    const now = new Date().toISOString()
    const bank = {
      ...input,
      ...this.validateBank(input),
      publicationStatus: 'DRAFT' as const,
      status: 'INACTIVE' as const,
      id: createId('bank'),
      questionCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    state.setQuestionBanks([bank, ...state.questionBanks])
    recordOperation('题库工作台', `保存：${bank.name}`)
    return bank
  }

  async updateQuestionBank(id: string, input: UpdateQuestionBankInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.questionBanks.find((bank) => bank.id === id)
    if (!current) throw new Error('题库不存在。')
    if (current.publicationStatus === 'PUBLISHED' && !input.description?.trim())
      throw new Error('已发布题库的内容说明不能为空。')
    if (!state.subjects.some((s) => s.id === input.subjectId) || !input.name.trim())
      throw new Error('请选择有效课程并填写题库名称。')
    if (
      input.subjectId !== current.subjectId &&
      (state.questions.some((q) => q.questionBankId === id) ||
        state.userCourses.some((c) => c.preferredBankId === id))
    )
      throw new Error('已有内容或学生选择的题库不能更换所属课程。')
    const bank = {
      ...current,
      ...input,
      ...this.validateBank({ ...current, ...input }),
      status: current.status,
      publicationStatus: current.publicationStatus,
      updatedAt: new Date().toISOString(),
    }
    state.setQuestionBanks(state.questionBanks.map((item) => (item.id === id ? bank : item)))
    recordOperation('题库工作台', `保存：${bank.name}`)
    return bank
  }

  async deleteQuestionBank(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.questions.some((question) => question.questionBankId === id)) {
      throw new Error('题库中仍有题目，请先删除或迁移题目。')
    }
    if (
      state.chapters.some((c) => c.questionBankId === id) ||
      state.userCourses.some((c) => c.preferredBankId === id) ||
      state.feedback.some((f) => f.questionBankId === id)
    )
      throw new Error('题库仍有章节、学生选择或反馈记录，请使用归档。')
    state.setQuestionBanks(state.questionBanks.filter((bank) => bank.id !== id))
    recordOperation('题库工作台', `删除记录：${id}`)
  }

  async listQuestions(query?: QuestionQuery) {
    await simulateRequest()
    const keyword = normalize(query?.keyword)
    return getMockAdminState()
      .questions.filter(
        (question) => !query?.questionBankId || question.questionBankId === query.questionBankId,
      )
      .filter(
        (q) =>
          !query?.chapterId ||
          (query.chapterId === 'unassigned' ? !q.chapterId : q.chapterId === query.chapterId),
      )
      .filter((question) => !query?.type || question.type === query.type)
      .filter((question) => !query?.status || question.status === query.status)
      .filter((question) => {
        const searchable = `${question.stem} ${question.options.map((option) => option.content).join(' ')}`
        return normalize(searchable).includes(keyword)
      })
  }

  async getQuestion(id: string) {
    await simulateRequest()
    const question = getMockAdminState().questions.find((item) => item.id === id)
    if (!question) throw new Error('题目不存在。')
    return question
  }

  async createQuestion(input: CreateQuestionInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const now = new Date().toISOString()
    if (!state.questionBanks.some((b) => b.id === input.questionBankId)) throw new Error('所属题库不存在。')
    this.validateQuestionPlacement(input)
    const question = {
      ...validateQuestion(input),
      revision: 1,
      id: createId('question'),
      createdAt: now,
      updatedAt: now,
    }
    state.setQuestions([question, ...state.questions])
    recordOperation('题目管理', `保存：${question.stem}`)
    return question
  }

  async updateQuestion(id: string, input: UpdateQuestionInput) {
    await simulateRequest('write')
    const state = getMockAdminState()
    const current = state.questions.find((question) => question.id === id)
    if (!current) throw new Error('题目不存在。')
    if (!state.questionBanks.some((b) => b.id === input.questionBankId)) throw new Error('所属题库不存在。')
    this.validateQuestionPlacement(input)
    const valid = validateQuestion(input)
    const changed =
      JSON.stringify([current.stem, current.options, current.correctAnswer, current.explanation]) !==
      JSON.stringify([valid.stem, valid.options, valid.correctAnswer, valid.explanation])
    const question = {
      ...current,
      ...valid,
      revision: (current.revision ?? 1) + Number(changed),
      updatedAt: new Date().toISOString(),
    }
    state.setQuestions(state.questions.map((item) => (item.id === id ? question : item)))
    recordOperation('题目管理', `保存：${question.stem}`)
    return question
  }

  async deleteQuestion(id: string) {
    await simulateRequest('write')
    const state = getMockAdminState()
    if (state.feedback.some((f) => f.questionId === id))
      throw new Error('题目仍有反馈记录，请停用以保留关联。')
    state.setQuestions(state.questions.filter((question) => question.id !== id))
    recordOperation('题目管理', `删除记录：${id}`)
  }
}
