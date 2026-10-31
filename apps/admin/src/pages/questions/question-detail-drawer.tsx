import { Descriptions, Drawer, Skeleton, Space } from '@arco-design/web-react'
import { useQuery } from '@tanstack/react-query'
import { ErrorState } from '../../components/error-state'
import { StatusTag } from '../../components/status-tag'
import { useAdminGateway } from '../../gateways/gateway-context'
import { questionTypeLabels } from '../../lib/labels'
import type { QuestionBank } from '../../types/admin'
import { QuestionContentView } from './question-content-view'

export function QuestionDetailDrawer({ questionId, questionBanks, onClose }: { questionId?: string; questionBanks: QuestionBank[]; onClose: () => void }) {
  const gateway = useAdminGateway()
  const detail = useQuery({ queryKey: ['question-detail', questionId], queryFn: () => gateway.getQuestion(questionId!), enabled: Boolean(questionId) })
  const question = detail.data
  return <Drawer width={question?.type === 'READING' ? 720 : 560} style={{ maxWidth: '100vw' }} title={question?.type === 'READING' ? '阅读题组详情' : '题目详情'} visible={Boolean(questionId)} onCancel={onClose} footer={null} unmountOnExit>
    {detail.isLoading ? <Skeleton text={{ rows: 8 }} animation /> : detail.isError ? <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /> : question ? <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions column={1} border data={[
        { label: '题型', value: questionTypeLabels[question.type] },
        { label: '所属题库', value: questionBanks.find((bank) => bank.id === question.questionBankId)?.name ?? '未知题库' },
        { label: '状态', value: <StatusTag status={question.status} /> },
        { label: '内容版本', value: `v${question.revision ?? 1}` },
      ]} />
      <QuestionContentView question={question} />
    </Space> : null}
  </Drawer>
}
