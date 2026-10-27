import { useState } from 'react'
import { Alert, Button, Card, Empty, Message, Select, Table, Tag } from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import {
  audienceLabels,
  isBankAvailable,
  publicationLabels,
  recommendedBanks,
} from '../../lib/recommendations'
import type { CreateQuestionBankInput, QuestionBank } from '../../types/admin'
import { BankEditorDrawer } from '../question-banks/bank-editor-drawer'

export function RecommendationsPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [editing, setEditing] = useState<QuestionBank>()
  const [userId, setUserId] = useState<string>()
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => gateway.listUsers() })
  const colleges = useQuery({ queryKey: ['colleges', 'all'], queryFn: () => gateway.listColleges() })
  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => gateway.listMajors() })
  const save = useMutation({
    mutationFn: (input: CreateQuestionBankInput) => gateway.updateQuestionBank(editing!.id, input),
    onSuccess: () => {
      setEditing(undefined)
      void client.invalidateQueries()
      Message.success('推荐范围已更新')
    },
    onError: (e) => Message.error(e.message),
  })
  const user = users.data?.find((u) => u.id === userId)
  const recommended = user ? recommendedBanks(user, banks.data ?? [], subjects.data ?? []) : []
  const error = banks.error ?? subjects.error ?? users.error ?? colleges.error ?? majors.error
  const describe = (bank: QuestionBank) =>
    audienceLabels(bank, colleges.data ?? [], majors.data ?? []).join('；') || '尚未设置'
  return (
    <>
      <PageTitle
        title="适用范围与推荐"
        description="帮助学生发现合适的内容。学生可自由搜索、选择其他专业的已发布题库。"
      />
      <Alert
        className="section-gap"
        type="info"
        content="推荐范围只影响默认推荐；“我的课程”由学生自己维护，后台不分配课程或屏蔽个人访问。"
      />
      {error ? (
        <ErrorState
          message={error.message}
          onRetry={() => {
            void banks.refetch()
            void subjects.refetch()
            void users.refetch()
            void colleges.refetch()
            void majors.refetch()
          }}
        />
      ) : (
        <div className="recommendation-layout">
          <Card bordered={false} title="题库适用范围">
            <Table
              rowKey="id"
              loading={banks.isLoading}
              data={banks.data ?? []}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 650 }}
              columns={[
                {
                  title: '共享题库',
                  width: 210,
                  render: (_, b) => (
                    <div className="table-cell-stack">
                      <Link to={`/question-banks/${b.id}`}>{b.name}</Link>
                      <span className="muted">{publicationLabels[b.publicationStatus]}</span>
                    </div>
                  ),
                },
                { title: '推荐对象', render: (_, b) => <span>{describe(b)}</span> },
                {
                  title: '操作',
                  width: 90,
                  render: (_, b) => (
                    <Button type="text" onClick={() => setEditing(b)}>
                      设置
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
          <Card bordered={false} title="预览学生推荐" className="recommendation-preview">
            <p className="muted">选取一位用户，核对当前资料下的推荐结果。</p>
            <Select
              showSearch
              allowClear
              placeholder="选择用户预览"
              aria-label="选择用户预览推荐"
              value={userId}
              onChange={setUserId}
            >
              {users.data?.map((u) => (
                <Select.Option key={u.id} value={u.id}>
                  {u.name}
                  {u.majorId ? '' : '（资料未完善）'}
                </Select.Option>
              ))}
            </Select>
            {user ? (
              <>
                <div className="profile-summary">
                  <strong>{user.name}</strong>
                  <span>
                    {majors.data?.find((m) => m.id === user.majorId)?.name || '未填写专业'}
                    {user.enrollmentYear ? ` · ${user.enrollmentYear} 级` : ''}
                  </span>
                </div>
                {user.status !== 'ACTIVE' && (
                  <Alert type="warning" content="该账号当前不可使用平台，下方仅预览其资料匹配结果。" />
                )}
                <div className="preview-count">
                  <strong>{new Set(recommended.map((b) => b.subjectId)).size}</strong> 门推荐课程{' '}
                  <span className="muted">/ {recommended.length} 份题库</span>
                </div>
                {recommended.length ? (
                  [...new Set(recommended.map((b) => b.subjectId))].map((id) => (
                    <div className="preview-course" key={id}>
                      <strong>{subjects.data?.find((s) => s.id === id)?.name}</strong>
                      {recommended
                        .filter((b) => b.subjectId === id)
                        .map((b) => (
                          <div key={b.id}>
                            <Link to={`/question-banks/${b.id}`}>{b.name}</Link>
                            <Tag size="small" color="arcoblue">
                              {b.scopeType === 'ALL' ? '全校适用' : '资料匹配'}
                            </Tag>
                          </div>
                        ))}
                    </div>
                  ))
                ) : (
                  <Empty description="暂无匹配的已发布题库" />
                )}
                <p className="muted">
                  仍可搜索全部{' '}
                  {banks.data?.filter((b) => isBankAvailable(b, subjects.data ?? [])).length ?? 0}{' '}
                  份可用题库，不受推荐结果限制。
                </p>
              </>
            ) : (
              <Empty description="选择用户后查看推荐结果" />
            )}
          </Card>
        </div>
      )}
      <BankEditorDrawer
        visible={Boolean(editing)}
        bank={editing}
        subjects={subjects.data ?? []}
        saving={save.isPending}
        onClose={() => setEditing(undefined)}
        onSave={(input) => save.mutate(input)}
      />
    </>
  )
}
