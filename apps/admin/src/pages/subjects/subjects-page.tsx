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
  Tag,
} from '@arco-design/web-react'
import { IconPlus } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import type { CreateSubjectInput, Subject } from '../../types/admin'

export function SubjectsPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<Subject | null | undefined>()
  const [form] = Form.useForm<CreateSubjectInput>()
  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const save = useMutation({
    mutationFn: (input: CreateSubjectInput) =>
      editing
        ? gateway.updateSubject(editing.id, { ...input, majorIds: editing.majorIds })
        : gateway.createSubject({ ...input, majorIds: [] }),
    onSuccess: () => {
      setEditing(undefined)
      void client.invalidateQueries()
      Message.success('课程已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => gateway.deleteSubject(id),
    onSuccess: () => {
      void client.invalidateQueries()
      Message.success('课程已删除')
    },
    onError: (e) => Message.error(e.message),
  })
  const open = (subject: Subject | null) => {
    setEditing(subject)
    form.resetFields()
    form.setFieldsValue(subject ?? { name: '', status: 'ACTIVE', majorIds: [] })
  }
  const error = subjects.error ?? banks.error
  return (
    <>
      <PageTitle
        title="课程目录"
        description="课程是全校共享的内容入口。不同教材或复习范围放在课程下的题库中维护。"
        action={
          <Button type="primary" icon={<IconPlus />} onClick={() => open(null)}>
            新建课程
          </Button>
        }
      />
      <Card bordered={false}>
        <div className="toolbar">
          <Input.Search
            allowClear
            style={{ width: 300 }}
            aria-label="搜索课程"
            placeholder="搜索课程名称"
            onChange={setKeyword}
          />
          <span className="muted">适用范围在题库中设置，课程可独立创建</span>
        </div>
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void subjects.refetch()
              void banks.refetch()
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={subjects.isLoading || banks.isLoading}
            data={
              subjects.data?.filter((s) => s.name.toLowerCase().includes(keyword.trim().toLowerCase())) ?? []
            }
            scroll={{ x: 820 }}
            noDataElement={<Empty description="先创建一门课程，再整理共享题库" />}
            pagination={{ pageSize: 10, showTotal: true }}
            columns={[
              {
                title: '课程',
                dataIndex: 'name',
                width: 200,
                render: (name, s) => (
                  <Link className="entity-link" to={`/question-banks?subjectId=${s.id}`}>
                    {name}
                  </Link>
                ),
              },
              {
                title: '题库',
                width: 150,
                render: (_, s) => {
                  const items = banks.data?.filter((b) => b.subjectId === s.id) ?? []
                  return (
                    <span>
                      {items.length} 份{' '}
                      <span className="muted">
                        / {items.filter((b) => b.publicationStatus === 'PUBLISHED').length} 已发布
                      </span>
                    </span>
                  )
                },
              },
              {
                title: '资源准备',
                width: 160,
                render: (_, s) => (
                  <Tag
                    color={
                      banks.data?.some((b) => b.subjectId === s.id && b.publicationStatus === 'PUBLISHED')
                        ? 'green'
                        : 'orange'
                    }
                  >
                    {banks.data?.some((b) => b.subjectId === s.id && b.publicationStatus === 'PUBLISHED')
                      ? '已有发布内容'
                      : '待整理题库'}
                  </Tag>
                ),
              },
              {
                title: '课程状态',
                width: 110,
                dataIndex: 'status',
                render: (value) => <StatusTag status={value} />,
              },
              {
                title: '操作',
                width: 220,
                fixed: 'right',
                render: (_, s) => (
                  <Space size="mini">
                    <Link to={`/question-banks?subjectId=${s.id}`}>查看题库</Link>
                    <Button type="text" onClick={() => open(s)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除课程？仍有内容或学生选择的课程无法删除。"
                      onOk={() => remove.mutate(s.id)}
                    >
                      <Button type="text" status="danger">
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
      <Drawer
        width={480}
        title={editing ? '编辑课程' : '新建课程'}
        visible={editing !== undefined}
        onCancel={() => {
          if (!save.isPending) setEditing(undefined)
        }}
        footer={
          <Space>
            <Button disabled={save.isPending} onClick={() => setEditing(undefined)}>
              取消
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
              保存课程
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onSubmit={(input) => save.mutate(input)}>
          <Form.Item field="name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input maxLength={50} placeholder="例如：大学英语" />
          </Form.Item>
          <Form.Item field="status" label="课程状态">
            <Radio.Group>
              <Radio value="ACTIVE">启用</Radio>
              <Radio value="INACTIVE">停用</Radio>
            </Radio.Group>
          </Form.Item>
          <p className="muted">停用后，该课程下的题库将退出学生端发现和推荐。保留课程与学习记录的关联。</p>
        </Form>
      </Drawer>
    </>
  )
}
