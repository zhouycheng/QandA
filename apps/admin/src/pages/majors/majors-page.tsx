import { useEffect, useState } from 'react'
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
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { getErrorMessage } from '../../lib/errors'
import type { ContentStatus, Major } from '../../types/admin'

interface MajorFormValues {
  collegeId: string
  name: string
  code: string
  status: ContentStatus
}

export function MajorsPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [keyword, setKeyword] = useState('')
  const [collegeId, setCollegeId] = useState<string | undefined>(searchParams.get('collegeId') ?? undefined)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editing, setEditing] = useState<Major | null>(null)
  const [form] = Form.useForm<MajorFormValues>()

  useEffect(() => {
    setCollegeId(searchParams.get('collegeId') ?? undefined)
  }, [searchParams])

  const colleges = useQuery({ queryKey: ['colleges', 'all'], queryFn: () => gateway.listColleges() })
  const majors = useQuery({
    queryKey: ['majors', keyword, collegeId],
    queryFn: () => gateway.listMajors({ keyword, collegeId }),
  })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })

  const saveMajor = useMutation({
    mutationFn: (values: MajorFormValues) =>
      editing ? gateway.updateMajor(editing.id, values) : gateway.createMajor(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success(editing ? '专业已更新' : '专业已创建')
      setDrawerVisible(false)
      void queryClient.invalidateQueries({ queryKey: ['majors'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const toggleStatus = useMutation({
    mutationFn: (major: Major) =>
      gateway.updateMajor(major.id, {
        collegeId: major.collegeId,
        name: major.name,
        code: major.code,
        status: major.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success('专业状态已更新')
      void queryClient.invalidateQueries({ queryKey: ['majors'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const deleteMajor = useMutation({
    mutationFn: (id: string) => gateway.deleteMajor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      Message.success('专业已删除')
      void queryClient.invalidateQueries({ queryKey: ['majors'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ collegeId, status: 'ACTIVE' })
    setDrawerVisible(true)
  }

  const openEdit = (major: Major) => {
    setEditing(major)
    form.setFieldsValue({
      collegeId: major.collegeId,
      name: major.name,
      code: major.code,
      status: major.status,
    })
    setDrawerVisible(true)
  }

  const getCollegeName = (id: string) =>
    colleges.data?.find((college) => college.id === id)?.name ?? '未知学院'
  const isCollegeInactive = (id: string) =>
    colleges.data?.find((college) => college.id === id)?.status === 'INACTIVE'
  const getSubjectCount = (id: string) =>
    banks.data?.filter((bank) => bank.audiences.some((a) => a.majorId === id)).length ?? 0
  const selectedCollege = colleges.data?.find((college) => college.id === collegeId)

  const changeCollege = (value?: string) => {
    setCollegeId(value)
    const next = new URLSearchParams(searchParams)
    if (value) next.set('collegeId', value)
    else next.delete('collegeId')
    setSearchParams(next, { replace: true })
  }

  const queryError = majors.error ?? colleges.error ?? banks.error

  return (
    <>
      <PageTitle
        title={selectedCollege ? `${selectedCollege.name} · 专业管理` : '专业管理'}
        description={
          selectedCollege
            ? '当前仅显示该学院下的专业，用于学生自填资料和题库推荐。'
            : '维护学生资料和题库推荐所使用的专业目录。'
        }
        action={
          <Button type="primary" icon={<IconPlus />} onClick={openCreate} disabled={!colleges.data?.length}>
            新增专业
          </Button>
        }
      />
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              prefix={<IconSearch />}
              placeholder="搜索专业名称或代码"
              style={{ width: 280 }}
              searchButton
              onSearch={setKeyword}
            />
            <Select
              allowClear
              placeholder="按学院筛选"
              style={{ width: 200 }}
              value={collegeId}
              onChange={changeCollege}
            >
              {colleges.data?.map((college) => (
                <Select.Option key={college.id} value={college.id}>
                  {college.name}
                </Select.Option>
              ))}
            </Select>
          </Space>
          <Typography.Text type="secondary">共 {majors.data?.length ?? 0} 个专业</Typography.Text>
        </div>
        {queryError ? (
          <ErrorState
            message={queryError.message}
            onRetry={() => {
              void majors.refetch()
              void colleges.refetch()
              void banks.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={majors.isLoading || colleges.isLoading || banks.isLoading}
            data={majors.data ?? []}
            noDataElement={
              <Empty description={colleges.data?.length ? '没有符合条件的专业' : '请先新增学院'} />
            }
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              { title: '专业名称', dataIndex: 'name' },
              { title: '专业代码', dataIndex: 'code', width: 140 },
              {
                title: '所属学院',
                dataIndex: 'collegeId',
                width: 180,
                render: (value) => getCollegeName(value),
              },
              {
                title: '指定推荐题库',
                width: 130,
                render: (_, record) => (
                  <Button type="text" onClick={() => navigate('/recommendations')}>
                    {getSubjectCount(record.id)} 份题库
                  </Button>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 120,
                render: (_, record) => (
                  <Space direction="vertical" size="mini">
                    <StatusTag status={record.status} />
                    {record.status === 'ACTIVE' && isCollegeInactive(record.collegeId) && (
                      <Tag color="orange">学院已停用</Tag>
                    )}
                  </Space>
                ),
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
                      title={`确认${record.status === 'ACTIVE' ? '停用' : '启用'}该专业？`}
                      onOk={() => toggleStatus.mutate(record)}
                    >
                      <Button type="text" status={record.status === 'ACTIVE' ? 'warning' : 'success'}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                    {getSubjectCount(record.id) > 0 ? (
                      <Tooltip
                        content={`仍被 ${getSubjectCount(record.id)} 份题库的推荐条件引用，请先调整范围`}
                      >
                        <span>
                          <Button type="text" status="danger" icon={<IconDelete />} disabled>
                            删除
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Popconfirm
                        title="删除后不可恢复，确认删除？"
                        onOk={() => deleteMajor.mutate(record.id)}
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
        width={480}
        title={editing ? '编辑专业' : '新增专业'}
        visible={drawerVisible}
        onCancel={() => setDrawerVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button type="primary" loading={saveMajor.isPending} onClick={() => form.submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onSubmit={(values) => saveMajor.mutate(values)}>
          <Form.Item
            field="collegeId"
            label="所属学院"
            rules={[{ required: true, message: '请选择所属学院' }]}
          >
            <Select placeholder="选择学院">
              {colleges.data?.map((college) => (
                <Select.Option key={college.id} value={college.id}>
                  {college.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            field="name"
            label="专业名称"
            rules={[
              { required: true, message: '请输入专业名称' },
              { maxLength: 50, message: '名称不能超过 50 个字符' },
            ]}
          >
            <Input placeholder="例如：软件工程" maxLength={50} showWordLimit />
          </Form.Item>
          <Form.Item
            field="code"
            label="专业代码"
            rules={[
              { required: true, message: '请输入专业代码' },
              { match: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、短横线和下划线' },
              { maxLength: 20, message: '代码不能超过 20 个字符' },
            ]}
          >
            <Input placeholder="例如：SE" maxLength={20} showWordLimit />
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
