import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Message,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { isBankAvailable, recommendedBanks } from '../../lib/recommendations'
import { formatDate } from '../../lib/format'
import type { ManagedUser, UserStatus } from '../../types/operations'

export const userStatusLabels = { ACTIVE: '正常', PENDING: '待激活', DISABLED: '已停用' }

export function UsersPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [collegeId, setCollegeId] = useState<string>()
  const [majorId, setMajorId] = useState<string>()
  const [status, setStatus] = useState<UserStatus>()
  const [selected, setSelected] = useState<string>()
  const users = useQuery({
    queryKey: ['users', keyword, collegeId, majorId, status],
    queryFn: () => gateway.listUsers({ keyword, collegeId, majorId, status }),
  })
  const colleges = useQuery({ queryKey: ['colleges', 'all'], queryFn: () => gateway.listColleges() })
  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => gateway.listMajors() })
  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const courses = useQuery({ queryKey: ['user-courses'], queryFn: () => gateway.listUserCourses() })
  const changeStatus = useMutation({
    mutationFn: (user: ManagedUser) =>
      gateway.setUserStatus(user.id, user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['users'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('账号状态已更新')
    },
    onError: (e) => Message.error(e.message),
  })
  const user = users.data?.find((u) => u.id === selected)
  const chosen = courses.data?.filter((c) => c.userId === selected) ?? []
  const recommendations = user ? recommendedBanks(user, banks.data ?? [], subjects.data ?? []) : []
  const error =
    users.error ?? colleges.error ?? majors.error ?? subjects.error ?? banks.error ?? courses.error
  return (
    <>
      <PageTitle title="注册用户" description="查看学生自填资料、自主选择的课程和使用情况，处理异常账号。" />
      <Card bordered={false} className="filter-card">
        <div className="filter-grid">
          <Input.Search
            allowClear
            aria-label="搜索用户"
            placeholder="搜索昵称、账号或邮箱"
            value={keyword}
            onChange={setKeyword}
          />
          <Select
            allowClear
            placeholder="全部学院"
            value={collegeId}
            onChange={(value) => {
              setCollegeId(value)
              setMajorId(undefined)
            }}
          >
            {colleges.data?.map((c) => (
              <Select.Option key={c.id} value={c.id}>
                {c.name}
              </Select.Option>
            ))}
          </Select>
          <Select allowClear placeholder="全部专业" value={majorId} onChange={setMajorId}>
            {majors.data
              ?.filter((m) => !collegeId || m.collegeId === collegeId)
              .map((m) => (
                <Select.Option key={m.id} value={m.id}>
                  {m.name}
                </Select.Option>
              ))}
          </Select>
          <Select allowClear placeholder="账号状态" value={status} onChange={setStatus}>
            {Object.entries(userStatusLabels).map(([value, label]) => (
              <Select.Option key={value} value={value}>
                {label}
              </Select.Option>
            ))}
          </Select>
        </div>
      </Card>
      <Card bordered={false}>
        <p className="table-tip">学生自主注册，院系资料可选填；资料不完整也能正常查找题库、开始练习。</p>
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void users.refetch()
              void colleges.refetch()
              void majors.refetch()
              void subjects.refetch()
              void banks.refetch()
              void courses.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            data={users.data ?? []}
            loading={users.isLoading || courses.isLoading}
            scroll={{ x: 1050 }}
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              {
                title: '用户',
                width: 160,
                render: (_, u) => (
                  <div className="table-cell-stack">
                    <strong>{u.name}</strong>
                    <span className="muted">{u.account}</span>
                  </div>
                ),
              },
              {
                title: '自填院系 / 入学年份',
                width: 250,
                render: (_, u) => (
                  <div>
                    {majors.data?.find((m) => m.id === u.majorId)?.name || '未填写专业'}
                    <div className="muted">
                      {colleges.data?.find((c) => c.id === u.collegeId)?.name || '院系资料未完善'}
                      {u.enrollmentYear ? ` · ${u.enrollmentYear} 级` : ''}
                    </div>
                  </div>
                ),
              },
              {
                title: '自主加入课程',
                width: 130,
                render: (_, u) => `${courses.data?.filter((c) => c.userId === u.id).length ?? 0} 门`,
              },
              {
                title: '累计刷题',
                dataIndex: 'answeredCount',
                width: 120,
                render: (value) => `${value.toLocaleString()} 道`,
              },
              { title: '最近活跃', dataIndex: 'lastActiveAt', width: 170, render: formatDate },
              {
                title: '账号状态',
                width: 100,
                render: (_, u) => (
                  <Tag color={u.status === 'ACTIVE' ? 'green' : 'gray'}>{userStatusLabels[u.status]}</Tag>
                ),
              },
              {
                title: '操作',
                width: 170,
                fixed: 'right',
                render: (_, u) => (
                  <Space size="mini">
                    <Button type="text" onClick={() => setSelected(u.id)}>
                      查看详情
                    </Button>
                    <Popconfirm
                      title={
                        u.status === 'ACTIVE' ? '停用后该账号暂不能使用平台，确认停用？' : '确认恢复该账号？'
                      }
                      onOk={() => changeStatus.mutate(u)}
                    >
                      <Button
                        type="text"
                        status={u.status === 'ACTIVE' ? 'danger' : 'success'}
                        disabled={changeStatus.isPending}
                      >
                        {u.status === 'ACTIVE' ? '停用' : '恢复'}
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Drawer
        width={620}
        title="用户使用详情"
        visible={Boolean(user)}
        footer={null}
        onCancel={() => setSelected(undefined)}
      >
        {user && (
          <>
            <div className="profile-summary">
              <strong>{user.name}</strong>
              <span>学生自主注册 · {userStatusLabels[user.status]}</span>
            </div>
            <Descriptions
              column={1}
              data={[
                { label: '账号', value: user.account },
                { label: '邮箱', value: user.email || '未绑定' },
                {
                  label: '学院',
                  value: colleges.data?.find((c) => c.id === user.collegeId)?.name || '未填写',
                },
                { label: '专业', value: majors.data?.find((m) => m.id === user.majorId)?.name || '未填写' },
                { label: '入学年份', value: user.enrollmentYear ?? '未填写' },
                { label: '注册时间', value: formatDate(user.registeredAt ?? '') },
              ]}
            />
            <h3>我的课程 · {chosen.length} 门</h3>
            <p className="muted">以下课程由学生自行选择，后台仅查看。</p>
            {chosen.length ? (
              chosen.map((c) => (
                <div className="preview-course" key={c.subjectId}>
                  <strong>{subjects.data?.find((s) => s.id === c.subjectId)?.name ?? '课程已归档'}</strong>
                  <div className="muted">
                    常用题库：{banks.data?.find((b) => b.id === c.preferredBankId)?.name ?? '尚未选择'}
                  </div>
                </div>
              ))
            ) : (
              <Empty description="尚未加入课程，仍可直接选择题库练习" />
            )}
            <h3>按当前资料推荐</h3>
            {recommendations.length ? (
              recommendations.map((b) => (
                <p key={b.id}>
                  <Link to={`/question-banks/${b.id}`}>{b.name}</Link>{' '}
                  <Tag size="small">{b.scopeType === 'ALL' ? '全校适用' : '资料匹配'}</Tag>
                </p>
              ))
            ) : (
              <p className="muted">暂无匹配内容，可在全部课程中搜索。</p>
            )}
            <Alert
              type="info"
              content={`推荐不限制访问。正常账号可查找全部 ${banks.data?.filter((b) => isBankAvailable(b, subjects.data ?? [])).length ?? 0} 份可用题库。修改院系资料不会移除已加入课程。`}
            />
          </>
        )}
      </Drawer>
    </>
  )
}
