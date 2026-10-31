import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateQuestionInput } from '../../src/types/admin'
import { parseQuestionFile } from '../../src/lib/content-rules'
import { isAuthenticated, saveAdminSession } from '../../src/lib/auth'
import { matchesAudience, isBankAvailable, recommendedBanks } from '../../src/lib/recommendations'
import { dateRange } from '../../src/lib/format'
import { questionImportExamples } from '../../src/lib/question-import-examples'

let gateway: import('./mock-admin-gateway').MockAdminContentGateway
let store: typeof import('../store/mock-admin-store').useMockAdminStore
const memory = new Map<string, string>()
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
}
const question: CreateQuestionInput = {
  questionBankId: 'bank-calculus',
  type: 'SINGLE_CHOICE',
  stem: '  1 + 1 = ?  ',
  options: [
    { key: 'A', content: '2' },
    { key: 'B', content: '3' },
  ],
  correctAnswer: ['A'],
  explanation: '1 + 1 = 2',
  status: 'ACTIVE',
}
async function run<T>(operation: () => Promise<T>): Promise<T> {
  const result = operation().then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  await vi.runAllTimersAsync()
  const settled = await result
  if ('error' in settled) throw settled.error
  return settled.value
}
beforeAll(async () => {
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', {
    localStorage: storage,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  })
  store = (await import('../store/mock-admin-store')).useMockAdminStore
  gateway = new (await import('./mock-admin-gateway')).MockAdminContentGateway()
})
beforeEach(() => {
  vi.useFakeTimers()
  memory.clear()
  store.getState().setScenario('normal')
})
afterEach(() => vi.useRealTimers())

describe('导入与数据边界', () => {
  it('兼容管理端和小程序 JSON，转换判断题答案', () => {
    expect(parseQuestionFile(JSON.stringify([question]), 'target')[0]).toMatchObject({
      questionBankId: 'target',
      stem: '1 + 1 = ?',
    })
    const [judge] = parseQuestionFile(
      JSON.stringify({
        questions: [
          {
            type: 'judge',
            stem: '判断题',
            options: [
              { key: 'A', text: '正确' },
              { key: 'B', text: '错误' },
            ],
            answerKeys: ['A'],
          },
        ],
      }),
      'bank-calculus',
    )
    expect(judge.correctAnswer).toEqual(['TRUE'])
    expect(judge.options.map((o) => o.key)).toEqual(['TRUE', 'FALSE'])
  })
  it('错误包含题号，拒绝重复选项与多选单答案', () => {
    expect(() =>
      parseQuestionFile(JSON.stringify([question, { ...question, correctAnswer: ['Z'] }]), 'bank-calculus'),
    ).toThrow('第 2 题')
    expect(() =>
      parseQuestionFile(
        JSON.stringify([{ ...question, options: [question.options[0], question.options[0]] }]),
        'bank-calculus',
      ),
    ).toThrow('不能重复')
    expect(() =>
      parseQuestionFile(JSON.stringify([{ ...question, type: 'MULTIPLE_CHOICE' }]), 'bank-calculus'),
    ).toThrow('至少需要两个')
    expect(() => parseQuestionFile('[]', 'bank-calculus')).toThrow('1 至 2000')
  })
  it('导入先校验整批，失败不留下部分数据', async () => {
    const before = store.getState().questions.length
    await expect(
      run(() =>
        gateway.importQuestions({
          questionBankId: 'bank-calculus',
          questions: [question, { ...question, stem: ' ' }],
        }),
      ),
    ).rejects.toThrow('题干必填')
    expect(store.getState().questions).toHaveLength(before)
    expect(
      await run(() =>
        gateway.importQuestions({ questionBankId: 'bank-calculus', questions: [question, question] }),
      ),
    ).toBe(2)
    expect(store.getState().questions).toHaveLength(before + 2)
    expect(new Set(store.getState().questions.map((q) => q.id)).size).toBe(before + 2)
  })
  it('创建和更新拒绝无效题目与孤立关联', async () => {
    await expect(
      run(() => gateway.createQuestion({ ...question, questionBankId: 'missing' })),
    ).rejects.toThrow('题库不存在')
    const created = await run(() => gateway.createQuestion(question))
    await expect(
      run(() => gateway.updateQuestion(created.id, { ...question, correctAnswer: ['Z'] })),
    ).rejects.toThrow('有效选项')
    await expect(
      run(() =>
        gateway.createQuestionBank({ subjectId: 'missing', name: '题库', description: '', status: 'ACTIVE' }),
      ),
    ).rejects.toThrow('有效课程')
  })
})

