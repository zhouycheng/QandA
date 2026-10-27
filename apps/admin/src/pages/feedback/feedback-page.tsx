import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Message,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { courseRequestStatusLabels, feedbackStatusLabels } from '../../lib/recommendations'
import { formatDate } from '../../lib/format'
import type { FeedbackStatus, StudentFeedback } from '../../types/operations'

export function FeedbackPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') === 'COURSE_REQUEST' ? 'COURSE_REQUEST' : 'QUESTION'
  const statusLabels = kind === 'COURSE_REQUEST' ? courseRequestStatusLabels : feedbackStatusLabels
  const [status, setStatus] = useState<FeedbackStatus>()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string>()
  const [nextStatus, setNextStatus] = useState<FeedbackStatus>('OPEN')
  const [response, setResponse] = useState('')
  const feedback = useQuery({ queryKey: ['feedback'], queryFn: () => gateway.listFeedback() })
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => gateway.listUsers() })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const current = feedback.data?.find((f) => f.id === selected)
  useEffect(() => {
    if (current) {
      setNextStatus(current.status)
      setResponse(current.response)
    }
  }, [current])
  const save = useMutation({
    mutationFn: () => gateway.updateFeedback(selected!, { status: nextStatus, response }),
    onSuccess: () => {
      setSelected(undefined)
      void client.invalidateQueries({ queryKey: ['feedback'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('处理结果已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const error = feedback.error ?? users.error ?? banks.error
  const all = feedback.data ?? []
  const count = (type: StudentFeedback['kind']) =>
    all.filter((f) => f.kind === type && ['OPEN', 'IN_PROGRESS'].includes(f.status)).length
  const rows = all.filter(
    (f) =>
      f.kind === kind &&
      (!status || f.status === status) &&
      `${f.title} ${f.body}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  )
  const changeKind = (value: string) => {
    setParams({ kind: value })
    setStatus(undefined)
    setKeyword('')
  }
  return (
    <>
      <PageTitle
        title="学生反馈"
        description="核实题目问题，整理学生需要的课程，让每一条反馈都有处理结果。"
      />
      <Tabs activeTab={kind} onChange={changeKind} className="feedback-tabs">
        <Tabs.TabPane key="QUESTION" title={`题目纠错 · ${count('QUESTION')} 待处理`} />
        <Tabs.TabPane key="COURSE_REQUEST" title={`缺课需求 · ${count('COURSE_REQUEST')} 待处理`} />
      </Tabs>
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              aria-label="搜索反馈"
              placeholder="搜索标题或反馈内容"
              style={{ width: 280 }}
              value={keyword}
              onChange={setKeyword}
            />
            <Select
              allowClear
              aria-label="反馈状态筛选"
              placeholder="全部状态"
              style={{ width: 160 }}
              value={status}
              onChange={setStatus}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <Select.Option key={value} value={value}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Space>
          <span className="muted">
            共 {rows.length} 条{kind === 'COURSE_REQUEST' ? '课程需求' : '题目反馈'}
          </span>
        </div>
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void feedback.refetch()
              void users.refetch()
              void banks.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={feedback.isLoading || users.isLoading}
            data={rows}
            scroll={{ x: 850 }}
            pagination={{ pageSize: 10, showTotal: true }}
            noDataElement={<Empty description="暂无符合条件的反馈" />}
            columns={[
              {
                title: kind === 'QUESTION' ? '反馈问题' : '需要的课程',
                width: 320,
                render: (_, f) => (
                  <div className="table-cell-stack">
                    <Button type="text" className="table-title-link" onClick={() => setSelected(f.id)}>
                      {f.title}
                    </Button>
                    <span className="muted">
                      {kind === 'QUESTION'
                        ? (banks.data?.find((b) => b.id === f.questionBankId)?.name ?? '原题库已归档')
                        : f.body}
                    </span>
                  </div>
                ),
              },
              {
                title: '提交者',
                width: 120,
                render: (_, f) => users.data?.find((u) => u.id === f.userId)?.name ?? '用户已注销',
              },
              {
                title: '状态',
                width: 110,
                render: (_, f) => (
                  <Tag
                    color={f.status === 'OPEN' ? 'orange' : f.status === 'IN_PROGRESS' ? 'arcoblue' : 'green'}
                  >
                    {statusLabels[f.status]}
                  </Tag>
                ),
              },
              { title: '提交时间', dataIndex: 'createdAt', width: 160, render: formatDate },
              {
                title: '操作',
                width: 100,
                fixed: 'right',
                render: (_, f) => (
                  <Button type="text" onClick={() => setSelected(f.id)}>
                    查看处理
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Drawer
        width={640}
        title={current?.kind === 'QUESTION' ? '核实题目反馈' : '处理课程需求'}
        visible={Boolean(current)}
        onCancel={() => {
          if (!save.isPending) setSelected(undefined)
        }}
        maskClosable={!save.isPending}
        footer={
          <Space>
            <Button disabled={save.isPending} onClick={() => setSelected(undefined)}>
              取消
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
              保存处理结果
            </Button>
          </Space>
        }
      >
        {current && (
          <div className="feedback-detail">
            <h2>{current.title}</h2>
            <Descriptions
              column={1}
              data={[
                {
                  label: '提交者',
                  value: users.data?.find((u) => u.id === current.userId)?.name ?? '用户已注销',
                },
                { label: '提交时间', value: formatDate(current.createdAt) },
                { label: '问题类型', value: current.category },
              ]}
            />
            <div className="feedback-body">{current.body}</div>
            {current.questionSnapshot && (
              <section className="feedback-snapshot">
                <div className="section-heading">
                  <h3>反馈时的原题 · v{current.questionRevision ?? 1}</h3>
                  <Link
                    to={`/questions?questionBankId=${current.questionBankId ?? ''}&edit=${current.questionId ?? ''}`}
                  >
                    核对并编辑原题 →
                  </Link>
                </div>
                <strong>{current.questionSnapshot.stem}</strong>
                {current.questionSnapshot.options.map((o) => (
                  <p key={o.key}>
                    {o.key}．{o.content}
                  </p>
                ))}
                <p>原答案：{current.questionSnapshot.correctAnswer.join('、')}</p>
                <p className="muted">{current.questionSnapshot.explanation || '原题暂无解析'}</p>
                <Link to={`/question-banks/${current.questionBankId}`}>进入题库工作台</Link>
              </section>
            )}
            <Alert
              type="info"
              content="回复会作为学生可查看的处理结果。结束处理时，请说明核实结果或后续安排。"
            />
            <div className="input-label">
              <span>处理状态</span>
              <Select aria-label="处理状态" value={nextStatus} onChange={setNextStatus}>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <Select.Option key={value} value={value}>
                    {label}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <label className="input-label">
              给学生的回复
              <Input.TextArea
                aria-label="给学生的回复"
                value={response}
                onChange={setResponse}
                placeholder="说明核实结果、修正内容或课程整理进度"
                maxLength={2000}
                showWordLimit
                autoSize={{ minRows: 4, maxRows: 8 }}
              />
            </label>
          </div>
        )}
      </Drawer>
    </>
  )
}
