import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { formatDate } from '../../lib/format'
import { getAdminSession } from '../../lib/auth'
import type { AdminAccount, AdminAccountInput } from '../../types/operations'

export function AdminsPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [form] = Form.useForm<AdminAccountInput>()
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [editing, setEditing] = useState<AdminAccount | null | undefined>()
  const accounts = useQuery({ queryKey: ['admins'], queryFn: () => gateway.listAdminAccounts() })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admins'] })
    void client.invalidateQueries({ queryKey: ['logs'] })
  }
  const save = useMutation({
    mutationFn: (input: AdminAccountInput) => gateway.saveAdminAccount(editing?.id, input),
    onSuccess: () => {
      setEditing(undefined)
      refresh()
      Message.success('管理员账号已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => gateway.deleteAdminAccount(id),
    onSuccess: () => {
      refresh()
      Message.success('账号已删除')
    },
    onError: (e) => Message.error(e.message),
  })
  const open = (account: AdminAccount | null) => {
    form.resetFields()
    form.setFieldsValue(account ? { ...account, password: '' } : { status: 'ACTIVE' })
    setEditing(account)
  }
  return (
    <>
      <PageTitle
        title="管理员账号"
        description="维护可登录后台的管理员账号"
        action={
          <Button type="primary" onClick={() => open(null)}>
            新增账号
          </Button>
        }
      />
      <p className="muted">
        管理员账号 {accounts.data?.length ?? 0} 个 · 启用{' '}
        {accounts.data?.filter((a) => a.status === 'ACTIVE').length ?? 0} · 停用{' '}
        {accounts.data?.filter((a) => a.status === 'INACTIVE').length ?? 0}
      </p>
      <Card bordered={false} className="filter-card">
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索姓名或登录账号"
            value={keyword}
            onChange={setKeyword}
            style={{ width: 320 }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={status}
            onChange={setStatus}
            style={{ width: 200 }}
          >
            <Select.Option value="ACTIVE">启用</Select.Option>
            <Select.Option value="INACTIVE">停用</Select.Option>
          </Select>
        </Space>
      </Card>
      <Card bordered={false}>
        {accounts.isError ? (
          <ErrorState message={accounts.error.message} onRetry={() => void accounts.refetch()} />
        ) : (
          <Table
            rowKey="id"
            data={
              accounts.data?.filter(
                (a) =>
                  (!status || a.status === status) &&
                  `${a.name} ${a.username}`.toLowerCase().includes(keyword.trim().toLowerCase()),
              ) ?? []
            }
            loading={accounts.isLoading}
            pagination={{ pageSize: 10, showTotal: true }}
            scroll={{ x: 960 }}
            columns={[
              { title: '管理员姓名', dataIndex: 'name' },
              { title: '登录账号', dataIndex: 'username' },
              { title: '创建时间', dataIndex: 'createdAt', render: formatDate },
              { title: '最近登录', dataIndex: 'lastLoginAt', render: formatDate },
              {
                title: '状态',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'ACTIVE' ? 'green' : 'gray'}>{v === 'ACTIVE' ? '启用' : '停用'}</Tag>
                ),
              },
              {
                title: '操作',
                width: 200,
                render: (_, a) => (
                  <Space>
                    <Button type="text" onClick={() => open(a)}>
                      编辑
                    </Button>
                    <Popconfirm title="确认删除该管理员账号？" onOk={() => remove.mutate(a.id)}>
                      <Button type="text" status="danger" disabled={a.id === getAdminSession()?.id}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title={editing ? '编辑管理员' : '新增管理员账号'}
        visible={editing !== undefined}
        onCancel={() => {
          if (!save.isPending) setEditing(undefined)
        }}
        cancelButtonProps={{ disabled: save.isPending }}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="保存账号"
        unmountOnExit
      >
        <Form form={form} layout="vertical" onSubmit={(v) => save.mutate(v)}>
          <Form.Item field="name" label="管理员姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item
            field="username"
            label="登录账号"
            rules={[
              { required: true, message: '请输入登录账号' },
              { match: /^[A-Za-z0-9_-]{3,30}$/, message: '需为 3 至 30 位字母、数字、短横线或下划线' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            field="password"
            label={editing ? '重置密码（留空则保留原密码）' : '初始密码'}
            rules={[{ required: !editing, message: '请设置初始密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item field="status" label="状态">
            <Select disabled={editing?.id === getAdminSession()?.id}>
              <Select.Option value="ACTIVE">启用</Select.Option>
              <Select.Option value="INACTIVE">停用</Select.Option>
            </Select>
          </Form.Item>
          <p className="muted">新密码需满足安全设置中的规则。请通过安全渠道单独告知使用者。</p>
        </Form>
      </Modal>
    </>
  )
}