describe('填空、简答和阅读题组维护', () => {
  const fromExample = (type: keyof typeof questionImportExamples): CreateQuestionInput => ({
    ...structuredClone(questionImportExamples[type]), questionBankId: 'bank-calculus', status: 'ACTIVE',
  })
  it('三种新题型可创建、读取与更新，题组按小题汇总题数', async () => {
    const fill = await run(() => gateway.createQuestion(fromExample('FILL_BLANK')))
    const short = await run(() => gateway.createQuestion(fromExample('SHORT_ANSWER')))
    const reading = await run(() => gateway.createQuestion({ ...fromExample('READING'), explanation: '' }))
    expect((await run(() => gateway.getQuestion(fill.id))).blanks).toEqual(fill.blanks)
    expect((await run(() => gateway.getQuestion(short.id))).referenceAnswer).toBe(short.referenceAnswer)
    expect((await run(() => gateway.getQuestion(reading.id))).subQuestions).toHaveLength(2)
    expect((await run(() => gateway.listQuestionBanks())).find((bank) => bank.id === 'bank-calculus')).toMatchObject({ questionCount: 6, activeQuestionCount: 6 })
    expect((await run(() => gateway.getDashboardSummary())).questionCount).toBe(7)
    const updated = await run(() => gateway.updateQuestion(fill.id, { ...fill, blanks: [{ answers: ['H2O', 'water'] }, fill.blanks![1]] }))
    expect(updated.revision).toBe(2)
    const updatedShort = await run(() => gateway.updateQuestion(short.id, { ...short, scoringPoints: ['新的评分要点'] }))
    expect(updatedShort.revision).toBe(2)
  })

  it('阅读材料和小题顺序修改递增版本，状态修改不改变内容版本', async () => {
    const reading = await run(() => gateway.createQuestion(fromExample('READING')))
    const material = await run(() => gateway.updateQuestion(reading.id, { ...reading, passage: '更新的阅读材料' }))
    expect(material.revision).toBe(2)
    const reordered = await run(() => gateway.updateQuestion(reading.id, { ...material, subQuestions: [...material.subQuestions!].reverse() }))
    expect(reordered.revision).toBe(3)
    expect(reordered.subQuestions![0].id).toBe(reading.subQuestions![1].id)
    const disabled = await run(() => gateway.updateQuestion(reading.id, { ...reordered, status: 'INACTIVE' }))
    expect(disabled.revision).toBe(3)
    expect((await run(() => gateway.listQuestionBanks())).find((bank) => bank.id === 'bank-calculus')?.activeQuestionCount).toBe(2)
  })

  it('搜索和题型筛选覆盖阅读材料与小题', async () => {
    const reading = await run(() => gateway.createQuestion(fromExample('READING')))
    expect((await run(() => gateway.listQuestions({ keyword: '小林每天制定学习计划' }))).map((q) => q.id)).toContain(reading.id)
    expect((await run(() => gateway.listQuestions({ type: 'SHORT_ANSWER', keyword: '良好学习习惯' }))).map((q) => q.id)).toEqual([reading.id])
  })

  it('已发布题库不能保存缺解析的阅读小题，草稿发布检查同样会拦截', async () => {
    const reading = fromExample('READING')
    reading.subQuestions![1].explanation = ''
    await expect(run(() => gateway.createQuestion(reading))).rejects.toThrow('启用题目必须有解析')
    await run(() => gateway.setBankPublication('bank-calculus', 'UNPUBLISHED'))
    await run(() => gateway.createQuestion(reading))
    await expect(run(() => gateway.setBankPublication('bank-calculus', 'PUBLISHED'))).rejects.toThrow('阅读小题的解析')
  })

  it('新题型整批导入按小题返回题数，错误小题不会留下部分写入', async () => {
    const before = store.getState().questions.length
    const invalid = fromExample('READING')
    invalid.subQuestions![1].referenceAnswer = ''
    await expect(run(() => gateway.importQuestions({ questionBankId: 'bank-calculus', questions: [fromExample('FILL_BLANK'), invalid] }))).rejects.toThrow('第 2 题：第 2 小题')
    expect(store.getState().questions).toHaveLength(before)
    expect(await run(() => gateway.importQuestions({ questionBankId: 'bank-calculus', questions: [fromExample('FILL_BLANK'), fromExample('SHORT_ANSWER'), fromExample('READING')] }))).toBe(4)
    expect(store.getState().questions).toHaveLength(before + 3)
  })

  it('阅读小题已有反馈时阻止移除或删除，编辑保持原反馈快照', async () => {
    const reading = await run(() => gateway.createQuestion(fromExample('READING')))
    const snapshot = structuredClone(reading)
    store.setState({ feedback: [{ ...store.getState().feedback[0], questionId: reading.subQuestions![0].id, questionSnapshot: snapshot }] })
    await expect(run(() => gateway.updateQuestion(reading.id, { ...reading, subQuestions: reading.subQuestions!.slice(1) }))).rejects.toThrow('仍有反馈记录')
    await expect(run(() => gateway.deleteQuestion(reading.id))).rejects.toThrow('仍有反馈记录')
    await run(() => gateway.updateQuestion(reading.id, { ...reading, passage: '修改后的材料' }))
    expect(store.getState().feedback[0].questionSnapshot).toEqual(snapshot)
  })
})

