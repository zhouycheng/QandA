import { useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { formatDate } from '../../lib/format'
import type { LogQuery, OperationLog } from '../../types/operations'
const modules = [
  '题库工作台',
  '学院管理',
  '专业管理',
  '课程管理',
  '题目管理',
  '章节管理',
  '题库发布',
  '学生反馈',
  '公告',
  '用户管理',
  '管理员账号',
  '安全设置',
]
export function LogsPage() {
  const gateway = useAdminGateway()
  const [draft, setDraft] = useState<LogQuery>({})
  const [query, setQuery] = useState<LogQuery>({})
  const [detail, setDetail] = useState<OperationLog>()
  const logs = useQuery({ queryKey: ['logs', query], queryFn: () => gateway.listOperationLogs(query) })
  const fields = (log: OperationLog) => [
    { label: '操作时间', value: formatDate(log.createdAt) },
    { label: '操作人', value: log.actor },
    { label: '模块', value: log.module },
    { label: '操作内容', value: log.content },
    { label: '结果', value: log.result === 'SUCCESS' ? '成功' : '失败' },
    { label: 'IP 来源', value: log.ip },
  ]
  return (
    <>
      <PageTitle title="操作日志" description="查看后台关键操作记录" />
      <Card bordered={false} className="filter-card">
        <Space wrap>
          <DatePicker.RangePicker
            placeholder={['开始日期', '结束日期']}
            value={draft.start && draft.end ? [draft.start, draft.end] : []}
            onChange={(v) => setDraft((s) => ({ ...s, start: v[0], end: v[1] }))}
          />
          <Input.Search
            allowClear
            placeholder="搜索操作人或关键词"
            style={{ width: 240 }}
            value={draft.keyword ?? ''}
            onChange={(v) => setDraft((s) => ({ ...s, keyword: v }))}
            onSearch={() => setQuery(draft)}
          />
          <Select
            allowClear
            placeholder="全部模块"
            value={draft.module}
            onChange={(v) => setDraft((s) => ({ ...s, module: v }))}
            style={{ width: 160 }}
          >
            {modules.map((m) => (
              <Select.Option key={m} value={m}>
                {m}
              </Select.Option>
            ))}
          </Select>
          <Select
            allowClear
            placeholder="全部结果"
            value={draft.result}
            onChange={(v) => setDraft((s) => ({ ...s, result: v }))}
            style={{ width: 130 }}
          >
            <Select.Option value="SUCCESS">成功</Select.Option>
            <Select.Option value="FAILURE">失败</Select.Option>
          </Select>
          <Button type="primary" onClick={() => setQuery({ ...draft })}>
            查询
          </Button>
          <Button
            onClick={() => {
              setDraft({})
              setQuery({})
            }}
          >
            重置
          </Button>
        </Space>
      </Card>
      <Card bordered={false}>
        {logs.isError ? (
          <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />
        ) : (
          <Table
            rowKey="id"
            data={logs.data ?? []}
            loading={logs.isLoading}
            noDataElement={
              <div className="empty-note">暂无操作记录。完成新增、修改或导入后，可在这里查看。</div>
            }
            scroll={{ x: 1020 }}
            pagination={{ pageSize: 10, showTotal: true, sizeCanChange: true }}
            columns={[
              { title: '操作时间', dataIndex: 'createdAt', width: 180, render: formatDate },
              { title: '操作人', dataIndex: 'actor', width: 150 },
              { title: '模块', dataIndex: 'module', width: 150 },
              { title: '操作内容', dataIndex: 'content', width: 340 },
              {
                title: '结果',
                dataIndex: 'result',
                width: 100,
                render: (v) => (
                  <Tag color={v === 'SUCCESS' ? 'green' : 'red'}>{v === 'SUCCESS' ? '成功' : '失败'}</Tag>
                ),
              },
              { title: 'IP 来源', dataIndex: 'ip', width: 120 },
              {
                title: '操作',
                width: 90,
                render: (_, l) => (
                  <Button type="text" onClick={() => setDetail(l)}>
                    查看
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title="操作日志详情"
        visible={Boolean(detail)}
        footer={null}
        onCancel={() => setDetail(undefined)}
      >
        <Descriptions border column={1} data={detail ? fields(detail) : []} />
      </Modal>
    </>
  )
}
