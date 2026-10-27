import { useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Message,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tooltip,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { getErrorMessage } from '../../lib/errors'
import type { College, ContentStatus } from '../../types/admin'

interface CollegeFormValues {
  name: string
  code: string
  status: ContentStatus
}

export function CollegesPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editing, setEditing] = useState<College | null>(null)
  const [form] = Form.useForm<CollegeFormValues>()

  const colleges = useQuery({
    queryKey: ['colleges', keyword],
    queryFn: () => gateway.listColleges({ keyword }),
  })
  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => gateway.listMajors() })

  const saveCollege = useMutation({
    mutationFn: (values: CollegeFormValues) =>
      editing ? gateway.updateCollege(editing.id, values) : gateway.createCollege(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success(editing ? '学院已更新' : '学院已创建')
      setDrawerVisible(false)
      void queryClient.invalidateQueries({ queryKey: ['colleges'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const toggleStatus = useMutation({
    mutationFn: (college: College) =>
      gateway.updateCollege(college.id, {
        name: college.name,
        code: college.code,
        status: college.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success('学院状态已更新')
      void queryClient.invalidateQueries({ queryKey: ['colleges'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const deleteCollege = useMutation({
    mutationFn: (id: string) => gateway.deleteCollege(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success('学院已删除')
      void queryClient.invalidateQueries({ queryKey: ['colleges'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: 'ACTIVE' })
    setDrawerVisible(true)
  }

  const openEdit = (college: College) => {
    setEditing(college)
    form.setFieldsValue({ name: college.name, code: college.code, status: college.status })
    setDrawerVisible(true)
  }

  const getMajorCount = (collegeId: string) =>
    majors.data?.filter((major) => major.collegeId === collegeId).length ?? 0

  const queryError = colleges.error ?? majors.error

  return (
    <>
      <PageTitle
        title="学院管理"
        description="维护用于学生自填资料和题库推荐的学院目录，课程内容独立共享。"
        action={
          <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
            新增学院
          </Button>
        }
      />
      <Card bordered={false}>
        <div className="toolbar">
          <Input.Search
            allowClear
            prefix={<IconSearch />}
            placeholder="搜索学院名称或代码"
            style={{ width: 320 }}
            searchButton
            onSearch={setKeyword}
          />
          <Typography.Text type="secondary">共 {colleges.data?.length ?? 0} 个学院</Typography.Text>
        </div>
        {queryError ? (
          <ErrorState
            message={queryError.message}
            onRetry={() => {
              void colleges.refetch()
              void majors.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={colleges.isLoading || majors.isLoading}
            data={colleges.data ?? []}
            noDataElement={<Empty description="还没有学院，先新增一个吧" />}
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              { title: '学院名称', dataIndex: 'name' },
              { title: '学院代码', dataIndex: 'code', width: 160 },
              {
                title: '专业数量',
                width: 130,
                render: (_, record) => (
                  <Button type="text" onClick={() => navigate(`/majors?collegeId=${record.id}`)}>
                    {getMajorCount(record.id)} 个专业
                  </Button>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 120,
                render: (_, record) => <StatusTag status={record.status} />,
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 190,
                render: (value) => new Date(value).toLocaleString('zh-CN'),
              },
              {
                title: '操作',
                width: 280,
                render: (_, record) => (
                  <Space>
                    <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title={`确认${record.status === 'ACTIVE' ? '停用' : '启用'}该学院？`}
                      onOk={() => toggleStatus.mutate(record)}
                    >
                      <Button type="text" status={record.status === 'ACTIVE' ? 'warning' : 'success'}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                    {getMajorCount(record.id) > 0 ? (
                      <Tooltip content={`包含 ${getMajorCount(record.id)} 个专业，请先处理专业`}>
                        <span>
                          <Button type="text" status="danger" icon={<IconDelete />} disabled>
                            删除
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Popconfirm
                        title="删除后不可恢复，确认删除？"
                        onOk={() => deleteCollege.mutate(record.id)}
                      >
                        <Button type="text" status="danger" icon={<IconDelete />}>
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
      <Drawer
        width={460}
        title={editing ? '编辑学院' : '新增学院'}
        visible={drawerVisible}
        onCancel={() => setDrawerVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button type="primary" loading={saveCollege.isPending} onClick={() => form.submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onSubmit={(values) => saveCollege.mutate(values)}>
          <Form.Item
            field="name"
            label="学院名称"
            rules={[
              { required: true, message: '请输入学院名称' },
              { maxLength: 50, message: '名称不能超过 50 个字符' },
            ]}
          >
            <Input placeholder="例如：计算机学院" maxLength={50} showWordLimit />
          </Form.Item>
          <Form.Item
            field="code"
            label="学院代码"
            rules={[
              { required: true, message: '请输入学院代码' },
              { match: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、短横线和下划线' },
              { maxLength: 20, message: '代码不能超过 20 个字符' },
            ]}
          >
            <Input placeholder="例如：CS" maxLength={20} showWordLimit />
          </Form.Item>
          <Form.Item field="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Radio.Group>
              <Radio value="ACTIVE">启用</Radio>
              <Radio value="INACTIVE">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Drawer>
    </>
  )
}
