import { useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Drawer,
  Radio,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { BarChart, DonutChart, LineChart } from '../../components/charts'
import { useAdminGateway } from '../../gateways/gateway-context'
import { dateRange, formatDate } from '../../lib/format'
import type { LoginPlatform } from '../../types/operations'

export function ActivityPage() {
  const gateway = useAdminGateway()
  const [days, setDays] = useState(30)
  const [range, setRange] = useState(dateRange(30))
  const [platform, setPlatform] = useState<LoginPlatform>()
  const [ranking, setRanking] = useState(false)
  const stats = useQuery({
    queryKey: ['activity', range, platform],
    queryFn: () => gateway.getActivity({ ...range, platform }),
  })
  const daily = new Map<
    string,
    { label: string; value: number; users: Set<string>; newUsers: number; returningUsers: number }
  >()
  const hours = [0, 0, 0, 0, 0]
  const platforms = { MINIAPP: 0, WEB: 0 }
  for (const r of stats.data?.records ?? []) {
    const d = daily.get(r.date) ?? {
      label: r.date,
      value: 0,
      users: new Set<string>(),
      newUsers: 0,
      returningUsers: 0,
    }
    r.userIds.forEach((id) => d.users.add(id))
    d.value = d.users.size
    d.newUsers += r.newUsers
    d.returningUsers += r.returningUsers
    daily.set(r.date, d)
    r.hours.forEach((n, i) => (hours[i] += n))
    platforms[r.platform] += r.userIds.length
  }
  return (
    <>
      <PageTitle title="活跃度" description="观察用户访问和答题行为趋势" />
      <Card bordered={false} className="filter-card">
        <Space wrap>
          <Radio.Group
            type="button"
            value={days}
            onChange={(v) => {
              setDays(v)
              setRange(dateRange(v))
            }}
          >
            {[7, 30, 90].map((d) => (
              <Radio key={d} value={d}>
                近{d}天
              </Radio>
            ))}
          </Radio.Group>
          <DatePicker.RangePicker
            allowClear={false}
            value={[range.start, range.end]}
            onChange={(v) => {
              if (v.length === 2) {
                setRange({ start: v[0], end: v[1] })
                setDays(0)
              }
            }}
          />
          <Select
            aria-label="登录端"
            allowClear
            placeholder="全部登录端"
            value={platform}
            onChange={setPlatform}
            style={{ width: 150 }}
          >
            <Select.Option value="MINIAPP">小程序</Select.Option>
            <Select.Option value="WEB">用户 Web</Select.Option>
          </Select>
          <Button onClick={() => setRanking(true)}>用户活跃榜</Button>
          <Tag color="arcoblue">示意数据</Tag>
        </Space>
      </Card>
      {stats.isError ? (
        <ErrorState message={stats.error.message} onRetry={() => void stats.refetch()} />
      ) : stats.isLoading ? (
        <Skeleton text={{ rows: 12 }} animation />
      ) : (
        <>
          <div className="stats-grid four">
            {[
              ['日活用户', stats.data?.dailyActive],
              ['周活用户', stats.data?.weeklyActive],
              ['月活用户', stats.data?.monthlyActive],
              ['7日留存率', `${stats.data?.retention ?? 0}%`],
            ].map(([label, value]) => (
              <Card key={label} bordered={false} className="stat-card">
                <span>{label}</span>
                <strong className="stat-number">{value ?? 0}</strong>
                <span className="muted">
                  截至 {range.end}
                  {label === '7日留存率' ? ' · 相邻两周用户交集' : ' · 去重人数'}
                </span>
              </Card>
            ))}
          </div>
          <div className="activity-grid">
            <Card title="每日活跃用户" bordered={false} extra="单位：人">
              <LineChart data={[...daily.values()]} label="每日去重活跃用户" />
            </Card>
            <Card title="登录端分布" bordered={false}>
              <DonutChart
                values={[platforms.MINIAPP, platforms.WEB]}
                labels={['小程序', '用户 Web']}
                center={String(platforms.MINIAPP + platforms.WEB)}
                caption="访问人次"
              />
            </Card>
            <Card title="常用上线时段" bordered={false} extra="单位：人次">
              <BarChart
                data={hours.map((value, i) => ({
                  label: ['06–09', '09–12', '12–18', '18–21', '21–24'][i],
                  value,
                }))}
                label="常用上线时段分布"
              />
            </Card>
            <Card
              title="活跃用户变化"
              bordered={false}
              extra={<span className="muted">新用户 / 回流用户 · 人次</span>}
            >
              <BarChart
                data={[...daily.values()]
                  .slice(-7)
                  .map((d) => ({ label: d.label.slice(5), value: d.newUsers, secondary: d.returningUsers }))}
                label="近7天新用户和回流用户"
              />
            </Card>
          </div>
        </>
      )}
      <Drawer
        title="用户活跃排行榜"
        width={580}
        visible={ranking}
        onCancel={() => setRanking(false)}
        footer={null}
      >
        <p className="muted">
          {range.start} 至 {range.end} · 按活跃天数排序
        </p>
        <Table
          rowKey="id"
          data={stats.data?.ranking ?? []}
          loading={stats.isLoading}
          pagination={{ pageSize: 10, showTotal: true }}
          columns={[
            {
              title: '排名',
              width: 60,
              render: (_, __, i) => <Tag color={i < 3 ? 'orange' : 'gray'}>{i + 1}</Tag>,
            },
            {
              title: '用户',
              render: (_, u) => (
                <>
                  <strong>{u.name}</strong>
                  <div className="muted">{u.account}</div>
                </>
              ),
            },
            { title: '活跃天数', dataIndex: 'activeDays', render: (v) => `${v}天` },
            { title: '刷题数', dataIndex: 'answeredCount', render: (v) => `${v}道` },
            { title: '最近活跃', dataIndex: 'lastActiveAt', render: formatDate },
          ]}
        />
      </Drawer>
    </>
  )
}
