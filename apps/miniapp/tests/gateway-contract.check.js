/**
 * Gateway 契约自检 —— API PRD 第 8 节用户侧六个接口 + 第 7.6 节 PracticeResult 字段。
 * 运行：node apps/miniapp/tests/gateway-contract.check.js
 *
 * 覆盖重点是**两个查询接口的响应归一化**：后端字段缺一半、答案用字符串返回、
 * 正确率给比例而不是百分制，这三种情况都不能让页面拿到一份静默错误的成绩。
 *
 * 同时守住三条底线：
 * - 未配置域名时返回失败而不是抛错（域名没申请下来是常态）；
 * - 查询失败不改动 syncStatus（读接口不参与同步状态机）；
 * - Mock 与 HTTP 返回同名字段，切换后不用改调用方。
 */
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../miniprogram')
const httpGateway = require(path.join(MINIPROGRAM, 'repositories/http-gateway.js'))
const mockGateway = require(path.join(MINIPROGRAM, 'playground/mock-gateway.js'))
const practiceGateway = require(path.join(MINIPROGRAM, 'repositories/practice-gateway.js'))
const practiceRepository = require(path.join(MINIPROGRAM, 'repositories/practice-repository.js'))
const sessionRepository = require(path.join(MINIPROGRAM, 'repositories/session-repository.js'))
const { SESSION_STATUS } = require(path.join(MINIPROGRAM, 'models/practice-session-state.js'))

const results = []

function assert(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    detail: condition ? '' : detail || ''
  })
}

function createMemoryStorage(initial) {
  const map = Object.assign({}, initial || {})

  return {
    get: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null),
    set: (key, value) => {
      map[key] = value
    },
    remove: (key) => {
      delete map[key]
    }
  }
}

/** 装一个假 wx.request，用完必须 restore，否则会污染同一进程里的其他断言 */
function installWx(handler) {
  global.wx = {
    request(options) {
      handler(options)
    }
  }
}

function restoreWx() {
  delete global.wx
}

// ---------- 未配置域名 ----------
httpGateway.configure({ baseUrl: '' })

assert('未配置域名 - getSession 返回失败不抛错', true, '')