describe('学生自主使用与共享内容', () => {
  it('课程不依赖专业，注册资料不完整仍可推荐公共内容', async () => {
    const created = await run(() =>
      gateway.createSubject({ name: '大学语文', majorIds: [], status: 'ACTIVE' }),
    )
    expect(created.majorIds).toEqual([])
    const state = store.getState()
    const banks = await run(() => gateway.listQuestionBanks())
    const incomplete = state.users.find((u) => !u.majorId)!
    expect(recommendedBanks(incomplete, banks, state.subjects).map((b) => b.id)).toEqual([
      'bank-english-grammar',
    ])
    const crossMajor = state.users.find((u) => u.majorId === 'major-english')!
    expect(recommendedBanks(crossMajor, banks, state.subjects).some((b) => b.id === 'bank-calculus')).toBe(
      false,
    )
    expect(isBankAvailable(banks.find((b) => b.id === 'bank-calculus')!, state.subjects)).toBe(true)
    expect((await run(() => gateway.listUserCourses(crossMajor.id)))[0].subjectId).toBe('subject-math')
  })

  it('推荐条件行内同时匹配，行间任一匹配，缺资料不会误匹配', () => {
    const user = store.getState().users[0]
    expect(matchesAudience(user, { majorId: user.majorId, enrollmentYear: user.enrollmentYear })).toBe(true)
    expect(matchesAudience(user, { majorId: user.majorId, enrollmentYear: 2001 })).toBe(false)
    expect(matchesAudience({ ...user, enrollmentYear: undefined }, { enrollmentYear: 2025 })).toBe(false)
    expect(matchesAudience(user, {})).toBe(false)
    const state = store.getState()
    const bank = {
      ...state.questionBanks[0],
      activeQuestionCount: 2,
      audiences: [{ majorId: user.majorId, enrollmentYear: 2001 }, { enrollmentYear: user.enrollmentYear }],
    }
    expect(recommendedBanks(user, [bank], state.subjects)).toHaveLength(1)
  })

  it('范围拒绝空条件、跨学院专业和无效年份，全校范围清理细分条件', async () => {
    const bank = store.getState().questionBanks[0]
    await expect(
      run(() => gateway.updateQuestionBank(bank.id, { ...bank, scopeType: 'TARGETED', audiences: [{}] })),
    ).rejects.toThrow('至少填写一个')
    await expect(
      run(() =>
        gateway.updateQuestionBank(bank.id, {
          ...bank,
          audiences: [{ collegeId: 'college-foreign-languages', majorId: 'major-computer-science' }],
        }),
      ),
    ).rejects.toThrow('不属于')
    await expect(
      run(() => gateway.updateQuestionBank(bank.id, { ...bank, audiences: [{ enrollmentYear: 100 }] })),
    ).rejects.toThrow('入学年份')
    const result = await run(() => gateway.updateQuestionBank(bank.id, { ...bank, scopeType: 'ALL' }))
    expect(result.audiences).toEqual([])
  })

  it('章节归属在编辑和整批导入时校验，错误不留下部分题目', async () => {
    const before = store.getState().questions.length
    await expect(
      run(() => gateway.createQuestion({ ...question, chapterId: 'chapter-tense' })),
    ).rejects.toThrow('不属于')
    await expect(
      run(() =>
        gateway.importQuestions({
          questionBankId: 'bank-calculus',
          questions: [question, { ...question, chapterId: 'chapter-tense' }],
        }),
      ),
    ).rejects.toThrow('第 2 题')
    expect(store.getState().questions).toHaveLength(before)
    await expect(run(() => gateway.deleteChapter('chapter-derivatives'))).rejects.toThrow('仍有题目')
    const created = await run(() =>
      gateway.saveChapter(undefined, { name: '积分', questionBankId: 'bank-calculus', sortOrder: 10 }),
    )
    await run(() =>
      gateway.reorderChapters('bank-calculus', [created.id, 'chapter-derivatives', 'chapter-limits']),
    )
    expect((await run(() => gateway.listChapters('bank-calculus')))[0].id).toBe(created.id)
    await expect(
      run(() => gateway.reorderChapters('bank-calculus', [created.id, created.id, 'chapter-tense'])),
    ).rejects.toThrow('顺序无效')
  })

  it('新题库为草稿，发布检查题目与解析，下架后退出推荐', async () => {
    const bank = await run(() =>
      gateway.createQuestionBank({
        subjectId: 'subject-math',
        name: '新复习题库',
        description: '覆盖基础内容',
        status: 'ACTIVE',
      }),
    )
    expect(bank).toMatchObject({ publicationStatus: 'DRAFT', status: 'INACTIVE' })
    await expect(run(() => gateway.setBankPublication(bank.id, 'PUBLISHED'))).rejects.toThrow('至少需要一道')
    const q = await run(() =>
      gateway.createQuestion({ ...question, questionBankId: bank.id, explanation: '' }),
    )
    await expect(run(() => gateway.setBankPublication(bank.id, 'PUBLISHED'))).rejects.toThrow('解析')
    await run(() => gateway.updateQuestion(q.id, { ...q, explanation: '补充解析' }))
    await run(() => gateway.setBankPublication(bank.id, 'PUBLISHED'))
    expect(
      recommendedBanks(
        store.getState().users[0],
        await run(() => gateway.listQuestionBanks()),
        store.getState().subjects,
      ).some((b) => b.id === bank.id),
    ).toBe(true)
    await run(() => gateway.setBankPublication(bank.id, 'UNPUBLISHED'))
    expect(
      recommendedBanks(
        store.getState().users[0],
        await run(() => gateway.listQuestionBanks()),
        store.getState().subjects,
      ).some((b) => b.id === bank.id),
    ).toBe(false)
    await run(() => gateway.setBankPublication(bank.id, 'ARCHIVED'))
    expect(store.getState().questions.some((row) => row.id === q.id)).toBe(true)
  })

  it('修正递增题目版本，原反馈快照保留，删除保护引用', async () => {
    const original = store.getState().questions.find((q) => q.id === 'question-single')!
    const snapshot = structuredClone(store.getState().feedback[0].questionSnapshot)
    const updated = await run(() =>
      gateway.updateQuestion(original.id, { ...original, explanation: '新的求导步骤' }),
    )
    expect(updated.revision).toBe(2)
    expect(updated.chapterId).toBe(original.chapterId)
    expect(store.getState().feedback[0].questionSnapshot).toEqual(snapshot)
    const disabled = await run(() => gateway.updateQuestion(updated.id, { ...updated, status: 'INACTIVE' }))
    expect(disabled.revision).toBe(2)
    await expect(run(() => gateway.deleteQuestion(original.id))).rejects.toThrow('反馈记录')
    await expect(run(() => gateway.deleteMajor('major-computer-science'))).rejects.toThrow('仍有用户')
    const selected = await run(() =>
      gateway.createSubject({ name: '有学生收藏的课程', majorIds: [], status: 'ACTIVE' }),
    )
    store.getState().setOperations({
      userCourses: [{ userId: 'user-1', subjectId: selected.id, addedAt: new Date().toISOString() }],
    })
    await expect(run(() => gateway.deleteSubject(selected.id))).rejects.toThrow('已有学生加入')
  })

  it('完成反馈必须回复，处理不改变原始问题，账号处置不改变学生课程', async () => {
    const before = structuredClone(store.getState().feedback[0])
    await expect(
      run(() => gateway.updateFeedback(before.id, { status: 'RESOLVED', response: ' ' })),
    ).rejects.toThrow('回复')
    const resolved = await run(() =>
      gateway.updateFeedback(before.id, { status: 'RESOLVED', response: '已补充求导步骤，谢谢反馈。' }),
    )
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.questionSnapshot).toEqual(before.questionSnapshot)
    const courses = structuredClone(await run(() => gateway.listUserCourses('user-1')))
    await run(() => gateway.setUserStatus('user-1', 'DISABLED'))
    expect(await run(() => gateway.listUserCourses('user-1'))).toEqual(courses)
  })

  it('已发布题库不能通过编辑或导入绕过解析检查', async () => {
    const existing = store.getState().questions[0]
    await expect(
      run(() => gateway.updateQuestion(existing.id, { ...existing, explanation: '' })),
    ).rejects.toThrow('必须有解析')
    await expect(
      run(() =>
        gateway.importQuestions({
          questionBankId: existing.questionBankId,
          questions: [{ ...question, explanation: '' }],
        }),
      ),
    ).rejects.toThrow('必须有解析')
    const bank = store.getState().questionBanks[0]
    await expect(
      run(() => gateway.updateQuestionBank(bank.id, { ...bank, description: '' })),
    ).rejects.toThrow('说明不能为空')
  })

  it('旧演示数据升级保留内容，范围作为候选且不擅自发布或分配个人课程', async () => {
    const state = store.getState()
    const legacy = {
      ...state,
      chapters: undefined,
      feedback: undefined,
      userCourses: undefined,
      questionBanks: state.questionBanks.map(
        ({ textbook, owner, scopeType, audiences, publicationStatus, ...bank }) => bank,
      ),
    }
    const migrated = (await store.persist.getOptions().migrate!(legacy, 0)) as typeof state
    expect(migrated.questions).toEqual(state.questions)
    expect(migrated.users).toEqual(state.users)
    expect(migrated.questionBanks[0]).toMatchObject({
      publicationStatus: 'DRAFT',
      status: 'INACTIVE',
      scopeType: 'TARGETED',
    })
    expect(migrated.questionBanks[0].audiences.length).toBeGreaterThan(0)
    expect(migrated.userCourses).toEqual([])
  })
})

