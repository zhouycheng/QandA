import { Alert, Button, Message, Modal, Tag } from '@arco-design/web-react'
import { IconCheckCircleFill, IconCloseCircleFill } from '@arco-design/web-react/icon'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import { publicationChecks } from '../../lib/bank-workbench'
import type { Chapter, Question, QuestionBank } from '../../types/admin'
import { refreshWorkbench, type WorkbenchData } from './workbench-data'

export function PublicationModal({ bank, data, questions, chapters, onClose }: {
  bank: QuestionBank; data: WorkbenchData; questions: Question[]; chapters: Chapter[]; onClose: () => void
}) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const checks = [...publicationChecks(bank, data.subjects.find((s) => s.id === bank.subjectId), questions, data),
    { label: '题目章节归属正确', passed: questions.every((q) => !q.chapterId || chapters.some((c) => c.id === q.chapterId)), detail: '题目与章节必须属于当前题库' }]
  const passed = checks.every((check) => check.passed)
  const publish = useMutation({
    mutationFn: () => gateway.setBankPublication(bank.id, 'PUBLISHED'),
    onSuccess: () => { refreshWorkbench(client); Message.success('题库已发布，将按展示范围匹配学生资料'); onClose() },
  })
  return <Modal className="bw-publication-modal" title="发布检查" visible style={{ width: 600, maxWidth: 'calc(100vw - 32px)' }} maskClosable={false}
    closable={!publish.isPending} escToExit={!publish.isPending} onCancel={() => { if (!publish.isPending) onClose() }}
    footer={<><Button disabled={publish.isPending} onClick={onClose}>{passed ? '取消' : '返回完善'}</Button><Button type="primary" disabled={!passed} loading={publish.isPending} onClick={() => publish.mutate()}>确认发布</Button></>}>
    <div className="bw-publication-heading"><strong>{bank.name}</strong><Tag color={passed ? 'green' : 'orange'}>已通过 {checks.filter((c) => c.passed).length} / {checks.length} 项</Tag></div>
    {publish.error && <Alert type="error" content={publish.error.message} style={{ marginBottom: 16 }} />}
    <div className="bw-checklist">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.label}>{check.passed ? <IconCheckCircleFill /> : <IconCloseCircleFill />}<div><strong>{check.label}</strong><p>{check.detail}</p></div></div>)}</div>
    <p className="bw-form-note">发布后向匹配范围的学生展示。之后可下架题库，保留内容与已有记录。</p>
  </Modal>
}
