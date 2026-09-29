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
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { getErrorMessage } from '../../lib/errors'
import type { ContentStatus, Subject } from '../../types/admin'

interface SubjectFormValues {
  majorId: string
  name: string
  status: ContentStatus
}

export function SubjectsPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [keyword, setKeyword] = useState('')
  const [majorId, setMajorId] = useState<string | undefined>(searchParams.get('majorId') ?? undefined)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editing, setEditing] = useState<Subject | null>(null)
  const [form] = Form.useForm<SubjectFormValues>()

  useEffect(() => {
    setMajorId(searchParams.get('majorId') ?? undefined)
  }, [searchParams])

  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => gateway.listMajors() })
  const subjects = useQuery({
    queryKey: ['subjects', keyword, majorId],
    queryFn: () => gateway.listSubjects({ keyword, majorId }),
  })

  const saveSubject = useMutation({
    mutationFn: (values: SubjectFormValues) =>
      editing ? gateway.updateSubject(editing.id, values) : gateway.createSubject(values),
    onSuccess: () => {
      Message.success(editing ? '科目已更新' : '科目已创建')
      setDrawerVisible(false)
      void queryClient.invalidateQueries({ queryKey: ['subjects'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const toggleStatus = useMutation({
    mutationFn: (subject: Subject) =>
      gateway.updateSubject(subject.id, {
        majorId: subject.majorId,
        name: subject.name,
        status: subject.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: () => {
      Message.success('科目状态已更新')
      void queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const deleteSubject = useMutation({
    mutationFn: (id: string) => gateway.deleteSubject(id),
    onSuccess: () => {
      Message.success('科目已删除')
      void queryClient.invalidateQueries({ queryKey: ['subjects'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ majorId: majorId ?? majors.data?.[0]?.id, status: 'ACTIVE' })
    setDrawerVisible(true)
  }

  const openEdit = (subject: Subject) => {
    setEditing(subject)
    form.setFieldsValue({ majorId: subject.majorId, name: subject.name, status: subject.status })
    setDrawerVisible(true)
  }

  const getMajorName = (id: string) => majors.data?.find((major) => major.id === id)?.name ?? '未知专业'

  return (
    <>
      <PageTitle
        title="科目管理"
        description="维护各专业下的科目及其可用状态。"
        action={<Button type="primary" icon={<IconPlus />} onClick={openCreate} disabled={!majors.data?.length}>新增科目</Button>}
      />
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              prefix={<IconSearch />}
              placeholder="搜索科目名称"
              style={{ width: 280 }}
              searchButton
              onSearch={setKeyword}
            />
            <Select allowClear placeholder="按专业筛选" style={{ width: 200 }} value={majorId} onChange={setMajorId}>
              {majors.data?.map((major) => <Select.Option key={major.id} value={major.id}>{major.name}</Select.Option>)}
            </Select>
          </Space>
          <Typography.Text type="secondary">共 {subjects.data?.length ?? 0} 个科目</Typography.Text>
        </div>
        {subjects.isError ? (
          <ErrorState message={subjects.error.message} onRetry={() => void subjects.refetch()} />
        ) : (
          <Table
            rowKey="id"
            loading={subjects.isLoading || majors.isLoading}
            data={subjects.data ?? []}
            noDataElement={<Empty description={majors.data?.length ? '没有符合条件的科目' : '请先新增专业'} />}
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              { title: '科目名称', dataIndex: 'name' },
              { title: '所属专业', dataIndex: 'majorId', width: 180, render: (value) => getMajorName(value) },
              { title: '状态', dataIndex: 'status', width: 120, render: (_, record) => <StatusTag status={record.status} /> },
              { title: '更新时间', dataIndex: 'updatedAt', width: 190, render: (value) => new Date(value).toLocaleString('zh-CN') },
              {
                title: '操作',
                width: 300,
                render: (_, record) => (
                  <Space>
                    <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)}>编辑</Button>
                    <Popconfirm
                      title={`确认${record.status === 'ACTIVE' ? '停用' : '启用'}该科目？`}
                      onOk={() => toggleStatus.mutate(record)}
                    >
                      <Button type="text" status={record.status === 'ACTIVE' ? 'warning' : 'success'}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                    <Popconfirm title="删除后不可恢复，确认删除？" onOk={() => deleteSubject.mutate(record.id)}>
                      <Button type="text" status="danger" icon={<IconDelete />}>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Drawer
        width={460}
        title={editing ? '编辑科目' : '新建科目'}
        visible={drawerVisible}
        onCancel={() => setDrawerVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button type="primary" loading={saveSubject.isPending} onClick={() => form.submit()}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onSubmit={(values) => saveSubject.mutate(values)}>
          <Form.Item field="majorId" label="所属专业" rules={[{ required: true, message: '请选择所属专业' }]}>
            <Select placeholder="选择专业">
              {majors.data?.map((major) => <Select.Option key={major.id} value={major.id}>{major.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item field="name" label="科目名称" rules={[{ required: true, message: '请输入科目名称' }, { maxLength: 50, message: '名称不能超过 50 个字符' }]}>
            <Input placeholder="例如：高等数学" maxLength={50} showWordLimit />
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