describe('院级目录与年级管理', () => {
  it('同专业批量新增年级，去重后一次写入，不同专业可以使用相同年份', async () => {
    const added = await run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023, 2022, 2023], status: 'ACTIVE' }))
    expect(added).toHaveLength(2)
    expect(new Set(added.map((g) => g.id)).size).toBe(2)
    await run(() => gateway.createGrades({ majorId: 'major-english', enrollmentYears: [2023], status: 'ACTIVE' }))
    expect((await run(() => gateway.listGrades('major-computer-science'))).map((g) => g.enrollmentYear)).toEqual([2026, 2025, 2024, 2023, 2022])
  })

  it('无效年份、重复年级、无效专业和状态都不会留下部分年级', async () => {
    const before = structuredClone(store.getState().grades)
    for (const enrollmentYears of [[2023, 1999], [2023, 2025], []]) {
      await expect(run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears, status: 'ACTIVE' }))).rejects.toThrow()
      expect(store.getState().grades).toEqual(before)
    }
    await expect(run(() => gateway.createGrades({ majorId: 'missing', enrollmentYears: [2023], status: 'ACTIVE' }))).rejects.toThrow('专业不存在')
    await expect(run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023], status: 'INVALID' as 'ACTIVE' }))).rejects.toThrow('状态无效')
    expect(store.getState().grades).toEqual(before)
  })

  it('无关联年级可以编辑、停用和删除，同专业不能改成重复年份', async () => {
    const [grade] = await run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023], status: 'ACTIVE' }))
    await expect(run(() => gateway.updateGrade(grade.id, { enrollmentYear: 2025, status: 'ACTIVE' }))).rejects.toThrow('相同年级')
    const updated = await run(() => gateway.updateGrade(grade.id, { enrollmentYear: 2022, status: 'INACTIVE' }))
    expect(updated).toMatchObject({ id: grade.id, majorId: grade.majorId, enrollmentYear: 2022, status: 'INACTIVE' })
    await run(() => gateway.deleteGrade(grade.id))
    expect(store.getState().grades.some((g) => g.id === grade.id)).toBe(false)
  })

  it('已有学生的年级可停用，但不能改年份或删除，学生与练习记录保留', async () => {
    const before = store.getState()
    const grade = before.grades.find((g) => g.majorId === 'major-computer-science' && g.enrollmentYear === 2025)!
    await expect(run(() => gateway.updateGrade(grade.id, { enrollmentYear: 2023, status: 'ACTIVE' }))).rejects.toThrow('已有学生或题库关联')
    await expect(run(() => gateway.deleteGrade(grade.id))).rejects.toThrow('已有学生或题库关联')
    await run(() => gateway.updateGrade(grade.id, { enrollmentYear: 2025, status: 'INACTIVE' }))
    expect(store.getState().users).toEqual(before.users)
    expect(store.getState().activityRecords).toEqual(before.activityRecords)
    expect(store.getState().grades.find((g) => g.id === grade.id)?.status).toBe('INACTIVE')
  })

  it('年级引用同时匹配学院和专业，跨学院题库不会误阻止删除', async () => {
    const [grade] = await run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023], status: 'ACTIVE' }))
    const bank = store.getState().questionBanks[0]
    store.getState().setQuestionBanks([{ ...bank, audiences: [{ enrollmentYear: 2023 }] }])
    await expect(run(() => gateway.deleteGrade(grade.id))).rejects.toThrow('题库关联')
    store.getState().setQuestionBanks([{ ...bank, audiences: [{ collegeId: 'college-foreign-languages', enrollmentYear: 2023 }] }])
    await run(() => gateway.deleteGrade(grade.id))
    expect(store.getState().grades.some((g) => g.id === grade.id)).toBe(false)
  })

  it('空学院与专业支持完整维护，专业有年级时不能直接删除', async () => {
    const college = await run(() => gateway.createCollege({ name: '测试学院', code: 'TEST', status: 'ACTIVE' }))
    const major = await run(() => gateway.createMajor({ collegeId: college.id, name: '测试专业', code: 'TEST', status: 'ACTIVE' }))
    const [grade] = await run(() => gateway.createGrades({ majorId: major.id, enrollmentYears: [2026], status: 'ACTIVE' }))
    await expect(run(() => gateway.deleteMajor(major.id))).rejects.toThrow('仍有年级')
    await expect(run(() => gateway.deleteCollege(college.id))).rejects.toThrow('仍有专业')
    await run(() => gateway.deleteGrade(grade.id))
    await run(() => gateway.deleteMajor(major.id))
    await run(() => gateway.deleteCollege(college.id))
    expect(store.getState().colleges.some((c) => c.id === college.id)).toBe(false)
  })

  it('升级版本 1 数据只补齐年级目录，保留题库状态及已有学生年份', async () => {
    const state = store.getState()
    const legacy = { ...state, grades: undefined, users: [{ ...state.users[0], enrollmentYear: 2019 }, ...state.users.slice(1)] }
    const migrated = (await store.persist.getOptions().migrate!(legacy, 1)) as typeof state
    expect(migrated.questionBanks).toEqual(legacy.questionBanks)
    expect(migrated.users).toEqual(legacy.users)
    expect(migrated.questions).toEqual(legacy.questions)
    expect(migrated.grades.some((g) => g.majorId === legacy.users[0].majorId && g.enrollmentYear === 2019)).toBe(true)
  })

  it('写入失败保留年级目录，切换场景会清空旧年级并阻止旧写请求', async () => {
    store.getState().setScenario('write-error')
    const before = structuredClone(store.getState().grades)
    await expect(run(() => gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023], status: 'ACTIVE' }))).rejects.toThrow('服务异常')
    expect(store.getState().grades).toEqual(before)
    store.getState().setScenario('normal')
    const pending = gateway.createGrades({ majorId: 'major-computer-science', enrollmentYears: [2023], status: 'ACTIVE' }).catch((error) => error)
    store.getState().setScenario('empty')
    await vi.runAllTimersAsync()
    expect((await pending).message).toContain('场景已切换')
    expect(store.getState().grades).toEqual([])
  })
})