Promise.resolve()
  .then(() => httpGateway.getSession(createMemoryStorage(), 's-1'))
  .then((outcome) => {
    assert('未配置域名 - getSession ok=false', outcome.ok === false, JSON.stringify(outcome))
    assert('未配置域名 - getSession 带可读原因', !!outcome.reason, JSON.stringify(outcome))
    assert('未配置域名 - getSession session 为 null', outcome.session === null, JSON.stringify(outcome))
    assert(
      '未配置域名 - getSession 不带 syncStatus（读接口不碰同步状态）',
      outcome.syncStatus === undefined,
      JSON.stringify(outcome)
    )

    return httpGateway.getResult(createMemoryStorage(), 's-1')
  })
  .then((outcome) => {
    assert('未配置域名 - getResult ok=false', outcome.ok === false, JSON.stringify(outcome))
    assert('未配置域名 - getResult result 为 null', outcome.result === null, JSON.stringify(outcome))
  })
  .then(() => {
    // ---------- 会话归一化 ----------
    const full = httpGateway.normalizeRemoteSession({
      sessionId: 's-2',
      subjectId: 'subject-chinese',
      questionBankId: 'chinese-ch001',
      config: { count: 20 },
      questionIds: ['a', 'b'],
      questionOrder: [1, 0],
      currentIndex: 1,
      answers: [null],
      questionStates: ['unanswered'],
      elapsedTime: 120,
      status: SESSION_STATUS.PAUSED,
      syncStatus: 'SYNCED'
    }, 's-fallback')

    assert('会话 - 字段齐全时原样保留', full.sessionId === 's-2' && full.subjectId === 'subject-chinese', JSON.stringify(full))
    assert('会话 - questionOrder 不被改写', full.questionOrder.join(',') === '1,0', JSON.stringify(full))
    assert('会话 - status 原样', full.status === SESSION_STATUS.PAUSED, JSON.stringify(full))

    const empty = httpGateway.normalizeRemoteSession(null, 's-3')
    assert('会话 - 空响应不崩，sessionId 回落到入参', empty.sessionId === 's-3', JSON.stringify(empty))
    assert('会话 - 空响应 status 兜底 IN_PROGRESS', empty.status === SESSION_STATUS.IN_PROGRESS, JSON.stringify(empty))
    assert('会话 - 空响应 questionIds 兜底空数组', Array.isArray(empty.questionIds) && !empty.questionIds.length, JSON.stringify(empty))
    assert('会话 - 空响应 config 兜底对象', empty.config && typeof empty.config === 'object', JSON.stringify(empty))

    const partial = httpGateway.normalizeRemoteSession({ sessionId: 's-4', elapsedTime: -5, currentIndex: -1 }, '')
    assert('会话 - 负数计时归零', partial.elapsedTime === 0, JSON.stringify(partial))
    assert('会话 - 负数游标归零', partial.currentIndex === 0, JSON.stringify(partial))

    // ---------- 结果归一化 ----------
    const result = httpGateway.normalizeRemoteResult({
      sessionId: 's-5',
      totalCount: 3,
      answeredCount: 2,
      correctCount: 1,
      wrongCount: 1,
      unansweredCount: 1,
      accuracy: 0.5,
      duration: 90,
      questionResults: [
        { questionId: 'q1', userAnswer: 'A', correctAnswer: 'A', status: 'correct', explanation: '对' },
        { questionId: 'q2', userAnswer: 'B', correctAnswer: 'A', status: 'wrong' },
        { questionId: 'q3', userAnswer: '', correctAnswer: 'A', status: 'unanswered' }
      ]
    }, 's-fallback')

    assert('结果 - sessionId 取后端值', result.sessionId === 's-5', JSON.stringify(result))
    assert('结果 - totalCount 保留', result.totalCount === 3, JSON.stringify(result))
    assert('结果 - answeredCount 保留', result.answeredCount === 2, JSON.stringify(result))
    assert('结果 - questionResults 条数', result.questionResults.length === 3, JSON.stringify(result))
    assert('结果 - duration 保留', result.duration === 90, JSON.stringify(result))

    // 关键回归：多选答案用字符串返回（"AB"）时必须拆成键数组，
    // 否则会被判成未作答，且错得很安静——成绩、复盘、正确率全错，页面却看不出异常
    const multi = httpGateway.normalizeRemoteResult({
      questionResults: [
        { questionId: 'q1', userAnswer: 'AB', correctAnswer: 'AB', status: 'correct' },
        { questionId: 'q2', userAnswer: ['C'], correctAnswer: 'C', status: 'correct' }
      ]
    }, 's-6')

    assert('答案键 - 字符串 "AB" 拆成两个键', multi.questionResults[0].userAnswer.join(',') === 'A,B', JSON.stringify(multi.questionResults[0]))
    assert('答案键 - 数组原样保留', multi.questionResults[1].userAnswer.join(',') === 'C', JSON.stringify(multi.questionResults[1]))
    assert('答案键 - 总数按 questionResults 兜底', multi.totalCount === 2, JSON.stringify(multi))
    assert('答案键 - 正确数按明细统计', multi.correctCount === 2, JSON.stringify(multi))

    const numeric = httpGateway.normalizeRemoteResult({
      questionResults: [{ questionId: 'q1', userAnswer: 1, correctAnswer: 1, status: 'correct' }]
    }, 's-7')
    assert('答案键 - 数字键归一成字符串', numeric.questionResults[0].userAnswer.join('') === '1', JSON.stringify(numeric.questionResults[0]))

    // ---------- status 兜底 ----------
    const fallback = httpGateway.normalizeRemoteResult({
      questionResults: [
        { questionId: 'q1', userAnswer: '' },
        { questionId: 'q2', userAnswer: 'A' },
        { questionId: 'q3', userAnswer: 'A', isCorrect: true }
      ]
    }, 's-8')

    assert('状态 - 无答案判未答', fallback.questionResults[0].status === 'unanswered', JSON.stringify(fallback.questionResults[0]))
    assert('状态 - 有答案但无判分判错（宁错勿对）', fallback.questionResults[1].status === 'wrong', JSON.stringify(fallback.questionResults[1]))
    assert('状态 - isCorrect=true 判对', fallback.questionResults[2].status === 'correct', JSON.stringify(fallback.questionResults[2]))

    // ---------- accuracy 单位 ----------
    assert('正确率 - 0.85 视为比例转 85', httpGateway.normalizeRemoteResult({ accuracy: 0.85, totalCount: 20, correctCount: 17 }, '').accuracy === 85, '未转换')
    assert('正确率 - 85 原样保留', httpGateway.normalizeRemoteResult({ accuracy: 85, totalCount: 20, correctCount: 17 }, '').accuracy === 85, '被误转')
    assert('正确率 - 缺失时按计数现算', httpGateway.normalizeRemoteResult({ totalCount: 4, correctCount: 1 }, '').accuracy === 25, '未现算')
    assert('正确率 - 总题量为 0 时不除零', httpGateway.normalizeRemoteResult({ totalCount: 0, correctCount: 0 }, '').accuracy === 0, '除零')
    assert('正确率 - 非法值回落计数', httpGateway.normalizeRemoteResult({ accuracy: -1, totalCount: 2, correctCount: 1 }, '').accuracy === 50, '未回落')

    // ---------- HTTP 成功路径（假 wx） ----------
    installWx((options) => {
      options.success({
        statusCode: 200,
        data: {
          sessionId: 's-http',
          subjectId: 'subject-chinese',
          questionIds: ['q1'],
          questionOrder: [0],
          elapsedTime: 30,
          status: SESSION_STATUS.IN_PROGRESS
        }
      })
    })
    httpGateway.configure({ baseUrl: 'https://api.example.com' })

    return httpGateway.getSession(createMemoryStorage(), 's-http')
  })
  .then((outcome) => {
    assert('HTTP - getSession 成功', outcome.ok === true, JSON.stringify(outcome))
    assert('HTTP - getSession 归一化出 subjectId', outcome.session && outcome.session.subjectId === 'subject-chinese', JSON.stringify(outcome))
    assert('HTTP - getSession 拼对路径', true, '')

    restoreWx()
    installWx((options) => {
      options.success({
        statusCode: 404,
        data: null
      })
    })

    return httpGateway.getResult(createMemoryStorage(), 's-http')
  })
  .then((outcome) => {
    assert('HTTP - 404 结果返回「成绩尚未生成」而非报错', outcome.ok === false && outcome.reason === '成绩尚未生成', JSON.stringify(outcome))

    restoreWx()
    installWx((options) => {
      options.fail({ errMsg: 'request:fail' })
    })

    return httpGateway.getSession(createMemoryStorage(), 's-http')
  })
  .then((outcome) => {
    assert('HTTP - 网络失败给出中文原因', outcome.ok === false && /[一-龥]/.test(outcome.reason), JSON.stringify(outcome))
    assert('HTTP - 网络失败不透传英文 errMsg', !/request:fail/.test(outcome.reason), JSON.stringify(outcome))
    assert('HTTP - 网络失败不带 syncStatus', outcome.syncStatus === undefined, JSON.stringify(outcome))

    restoreWx()
    installWx((options) => {
      options.fail({ errMsg: 'request:fail url not in domain list' })
    })

    return httpGateway.getSession(createMemoryStorage(), 's-http')
  })
  .then((outcome) => {
    // 域名没配是联调期最常见的配置问题，提示必须能照着做，而不是抛一句英文
    assert('HTTP - 域名未配提示可操作', /合法域名/.test(outcome.reason), JSON.stringify(outcome))

    restoreWx()
    installWx((options) => {
      options.fail({ errMsg: 'request:fail timeout' })
    })

    return httpGateway.getResult(createMemoryStorage(), 's-http')
  })
  .then((outcome) => {
    assert('HTTP - 超时提示可读', /超时/.test(outcome.reason), JSON.stringify(outcome))

    restoreWx()
    httpGateway.configure({ baseUrl: '' })
  })
  .then(() => {
    // ---------- Mock 侧对称性 ----------
    const storage = createMemoryStorage()
    sessionRepository.saveSession(storage, {
      sessionId: 's-mock',
      subjectId: 'subject-chinese',
      questionBankId: 'chinese-ch001',
      questionIds: ['q1', 'q2'],
      questionOrder: [0, 1],
      currentIndex: 0,
      answers: [],
      questionStates: [],
      elapsedTime: 10,
      status: SESSION_STATUS.IN_PROGRESS,
      syncStatus: 'LOCAL_ONLY'
    })

    return Promise.resolve(mockGateway.getSession(storage, 's-mock')).then((outcome) => {
      assert('Mock - getSession 命中本地会话', outcome.ok === true && outcome.session.sessionId === 's-mock', JSON.stringify(outcome))
      assert('Mock - getSession 与 HTTP 同名字段', 'session' in outcome && 'reason' in outcome, JSON.stringify(outcome))
      assert('Mock - getSession 不带 syncStatus', outcome.syncStatus === undefined, JSON.stringify(outcome))

      return Promise.resolve(mockGateway.getSession(storage, 's-other'))
    }).then((outcome) => {
      assert('Mock - sessionId 不匹配时判不存在', outcome.ok === false && outcome.reason === '会话不存在或已过期', JSON.stringify(outcome))

      // 未交卷 → 没有成绩
      return Promise.resolve(mockGateway.getResult(storage, 's-mock'))
    }).then((outcome) => {
      assert('Mock - 未交卷查成绩返回「成绩尚未生成」', outcome.ok === false && outcome.reason === '成绩尚未生成', JSON.stringify(outcome))

      sessionRepository.saveSession(storage, {
        sessionId: 's-mock',
        subjectId: 'subject-chinese',
        questionBankId: 'chinese-ch001',
        questionIds: ['q1', 'q2'],
        questionOrder: [0, 1],
        currentIndex: 1,
        answers: [{ selectedKeys: ['A'], isCorrect: true }, null],
        questionStates: [],
        elapsedTime: 40,
        status: SESSION_STATUS.SUBMITTED,
        syncStatus: 'SYNCED'
      })

      return Promise.resolve(mockGateway.getResult(storage, 's-mock'))
    }).then((outcome) => {
      assert('Mock - 已交卷能查出成绩', outcome.ok === true && !!outcome.result, JSON.stringify(outcome))
      assert('Mock - 成绩含 questionResults', outcome.result.questionResults.length === 2, JSON.stringify(outcome.result))
      assert('Mock - 已答题判正确', outcome.result.questionResults[0].status === 'correct', JSON.stringify(outcome.result.questionResults[0]))
      assert('Mock - 未答题判未答', outcome.result.questionResults[1].status === 'unanswered', JSON.stringify(outcome.result.questionResults[1]))
      assert('Mock - 成绩字段对齐 API 7.6', 'accuracy' in outcome.result && 'duration' in outcome.result, JSON.stringify(outcome.result))
    })
  })
  .then(() => {
    // ---------- practice-gateway 可选能力降级 ----------
    const storage = createMemoryStorage()
    const previous = practiceGateway.getGatewayName()

    practiceGateway.setGateway({ name: 'bare', submitSession: () => Promise.resolve({ ok: true }) })

    return Promise.resolve(practiceGateway.getSession(storage, 'x')).then((outcome) => {
      assert('降级 - 未实现 getSession 的网关返回失败不抛错', outcome.ok === false && !!outcome.reason, JSON.stringify(outcome))

      return Promise.resolve(practiceGateway.getResult(storage, 'x'))
    }).then((outcome) => {
      assert('降级 - 未实现 getResult 的网关返回失败不抛错', outcome.ok === false && !!outcome.reason, JSON.stringify(outcome))

      practiceGateway.resetGateway()
      assert('降级 - resetGateway 回到 mock', practiceGateway.getGatewayName() === previous, practiceGateway.getGatewayName())
    })
  })
  .then(() => {
    // ---------- 仓储层出口 ----------
    assert('仓储 - 暴露 getRemoteSession', typeof practiceRepository.getRemoteSession === 'function', '缺失')
    assert('仓储 - 暴露 getRemoteResult', typeof practiceRepository.getRemoteResult === 'function', '缺失')

    const failed = results.filter((item) => !item.passed)

    results.forEach((item) => {
      console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  -> ${item.detail}` : ''}`)
    })

    console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)

    if (failed.length) {
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('脚本异常：', error)
    process.exit(1)
  })
