import { Card, Space, Tag } from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { LineChart } from '../../components/charts'
import { useAdminGateway } from '../../gateways/gateway-context'
import { dateRange } from '../../lib/format'
import { feedbackStatusLabels } from '../../lib/recommendations'

export function DashboardPage() {
  const gateway = useAdminGateway()
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: () => gateway.getDashboardSummary() })
  const feedback = useQuery({ queryKey: ['feedback'], queryFn: () => gateway.listFeedback() })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const questions = useQuery({ queryKey: ['questions', 'all'], queryFn: () => gateway.listQuestions() })
  const range = dateRange(14)
  const activity = useQuery({
    queryKey: ['activity', range.start, range.end],
    queryFn: () => gateway.getActivity(range),
  })
  const error = summary.error ?? feedback.error ?? banks.error ?? questions.error ?? activity.error
  const pending = feedback.data?.filter((f) => f.status === 'OPEN' || f.status === 'IN_PROGRESS') ?? []
  const drafts = banks.data?.filter((b) => b.publicationStatus === 'DRAFT') ?? []
  const daily = new Map<string, { label: string; value: number }>()
  for (const record of activity.data?.records ?? []) {
    const day = daily.get(record.date) ?? { label: record.date, value: 0 }
    day.value += record.answeredCount
    daily.set(record.date, day)
  }
  const metrics = [
    ['注册用户', summary.data?.userCount, '/users'],
    ['课程', summary.data?.subjectCount, '/subjects'],
    ['已发布题库', banks.data?.filter((b) => b.publicationStatus === 'PUBLISHED').length, '/question-banks'],
    ['题目总量', summary.data?.questionCount, '/questions'],
  ] as const
  return (
    <>
      <PageTitle
        title="运营概览"
        description="先处理学生反馈，再完善复习内容。让同学更快找到合适的题库。"
        action={
          <Link className="primary-link" to="/question-banks">
            进入题库工作台 →
          </Link>
        }
      />
      {error ? (
        <ErrorState
          message={error.message}
          onRetry={() => {
            void summary.refetch()
            void feedback.refetch()
            void banks.refetch()
            void questions.refetch()
            void activity.refetch()
          }}
        />
      ) : (
        <>
          <div className="compact-metrics dashboard-metrics">
            {metrics.map(([label, value, path]) => (
              <Link to={path} key={label}>
                <span>{label}</span>
                <strong>{value === undefined ? '—' : value.toLocaleString()}</strong>
                <small>查看详情 →</small>
              </Link>
            ))}
          </div>
          <div className="dashboard-content-grid">
            <Card bordered={false} title="内容待办" extra={<Link to="/feedback">全部反馈 →</Link>}>
              <div className="todo-grid">
                <Link to="/feedback?kind=QUESTION">
                  <span className="todo-dot orange" />
                  <strong>{pending.filter((f) => f.kind === 'QUESTION').length}</strong>
                  <span>题目反馈</span>
                </Link>
                <Link to="/feedback?kind=COURSE_REQUEST">
                  <span className="todo-dot blue" />
                  <strong>{pending.filter((f) => f.kind === 'COURSE_REQUEST').length}</strong>
                  <span>缺课需求</span>
                </Link>
                <Link to="/question-banks?status=DRAFT">
                  <span className="todo-dot purple" />
                  <strong>{drafts.length}</strong>
                  <span>题库草稿</span>
                </Link>
              </div>
              <h3 className="card-subtitle">最近待处理</h3>
              {pending.slice(0, 4).map((f) => (
                <Link className="task-list-row" key={f.id} to={`/feedback?kind=${f.kind}`}>
                  <div>
                    <strong>{f.title}</strong>
                    <span className="muted">{f.kind === 'QUESTION' ? '题目纠错' : '课程需求'}</span>
                  </div>
                  <Tag color={f.status === 'OPEN' ? 'orange' : 'arcoblue'}>
                    {feedbackStatusLabels[f.status]}
                  </Tag>
                </Link>
              ))}
              {!pending.length && <p className="empty-note">当前没有待处理反馈</p>}
            </Card>
            <Card bordered={false} title="资源整理">
              <p className="muted">优先补齐答案解析，并把题目整理到对应章节。</p>
              <div className="quality-row">
                <span>缺少解析的启用题目</span>
                <strong>
                  {questions.data?.filter((q) => q.status === 'ACTIVE' && !q.explanation.trim()).length ?? 0}{' '}
                  道
                </strong>
              </div>
              <div className="quality-row">
                <span>尚未分章的题目</span>
                <strong>{questions.data?.filter((q) => !q.chapterId).length ?? 0} 道</strong>
              </div>
              <div className="quality-row">
                <span>空题库</span>
                <strong>{banks.data?.filter((b) => b.questionCount === 0).length ?? 0} 份</strong>
              </div>
              <div className="quick-links">
                <Link to="/subjects">维护课程目录 →</Link>
                <Link to="/question-banks">整理章节与题目 →</Link>
                <Link to="/recommendations">检查推荐范围 →</Link>
              </div>
              <div className="workflow-note">
                <strong>建议整理顺序</strong>
                <p>创建课程 → 题库草稿 → 章节与题目 → 推荐范围 → 检查发布</p>
              </div>
            </Card>
          </div>
          <Card
            bordered={false}
            title="近 14 天练习趋势"
            className="section-gap"
            extra={<Link to="/activity">使用统计 →</Link>}
          >
            <LineChart data={[...daily.values()]} label="近14天每日答题量" />
            <Space className="muted">统计来自本地演示记录，正式数据接入后保持相同口径。</Space>
          </Card>
        </>
      )}
    </>
  )
}