describe('课程多题库与发布维护', () => {
  it('一门课程允许多份题库，同课程重名受到保护，不同课程可以同名', async () => {
    const input = { subjectId: 'subject-math', name: '期末真题', description: '', status: 'ACTIVE' as const, scopeType: 'TARGETED' as const, audiences: [] }
    const first = await run(() => gateway.createQuestionBank(input))
    expect(first.publicationStatus).toBe('DRAFT')
    await expect(run(() => gateway.createQuestionBank(input))).rejects.toThrow('同名题库')
    const second = await run(() => gateway.createQuestionBank({ ...input, name: '章节练习' }))
    await expect(run(() => gateway.updateQuestionBank(second.id, { ...second, name: first.name }))).rejects.toThrow('同名题库')
    await run(() => gateway.createQuestionBank({ ...input, subjectId: 'subject-english' }))
    expect((await run(() => gateway.listQuestionBanks({ subjectId: 'subject-math' }))).length).toBe(3)
  })

  it('草稿允许稍后配置范围，补齐有效题目及范围后才能发布', async () => {
    const bank = await run(() => gateway.createQuestionBank({ subjectId: 'subject-math', name: '发布流程测试', description: '复习用途', status: 'ACTIVE', scopeType: 'TARGETED', audiences: [] }))
    await run(() => gateway.createQuestion({ ...question, questionBankId: bank.id }))
    await expect(run(() => gateway.setBankPublication(bank.id, 'PUBLISHED'))).rejects.toThrow('有效展示条件')
    await run(() => gateway.updateQuestionBank(bank.id, { ...bank, scopeType: 'ALL' }))
    await run(() => gateway.setBankPublication(bank.id, 'PUBLISHED'))
    const published = store.getState().questionBanks.find((b) => b.id === bank.id)!
    await expect(run(() => gateway.updateQuestionBank(bank.id, { ...published, scopeType: 'TARGETED', audiences: [] }))).rejects.toThrow('有效展示条件')
    expect(store.getState().questionBanks.find((b) => b.id === bank.id)?.scopeType).toBe('ALL')
  })

  it('已发布题库的最后一道启用题目不能直接停用、迁移或删除', async () => {
    const current = store.getState().questions.find((q) => q.questionBankId === 'bank-english-grammar')!
    await expect(run(() => gateway.updateQuestion(current.id, { ...current, status: 'INACTIVE' }))).rejects.toThrow('先下架')
    await expect(run(() => gateway.updateQuestion(current.id, { ...current, questionBankId: 'bank-calculus', chapterId: undefined }))).rejects.toThrow('先下架')
    await expect(run(() => gateway.deleteQuestion(current.id))).rejects.toThrow('先下架')
    await run(() => gateway.setBankPublication(current.questionBankId, 'UNPUBLISHED'))
    await run(() => gateway.updateQuestion(current.id, { ...current, status: 'INACTIVE' }))
    expect(store.getState().questions.find((q) => q.id === current.id)?.status).toBe('INACTIVE')
  })

  it('不存在的专业年级不能进入题库范围，失败写入保留原范围', async () => {
    const bank = store.getState().questionBanks[0]
    await expect(run(() => gateway.updateQuestionBank(bank.id, { ...bank, audiences: [{ majorId: 'major-computer-science', enrollmentYear: 2023 }] }))).rejects.toThrow('院级管理')
    expect(store.getState().questionBanks[0].audiences).toEqual(bank.audiences)
  })
})

