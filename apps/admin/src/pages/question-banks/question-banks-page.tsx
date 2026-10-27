import { useState } from 'react'
import {
  Button,
  Card,
  Empty,
  Input,
  Message,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { IconPlus } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { useAdminGateway } from '../../gateways/gateway-context'
import { publicationColors, publicationLabels } from '../../lib/recommendations'
import { formatDate } from '../../lib/format'
import type { BankPublicationStatus, CreateQuestionBankInput, QuestionBank } from '../../types/admin'
import { BankEditorDrawer } from './bank-editor-drawer'

export function QuestionBanksPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const subjectId = params.get('subjectId') ?? undefined
  const [keyword, setKeyword] = useState('')
  const status = (
    params.get('status') && params.get('status')! in publicationLabels ? params.get('status') : undefined
  ) as BankPublicationStatus | undefined
  const setStatus = (value?: BankPublicationStatus) => {
    const next = new URLSearchParams(params)
    if (value) next.set('status', value)
    else next.delete('status')
    setParams(next)
  }
  const [editing, setEditing] = useState<QuestionBank | null | undefined>()
  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const save = useMutation({
    mutationFn: (input: CreateQuestionBankInput) =>
      editing ? gateway.updateQuestionBank(editing.id, input) : gateway.createQuestionBank(input),
    onSuccess: () => {
      setEditing(undefined)
      void client.invalidateQueries()
      Message.success('题库已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => gateway.deleteQuestionBank(id),
    onSuccess: () => {
      void client.invalidateQueries()
      Message.success('空题库已删除')
    },
    onError: (e) => Message.error(e.message),
  })
  const all = banks.data ?? []
  const filtered = all.filter(
    (b) =>
      (!subjectId || b.subjectId === subjectId) &&
      (!status || b.publicationStatus === status) &&
      `${b.name} ${b.textbook}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  )
  const error = banks.error ?? subjects.error
  return (
    <>
      <PageTitle
        title="共享题库"
        description="同一份内容供多个专业复用，学生按需选择。先整理内容，再检查发布。"
        action={
          <Button
            type="primary"
            icon={<IconPlus />}
            disabled={!subjects.data?.length}
            onClick={() => setEditing(null)}
          >
            新建题库
          </Button>
        }
      />
      <div className="compact-metrics">
        <div>
          <span>全部题库</span>
          <strong>{all.length}</strong>
        </div>
        <div>
          <span>已发布</span>
          <strong>{all.filter((b) => b.publicationStatus === 'PUBLISHED').length}</strong>
        </div>
        <div>
          <span>草稿待整理</span>
          <strong>{all.filter((b) => b.publicationStatus === 'DRAFT').length}</strong>
        </div>
        <div>
          <span>全校共享</span>
          <strong>{all.filter((b) => b.scopeType === 'ALL').length}</strong>
        </div>
      </div>
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索题库或教材"
              aria-label="搜索题库"
              style={{ width: 240 }}
              onChange={setKeyword}
            />
            <Select
              allowClear
              placeholder="全部课程"
              aria-label="按课程筛选"
              value={subjectId}
              style={{ width: 180 }}
              onChange={(id) => {
                const next = new URLSearchParams(params)
                if (id) next.set('subjectId', id)
                else next.delete('subjectId')
                setParams(next)
              }}
            >
              {subjects.data?.map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name}
                </Select.Option>
              ))}
            </Select>
            <Select
              allowClear
              placeholder="全部发布状态"
              aria-label="按发布状态筛选"
              value={status}
              onChange={setStatus}
              style={{ width: 150 }}
            >
              {Object.entries(publicationLabels).map(([value, label]) => (
                <Select.Option key={value} value={value}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Space>
          <span className="muted">共 {filtered.length} 个题库</span>
        </div>
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void banks.refetch()
              void subjects.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            data={filtered}
            loading={banks.isLoading || subjects.isLoading}
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 10, showTotal: true }}
            noDataElement={
              <Empty
                description={
                  subjects.data?.length ? (
                    '暂无题库，先创建草稿再整理内容'
                  ) : (
                    <span>
                      请先到<Link to="/subjects">课程目录</Link>创建课程
                    </span>
                  )
                }
              />
            }
            columns={[
              {
                title: '题库 / 课程',
                width: 270,
                render: (_, b) => (
                  <div className="table-cell-stack">
                    <Link className="entity-link" to={`/question-banks/${b.id}`}>
                      {b.name}
                    </Link>
                    <span className="muted">
                      {subjects.data?.find((s) => s.id === b.subjectId)?.name ?? '未知课程'} ·{' '}
                      {b.textbook || '教材待补充'}
                    </span>
                  </div>
                ),
              },
              {
                title: '适用范围',
                width: 150,
                render: (_, b) => (
                  <Tag color={b.scopeType === 'ALL' ? 'cyan' : 'arcoblue'}>
                    {b.scopeType === 'ALL' ? '全校适用' : `${b.audiences.length} 条推荐条件`}
                  </Tag>
                ),
              },
              {
                title: '题目',
                width: 110,
                render: (_, b) => (
                  <div>
                    {b.questionCount} 道<div className="muted">{b.activeQuestionCount ?? 0} 道启用</div>
                  </div>
                ),
              },
              {
                title: '发布状态',
                width: 110,
                render: (_, b) => (
                  <Tag color={publicationColors[b.publicationStatus]}>
                    {publicationLabels[b.publicationStatus]}
                  </Tag>
                ),
              },
              { title: '最近更新', width: 150, dataIndex: 'updatedAt', render: formatDate },
              {
                title: '操作',
                width: 210,
                fixed: 'right',
                render: (_, b) => (
                  <Space size="mini">
                    <Link to={`/question-banks/${b.id}`}>管理内容</Link>
                    <Button type="text" onClick={() => setEditing(b)}>
                      编辑
                    </Button>
                    {b.questionCount === 0 && (
                      <Popconfirm
                        title="确认删除空题库？已有引用的内容会受到保护。"
                        onOk={() => remove.mutate(b.id)}
                      >
                        <Button type="text" status="danger">
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <BankEditorDrawer
        visible={editing !== undefined}
        bank={editing ?? undefined}
        subjects={subjects.data ?? []}
        defaultSubjectId={subjectId}
        saving={save.isPending}
        onClose={() => setEditing(undefined)}
        onSave={(input) => save.mutate(input)}
      />
    </>
  )
}
