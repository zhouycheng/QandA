import { Card, Grid, Skeleton, Statistic, Typography } from '@arco-design/web-react'
import { IconApps, IconBook, IconFile } from '@arco-design/web-react/icon'
import { useQuery } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { useAdminGateway } from '../../gateways/gateway-context'

const { Row, Col } = Grid

export function DashboardPage() {
  const gateway = useAdminGateway()
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => gateway.getDashboardSummary(),
  })

  return (
    <>
      <PageTitle title="数据概览" description="快速了解当前 Playground 的内容规模。" />
      {summary.isError ? (
        <Card><ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <Row gutter={20}>
          {[
            { label: '科目', value: summary.data?.subjectCount, icon: <IconApps />, color: 'blue' },
            { label: '题库', value: summary.data?.questionBankCount, icon: <IconBook />, color: 'purple' },
            { label: '题目', value: summary.data?.questionCount, icon: <IconFile />, color: 'green' },
          ].map((item) => (
            <Col xs={24} md={8} key={item.label}>
              <Card className="stat-card" bordered={false}>
                {summary.isLoading ? (
                  <Skeleton text={{ rows: 2 }} animation />
                ) : (
                  <div className="stat-card-content">
                    <div className={`stat-icon stat-icon-${item.color}`}>{item.icon}</div>
                    <Statistic title={`${item.label}总数`} value={item.value ?? 0} suffix={<Typography.Text type="secondary">个</Typography.Text>} />
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <Card className="dashboard-tip" bordered={false}>
        <Typography.Title heading={5}>管理建议</Typography.Title>
        <Typography.Paragraph type="secondary">
          先创建科目，再建立归属该科目的题库，最后添加单选、多选或判断题。切换右上角 Playground 场景可以验证空数据、失败、延迟和千题性能。
        </Typography.Paragraph>
      </Card>
    </>
  )
}