describe('公告与账号安全', () => {
  it('草稿允许空正文，发布校验完整内容，定时到期转已发布', async () => {
    const input = {
      ...store.getState().announcements[0],
      title: '新公告',
      status: 'DRAFT' as const,
      body: '',
      summary: '',
    }
    const draft = await run(() => gateway.saveAnnouncement(undefined, input))
    await expect(
      run(() => gateway.saveAnnouncement(draft.id, { ...input, status: 'PUBLISHED' })),
    ).rejects.toThrow('摘要、正文')
    await expect(
      run(() =>
        gateway.saveAnnouncement(draft.id, {
          ...input,
          body: '正文',
          summary: '摘要',
          status: 'SCHEDULED',
          publishAt: '2000-01-01T00:00:00Z',
        }),
      ),
    ).rejects.toThrow('晚于当前时间')
    const publishAt = new Date(Date.now() + 60000).toISOString()
    await run(() =>
      gateway.saveAnnouncement(draft.id, {
        ...input,
        body: '正文',
        summary: '摘要',
        status: 'SCHEDULED',
        publishAt,
      }),
    )
    vi.advanceTimersByTime(61000)
    expect((await run(() => gateway.listAnnouncements())).find((a) => a.id === draft.id)?.status).toBe(
      'PUBLISHED',
    )
  })
  it('新建账号可登录，接口与日志不返回密码或哈希', async () => {
    const account = await run(() =>
      gateway.saveAdminAccount(undefined, {
        name: '测试老师',
        username: 'test_admin',
        status: 'ACTIVE',
        password: 'Password123',
      }),
    )
    expect(account).not.toHaveProperty('passwordHash')
    expect((await run(() => gateway.loginAdmin('test_admin', 'Password123'))).id).toBe(account.id)
    expect(JSON.stringify(await run(() => gateway.listOperationLogs()))).not.toContain('Password123')
    await expect(
      run(() =>
        gateway.saveAdminAccount(undefined, {
          name: '弱密码',
          username: 'weak_account',
          status: 'ACTIVE',
          password: '123',
        }),
      ),
    ).rejects.toThrow('密码至少')
  })
  it('当前账号以及最后一个启用管理员不能删除或停用', async () => {
    const account = await run(() => gateway.loginAdmin('admin', 'mock'))
    saveAdminSession(account, 30)
    await expect(run(() => gateway.deleteAdminAccount(account.id))).rejects.toThrow('当前登录')
    await expect(
      run(() => gateway.saveAdminAccount(account.id, { ...account, status: 'INACTIVE' })),
    ).rejects.toThrow('当前登录')
    memory.clear()
    store.setState({ adminAccounts: [store.getState().adminAccounts[0]] })
    await expect(run(() => gateway.deleteAdminAccount(account.id))).rejects.toThrow('至少保留')
    await expect(
      run(() => gateway.saveAdminAccount(account.id, { ...account, status: 'INACTIVE' })),
    ).rejects.toThrow('至少保留')
  })
  it('连续失败锁定并在到期后恢复，空闲会话自动失效', async () => {
    for (let i = 0; i < 5; i++)
      await expect(run(() => gateway.loginAdmin('admin', 'wrong'))).rejects.toThrow('账号或密码')
    await expect(run(() => gateway.loginAdmin('admin', 'mock'))).rejects.toThrow('锁定时间')
    vi.advanceTimersByTime(31 * 60000)
    const account = await run(() => gateway.loginAdmin('admin', 'mock'))
    saveAdminSession(account, 5)
    expect(isAuthenticated()).toBe(true)
    vi.advanceTimersByTime(5 * 60000)
    expect(isAuthenticated()).toBe(false)
  })
  it('日志支持组合筛选，活跃度按登录端与日期筛选', async () => {
    await run(() => gateway.saveSecuritySettings({ ...store.getState().security, sessionMinutes: 15 }))
    expect(
      await run(() =>
        gateway.listOperationLogs({ module: '安全设置', keyword: '登录与密码', result: 'SUCCESS' }),
      ),
    ).toHaveLength(1)
    const query = { ...dateRange(7), platform: 'WEB' as const }
    const activity = await run(() => gateway.getActivity(query))
    expect(activity.records).toHaveLength(7)
    expect(
      activity.records.every((r) => r.platform === 'WEB' && r.date >= query.start && r.date <= query.end),
    ).toBe(true)
    expect(activity.ranking.every((u) => u.activeDays <= 7)).toBe(true)
  })
  it('写入失败场景保留原有数据', async () => {
    store.getState().setScenario('write-error')
    const before = store.getState().users
    await expect(run(() => gateway.setUserStatus(before[0].id, 'DISABLED'))).rejects.toThrow('模拟服务异常')
    expect(store.getState().users).toEqual(before)
  })
  it('日志日期筛选包含本地凌晨的记录', async () => {
    store.setState({
      operationLogs: [
        {
          id: 'midnight-log',
          createdAt: new Date(2026, 9, 25, 0, 30).toISOString(),
          actor: 'admin',
          module: '公告',
          content: '凌晨发布',
          result: 'SUCCESS',
          ip: '本地演示',
        },
      ],
    })
    const logs = await run(() => gateway.listOperationLogs({ start: '2026-10-25', end: '2026-10-25' }))
    expect(logs.map((log) => log.id)).toEqual(['midnight-log'])
  })
  it('切换场景后，旧请求不得把题目写入新场景', async () => {
    const result = gateway
      .importQuestions({ questionBankId: 'bank-calculus', questions: [question] })
      .catch((error) => error as Error)
    store.getState().setScenario('empty')
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ message: '演示场景已切换，请重试。' })
    expect(store.getState().questions).toHaveLength(0)
  })
  it('快速切回同名场景时，旧写请求也会失效', async () => {
    const pending = gateway
      .importQuestions({ questionBankId: 'bank-calculus', questions: [question] })
      .catch((error) => error as Error)
    store.getState().setScenario('empty')
    store.getState().setScenario('normal')
    const before = store.getState().questions.length
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ message: '演示场景已切换，请重试。' })
    expect(store.getState().questions).toHaveLength(before)
  })
})
