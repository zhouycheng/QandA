import { Descriptions, Drawer, Skeleton, Space, Tag, Typography } from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { questionTypeLabels } from '../../lib/labels'
import type { QuestionBank } from '../../types/admin'

export function QuestionDetailDrawer({
  questionId,
  questionBanks,
  onClose,
}: {
  questionId?: string
  questionBanks: QuestionBank[]
  onClose: () => void
}) {
  const gateway = useAdminGateway()
  const detail = useQuery({
    queryKey: ['question-detail', questionId],
    queryFn: () => gateway.getQuestion(questionId!),
    enabled: Boolean(questionId),
  })

  const question = detail.data
  return (
    <Drawer width={560} title="题目详情" visible={Boolean(questionId)} onCancel={onClose} footer={null} unmountOnExit>
      {detail.isLoading ? (
        <Skeleton text={{ rows: 8 }} animation />
      ) : detail.isError ? (
        <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
      ) : question ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions
            column={1}
            border
            data={[
              { label: '题型', value: questionTypeLabels[question.type] },
              {
                label: '所属题库',
                value: questionBanks.find((bank) => bank.id === question.questionBankId)?.name ?? '未知题库',
              },
              { label: '状态', value: <StatusTag status={question.status} /> },
            ]}
          />
          <section>
            <Typography.Title heading={6}>题干</Typography.Title>
            <Typography.Paragraph>{question.stem}</Typography.Paragraph>
          </section>
          <section>
            <Typography.Title heading={6}>选项</Typography.Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              {question.options.map((option) => (
                <div className={`detail-option ${question.correctAnswer.includes(option.key) ? 'detail-option-correct' : ''}`} key={option.key}>
                  <Tag color={question.correctAnswer.includes(option.key) ? 'green' : 'gray'}>{option.key}</Tag>
                  <span>{option.content}</span>
                </div>
              ))}
            </Space>
          </section>
          <section>
            <Typography.Title heading={6}>答案解析</Typography.Title>
            <Typography.Paragraph>{question.explanation}</Typography.Paragraph>
          </section>
        </Space>
      ) : null}
    </Drawer>
  )
}
