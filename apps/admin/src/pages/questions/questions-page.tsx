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
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconEye, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { getErrorMessage } from '../../lib/errors'
import { questionTypeLabels } from '../../lib/labels'
import type { ContentStatus, CreateQuestionInput, Question, QuestionType } from '../../types/admin'
import { QuestionDetailDrawer } from './question-detail-drawer'
import { QuestionFormDrawer } from './question-form-drawer'

export function QuestionsPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [questionBankId, setQuestionBankId] = useState<string>()
  const [type, setType] = useState<QuestionType>()
  const [status, setStatus] = useState<ContentStatus>()
  const [formVisible, setFormVisible] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)
  const [detailId, setDetailId] = useState<string>()

  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const questions = useQuery({
    queryKey: ['questions', keyword, questionBankId, type, status],
    queryFn: () => gateway.listQuestions({ keyword, questionBankId, type, status }),
  })

  const saveQuestion = useMutation({
    mutationFn: (input: CreateQuestionInput) =>
      editing ? gateway.updateQuestion(editing.id, input) : gateway.createQuestion(input),
    onSuccess: () => {
      Message.success(editing ? '题目已更新' : '题目已创建')
      setFormVisible(false)
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['question-banks'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const deleteQuestion = useMutation({
    mutationFn: (id: string) => gateway.deleteQuestion(id),
    onSuccess: () => {
      Message.success('题目已删除')
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['question-banks'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const toggleStatus = useMutation({
    mutationFn: (question: Question) => gateway.updateQuestion(question.id, {
      questionBankId: question.questionBankId,
      stem: question.stem,
      type: question.type,
      options: question.options,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      status: question.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    }),
    onSuccess: () => {
      Message.success('题目状态已更新')
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
    },
    onError: (error) => Message.error(getErrorMessage(error)),
  })

  const openCreate = () => {
    setEditing(null)
    setFormVisible(true)
  }

  const openEdit = (question: Question) => {
    setEditing(question)
    setFormVisible(true)
  }

  const getBankName = (id: string) => banks.data?.find((bank) => bank.id === id)?.name ?? '未知题库'

  return (
    <>
      <PageTitle
        title="题目管理"
        description="维护单选题、多选题和判断题，并通过搜索与筛选快速定位内容。"
        action={<Button type="primary" icon={<IconPlus />} disabled={!banks.data?.length} onClick={openCreate}>新建题目</Button>}
      />
      <Card bordered={false}>
        <div className="toolbar toolbar-wrap">
          <Space wrap>
            <Input.Search
              allowClear
              prefix={<IconSearch />}
              placeholder="搜索题干或选项"
              style={{ width: 270 }}
              searchButton
              onSearch={setKeyword}
            />
            <Select allowClear placeholder="全部题库" style={{ width: 200 }} value={questionBankId} onChange={setQuestionBankId}>
              {banks.data?.map((bank) => <Select.Option key={bank.id} value={bank.id}>{bank.name}</Select.Option>)}
            </Select>
            <Select allowClear placeholder="全部题型" style={{ width: 140 }} value={type} onChange={setType}>
              {Object.entries(questionTypeLabels).map(([value, label]) => <Select.Option key={value} value={value}>{label}</Select.Option>)}
            </Select>
            <Select allowClear placeholder="全部状态" style={{ width: 130 }} value={status} onChange={setStatus}>
              <Select.Option value="ACTIVE">已启用</Select.Option>
              <Select.Option value="INACTIVE">已停用</Select.Option>
            </Select>
          </Space>
          <Typography.Text type="secondary">共 {questions.data?.length ?? 0} 道题</Typography.Text>
        </div>
        {questions.isError ? (
          <ErrorState message={questions.error.message} onRetry={() => void questions.refetch()} />
        ) : (
          <Table
            rowKey="id"
            loading={questions.isLoading || banks.isLoading}
            data={questions.data ?? []}
            noDataElement={<Empty description={banks.data?.length ? '没有符合条件的题目' : '请先创建题库'} />}
            pagination={{ pageSize: 20, showTotal: true, sizeCanChange: true }}
            columns={[
              {
                title: '题干',
                dataIndex: 'stem',
                width: 340,
                ellipsis: true,
                render: (value) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 310 }}>{value}</Typography.Text>,
              },
              { title: '题型', dataIndex: 'type', width: 110, render: (value) => <Tag color="arcoblue">{questionTypeLabels[value as QuestionType]}</Tag> },
              { title: '所属题库', dataIndex: 'questionBankId', width: 190, ellipsis: true, render: (value) => getBankName(value) },
              { title: '状态', dataIndex: 'status', width: 100, render: (_, record) => <StatusTag status={record.status} /> },
              {
                title: '操作',
                width: 330,
                fixed: 'right',
                render: (_, record) => (
                  <Space>
                    <Button type="text" icon={<IconEye />} onClick={() => setDetailId(record.id)}>查看</Button>
                    <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)}>编辑</Button>
                    <Popconfirm
                      title={`确认${record.status === 'ACTIVE' ? '停用' : '启用'}该题目？`}
                      onOk={() => toggleStatus.mutate(record)}
                    >
                      <Button type="text" status={record.status === 'ACTIVE' ? 'warning' : 'success'}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                    <Popconfirm title="删除后不可恢复，确认删除？" onOk={() => deleteQuestion.mutate(record.id)}>
                      <Button type="text" status="danger" icon={<IconDelete />}>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            scroll={{ x: 1150 }}
          />
        )}
      </Card>
      <QuestionFormDrawer
        visible={formVisible}
        editing={editing}
        questionBanks={banks.data ?? []}
        saving={saveQuestion.isPending}
        onCancel={() => setFormVisible(false)}
        onSave={(input) => saveQuestion.mutate(input)}
      />
      <QuestionDetailDrawer questionId={detailId} questionBanks={banks.data ?? []} onClose={() => setDetailId(undefined)} />
    </>
  )
}
