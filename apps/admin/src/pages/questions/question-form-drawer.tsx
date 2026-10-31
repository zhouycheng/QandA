import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Form, Message, Modal, Radio, Select, Space, Typography } from '@arco-design/web-react'
import { validateQuestion } from '../../lib/content-rules'
import { createQuestionContent } from '../../lib/question-content'
import type { AtomicQuestionContent, Chapter, ContentStatus, CreateQuestionInput, Question, QuestionBank, QuestionContent } from '../../types/admin'
import { QuestionContentEditor } from './question-content-editor'

interface Metadata { questionBankId: string; chapterId?: string; status: ContentStatus }

function cleanDraft(content: QuestionContent): QuestionContent {
  return { ...content,
    blanks: content.blanks?.map((blank) => ({ answers: blank.answers.filter((answer) => answer.trim()) })),
    scoringPoints: content.scoringPoints?.map((point) => point.trim()).filter(Boolean),
    subQuestions: content.subQuestions?.map((sub) => ({ ...cleanDraft(sub) as AtomicQuestionContent, id: sub.id })),
  }
}

export function QuestionFormDrawer({ visible, editing, questionBanks, saving, error, onCancel, onSave, defaultQuestionBankId, defaultChapterId, chapters, lockBank }: {
  defaultQuestionBankId?: string
  defaultChapterId?: string
  chapters: Chapter[]
  lockBank?: boolean
  visible: boolean
  editing: Question | null
  questionBanks: QuestionBank[]
  saving: boolean
  error?: string
  onCancel: () => void
  onSave: (input: CreateQuestionInput) => void
}) {
  const [form] = Form.useForm<Metadata>()
  const [content, setContent] = useState<QuestionContent>(createQuestionContent)
  const [dirty, setDirty] = useState(false)
  const [validationError, setValidationError] = useState('')
  useEffect(() => {
    if (!visible) return
    setDirty(false)
    setValidationError('')
    setContent(editing ? structuredClone(editing) : createQuestionContent())
    form.setFieldsValue({ questionBankId: editing?.questionBankId ?? defaultQuestionBankId ?? questionBanks[0]?.id, chapterId: editing?.chapterId ?? defaultChapterId, status: editing?.status ?? 'ACTIVE' })
  }, [editing, form, visible, defaultQuestionBankId, defaultChapterId])
  const submit = (metadata: Metadata) => {
    if (saving) return
    try { onSave(validateQuestion({ ...cleanDraft(content), ...metadata })) }
    catch (error) { const message = (error as Error).message; setValidationError(message); Message.error(message) }
  }
  const cancel = () => {
    if (saving) return
    if (!dirty) return onCancel()
    Modal.confirm({ title: '放弃本次修改？', content: '尚未保存的题目内容将丢失。', okText: '放弃修改', cancelText: '继续编辑', onOk: onCancel })
  }
  return <Drawer width={content.type === 'READING' ? 760 : 640} style={{ maxWidth: '100vw' }} className="bw-question-editor"
    title={editing ? (content.type === 'READING' ? '编辑阅读题组' : '编辑题目') : '新建题目'} visible={visible} onCancel={cancel} maskClosable={false} escToExit={!saving} closable={!saving} unmountOnExit
    footer={<Space><Button onClick={cancel} disabled={saving}>取消</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{content.type === 'READING' ? '保存题组' : '保存题目'}</Button></Space>}>
    {(validationError || error) && <Alert type="error" content={validationError || error} className="bw-form-error" />}
    <Form form={form} layout="vertical" onSubmit={submit} disabled={saving} onValuesChange={() => setDirty(true)}>
      <Form.Item field="questionBankId" label="所属题库" rules={[{ required: true, message: '请选择题库' }]}><Select aria-label="所属题库" placeholder="选择题库" disabled={lockBank || saving} onChange={() => form.setFieldValue('chapterId', undefined)} options={questionBanks.map((bank) => ({ label: bank.name, value: bank.id }))} /></Form.Item>
      <Form.Item shouldUpdate noStyle>{(values) => <Form.Item field="chapterId" label="所属章节"><Select aria-label="所属章节" allowClear placeholder="未分章" options={chapters.filter((c) => c.questionBankId === values.questionBankId).map((c) => ({ label: c.name, value: c.id }))} /></Form.Item>}</Form.Item>
      <QuestionContentEditor value={content} onChange={(next) => { setContent(next); setDirty(true); setValidationError('') }} disabled={saving} lockType={Boolean(editing)} lockedSubIds={editing?.subQuestions?.map((sub) => sub.id)} />
      <Form.Item field="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}><Radio.Group><Radio value="ACTIVE">启用</Radio><Radio value="INACTIVE">停用</Radio></Radio.Group></Form.Item>
      {editing && <Typography.Text type="secondary">已有题目的题型固定；阅读题组可以继续添加、排序和移除小题。</Typography.Text>}
    </Form>
  </Drawer>
}
