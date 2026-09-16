import { useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { getErrorMessage } from '../../lib/errors'
import type { ContentStatus, QuestionBank } from '../../types/admin'

interface BankFormValues {
  subjectId: string
  name: string
  description: string
  status: ContentStatus
}

export function QuestionBanksPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [subjectId, setSubjectId] = useState<string>()
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editing, setEditing] = useState<QuestionBank | null>(null)
  const [form] = Form.useForm<BankFormValues>()

  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const banks = useQuery({
    queryKey: ['question-banks', keyword, subjectId],
    queryFn: () => gateway.listQuestionBanks({ keyword, subjectId }),
  })

  const saveBank = useMutation({
    mutationFn: (values: BankFormValues) =>
      editing ? gateway.updateQuestionBank(editing.id, values) : gateway.createQuestionBank(values),
    onSuccess: () => {
      Message.success(editing ? '题库已更新' : '题库已创建')
      setDrawerVisible(false)
      void queryClient.invalidateQueries({ queryKey: ['question-banks'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const toggleStatus = useMutation({
    mutationFn: (bank: QuestionBank) => gateway.updateQuestionBank(bank.id, {
      subjectId: bank.subjectId,
      name: bank.name,
      description: bank.description,
      status: bank.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    }),
    onSuccess: () => {
      Message.success('题库状态已更新')
      void queryClient.invalidateQueries({ queryKey: ['question-banks'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const deleteBank = useMutation({
    mutationFn: (id: string) => gateway.deleteQuestionBank(id),
    onSuccess: () => {
      Message.success('题库已删除')
      void queryClient.invalidateQueries({ queryKey: ['question-banks'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Modal.error({ title: '无法删除题库', content: getErrorMessage(error) }),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: 'ACTIVE', description: '', subjectId })
    setDrawerVisible(true)
  }

  const openEdit = (bank: QuestionBank) => {
    setEditing(bank)
    form.setFieldsValue({
      subjectId: bank.subjectId,
      name: bank.name,
      description: bank.description,
      status: bank.status,
    })
    setDrawerVisible(true)
  }

  const getSubjectName = (id: string) => subjects.data?.find((item) => item.id === id)?.name ?? '未知科目'

  return (
    <>
      <PageTitle
        title="题库管理"
        description="创建题库、绑定所属科目并维护发布状态。"
        action={<Button type="primary" icon={<IconPlus />} onClick={openCreate} disabled={!subjects.data?.length}>新建题库</Button>}
      />
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              prefix={<IconSearch />}
              placeholder="搜索题库名称"
              style={{ width: 280 }}
              searchButton
              onSearch={setKeyword}
            />
            <Select
              allowClear
              placeholder="按科目筛选"
              style={{ width: 200 }}
              value={subjectId}
              onChange={setSubjectId}
            >
              {subjects.data?.map((subject) => <Select.Option key={subject.id} value={subject.id}>{subject.name}</Select.Option>)}
            </Select>
          </Space>
          <Typography.Text type="secondary">共 {banks.data?.length ?? 0} 个题库</Typography.Text>
        </div>
        {banks.isError ? (
          <ErrorState message={banks.error.message} onRetry={() => void banks.refetch()} />
        ) : (
          <Table
            rowKey="id"
            loading={banks.isLoading || subjects.isLoading}
            data={banks.data ?? []}
            noDataElement={<Empty description={subjects.data?.length ? '没有符合条件的题库' : '请先创建科目'} />}
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              { title: '题库名称', dataIndex: 'name', width: 220 },
              { title: '所属科目', dataIndex: 'subjectId', width: 160, render: (value) => getSubjectName(value) },
              { title: '说明', dataIndex: 'description', ellipsis: true },
              { title: '题目数', dataIndex: 'questionCount', width: 100 },
              { title: '状态', dataIndex: 'status', width: 110, render: (_, record) => <StatusTag status={record.status} /> },
              {
                title: '操作',
                width: 270,
                fixed: 'right',
                render: (_, record) => (
                  <Space>
                    <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)}>编辑</Button>
                    <Popconfirm
                      title={`确认${record.status === 'ACTIVE' ? '停用' : '启用'}该题库？`}
                      onOk={() => toggleStatus.mutate(record)}
                    >
                      <Button type="text" status={record.status === 'ACTIVE' ? 'warning' : 'success'}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                    <Popconfirm title="删除后不可恢复，确认删除？" onOk={() => deleteBank.mutate(record.id)}>
                      <Button type="text" status="danger" icon={<IconDelete />}>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            scroll={{ x: 1100 }}
          />
        )}
      </Card>
      <Drawer
        width={500}
        title={editing ? '编辑题库' : '新建题库'}
        visible={drawerVisible}
        onCancel={() => setDrawerVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button type="primary" loading={saveBank.isPending} onClick={() => form.submit()}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onSubmit={(values) => saveBank.mutate(values)}>
          <Form.Item field="subjectId" label="所属科目" rules={[{ required: true, message: '请选择所属科目' }]}>
            <Select placeholder="选择科目">
              {subjects.data?.map((subject) => <Select.Option key={subject.id} value={subject.id}>{subject.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item field="name" label="题库名称" rules={[{ required: true, message: '请输入题库名称' }, { maxLength: 80, message: '名称不能超过 80 个字符' }]}>
            <Input placeholder="例如：微积分基础题库" maxLength={80} showWordLimit />
          </Form.Item>
          <Form.Item field="description" label="题库说明" rules={[{ maxLength: 200, message: '说明不能超过 200 个字符' }]}>
            <Input.TextArea placeholder="简要说明题库内容" maxLength={200} showWordLimit autoSize={{ minRows: 3, maxRows: 6 }} />
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
