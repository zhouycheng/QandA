import { Card, Space, Tag } from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { LineChart } from '../../components/charts'
import { useAdminGateway } from '../../gateways/gateway-context'
import { dateRange } from '../../lib/format'
import { feedbackStatusLabels } from '../../lib/recommendations'
import { countQuestions, missingExplanations } from '../../lib/question-content'

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
    ['注册用户', summary.data?.userCount],
    ['课程', summary.data?.subjectCount],
    ['已发布题库', banks.data?.filter((b) => b.publicationStatus === 'PUBLISHED').length],
    ['题目总量', summary.data?.questionCount],
  ] as const
  return (
    <section aria-label="运营概览">
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
            {metrics.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value === undefined ? '—' : value.toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <div className="dashboard-content-grid">
            <Card bordered={false} title="内容待办">
              <div className="todo-grid">
                <div>
                  <span className="todo-dot orange" />
                  <strong>{pending.filter((f) => f.kind === 'QUESTION').length}</strong>
                  <span>题目反馈</span>
                </div>
                <div>
                  <span className="todo-dot blue" />
                  <strong>{pending.filter((f) => f.kind === 'COURSE_REQUEST').length}</strong>
                  <span>缺课需求</span>
                </div>
                <div>
                  <span className="todo-dot purple" />
                  <strong>{drafts.length}</strong>
                  <span>题库草稿</span>
                </div>
              </div>
              <h3 className="card-subtitle">最近待处理</h3>
              {pending.slice(0, 4).map((f) => (
                <div className="task-list-row" key={f.id}>
                  <div>
                    <strong>{f.title}</strong>
                    <span className="muted">{f.kind === 'QUESTION' ? '题目纠错' : '课程需求'}</span>
                  </div>
                  <Tag color={f.status === 'OPEN' ? 'orange' : 'arcoblue'}>
                    {feedbackStatusLabels[f.status]}
                  </Tag>
                </div>
              ))}
              {!pending.length && <p className="empty-note">当前没有待处理反馈</p>}
            </Card>
            <Card bordered={false} title="资源整理">
              <p className="muted">优先补齐答案解析，并把题目整理到对应章节。</p>
              <div className="quality-row">
                <span>缺少解析的启用题目</span>
                <strong>
                  {missingExplanations(questions.data?.filter((q) => q.status === 'ACTIVE') ?? [])}{' '}
                  道
                </strong>
              </div>
              <div className="quality-row">
                <span>尚未分章的题目</span>
                <strong>{countQuestions(questions.data?.filter((q) => !q.chapterId) ?? [])} 道</strong>
              </div>
              <div className="quality-row">
                <span>空题库</span>
                <strong>{banks.data?.filter((b) => b.questionCount === 0).length ?? 0} 份</strong>
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
          >
            <LineChart data={[...daily.values()]} label="近14天每日答题量" />
            <Space className="muted">统计来自本地演示记录，正式数据接入后保持相同口径。</Space>
          </Card>
        </>
      )}
    </section>
  )
}
