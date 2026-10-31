import { useState } from 'react'
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Select, Space, Table, Tag } from '@arco-design/web-react'
import { IconMinus, IconPlus, IconUpload } from '@arco-design/web-react/icon'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import { questionTypeLabels } from '../../lib/labels'
import { answerSummary, countQuestions, missingExplanations, questionSearchText } from '../../lib/question-content'
import type { Chapter, CreateQuestionInput, Question, QuestionBank } from '../../types/admin'
import { QuestionDetailDrawer } from '../questions/question-detail-drawer'
import { QuestionFormDrawer } from '../questions/question-form-drawer'
import { refreshWorkbench } from './workbench-data'

export function QuestionsManager({ bank, chapters, questions, chapterId, loading, onImport }: {
  bank: QuestionBank
  chapters: Chapter[]
  questions: Question[]
  chapterId?: string
  loading: boolean
  onImport: () => void
}) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [editing, setEditing] = useState<Question | null | undefined>()
  const [detailId, setDetailId] = useState<string>()
  const save = useMutation({
    mutationFn: (input: CreateQuestionInput) => editing ? gateway.updateQuestion(editing.id, input) : gateway.createQuestion(input),
    onSuccess: () => { setEditing(undefined); refreshWorkbench(client); Message.success('题目已保存') },
  })
  const changeStatus = useMutation({
    mutationFn: (question: Question) => gateway.updateQuestion(question.id, { ...question, status: question.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: () => { refreshWorkbench(client); Message.success('题目状态已更新') },
    onError: (error) => Message.error(error.message),
  })
  const remove = useMutation({ mutationFn: (id: string) => gateway.deleteQuestion(id), onSuccess: () => { refreshWorkbench(client); Message.success('题目已删除') }, onError: (error) => Message.error(error.message) })
  const scoped = questions.filter((q) => !chapterId || (chapterId === 'unassigned' ? !q.chapterId : q.chapterId === chapterId))
  const rows = scoped.filter((q) => (type === 'ALL' || q.type === type || q.subQuestions?.some((sub) => sub.type === type)) && (status === 'ALL' || q.status === status) &&
    questionSearchText(q).toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
  const openEditor = (question: Question | null) => { save.reset(); setEditing(question) }
  return <div className="bw-questions-panel">
    <div className="bw-panel-heading"><div><h2>{chapterId === 'unassigned' ? '未分章题目' : chapters.find((c) => c.id === chapterId)?.name ?? '全部题目'}</h2><p>共 {countQuestions(scoped)} 道题，含 {scoped.filter((q) => q.type === 'READING').length} 个阅读题组。阅读理解按小题计数。</p></div><Space wrap><Button icon={<IconUpload />} onClick={onImport}>批量导入</Button><Button type="primary" icon={<IconPlus />} onClick={() => openEditor(null)}>新建题目</Button></Space></div>
    <div className="bw-question-filters"><Input.Search aria-label="搜索题目" value={keyword} onChange={setKeyword} allowClear placeholder="搜索题干、选项或阅读材料" /><Select aria-label="筛选题型" value={type} onChange={setType} options={[{ label: '全部题型', value: 'ALL' }, ...Object.entries(questionTypeLabels).map(([value, label]) => ({ value, label }))]} /><Select aria-label="筛选题目状态" value={status} onChange={setStatus} options={[{ label: '全部状态', value: 'ALL' }, { label: '已启用', value: 'ACTIVE' }, { label: '已停用', value: 'INACTIVE' }]} /></div>
    {type !== 'ALL' && type !== 'READING' && <p className="bw-form-note">阅读题组包含所选题型时会一并显示，可展开查看小题。</p>}
    <Table<Question> rowKey="id" data={rows} border={false} loading={loading} scroll={{ x: 830 }} pagination={{ pageSize: 10, showTotal: true, hideOnSinglePage: true }}
      expandProps={{ rowExpandable: (q) => q.type === 'READING', icon: ({ expanded, record }) => <button type="button" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}阅读小题 ${record.stem}`}>{expanded ? <IconMinus /> : <IconPlus />}</button> }} expandedRowRender={(q) => q.type === 'READING' ? <div className="bw-reading-preview"><p>{q.passage}</p><ol>{q.subQuestions?.map((sub) => <li key={sub.id}><Tag>{questionTypeLabels[sub.type]}</Tag><span>{sub.stem}</span></li>)}</ol><Button type="text" onClick={() => setDetailId(q.id)}>查看完整题组与答案</Button></div> : null} columns={[
      { title: '题型', width: 95, render: (_, question) => <Tag color={question.type === 'READING' ? 'purple' : question.type === 'SHORT_ANSWER' ? 'orange' : question.type === 'FILL_BLANK' ? 'green' : 'arcoblue'}>{questionTypeLabels[question.type]}</Tag> },
      { title: '题目内容', width: 310, render: (_, question) => <button className="bw-question-stem" onClick={() => setDetailId(question.id)}><strong>{question.stem}</strong><small>{answerSummary(question)} · v{question.revision ?? 1}{missingExplanations([question]) > 0 && ' · 解析待补充'}</small></button> },
      { title: '章节', width: 125, render: (_, question) => <span className="bw-question-chapter">{chapters.find((c) => c.id === question.chapterId)?.name ?? '未分章'}</span> },
      { title: '状态', width: 85, render: (_, question) => <Tag color={question.status === 'ACTIVE' ? 'green' : 'gray'}>{question.status === 'ACTIVE' ? '已启用' : '已停用'}</Tag> },
      { title: '操作', width: 185, render: (_, question) => <Space size={0}><Button type="text" size="small" onClick={() => setDetailId(question.id)}>查看</Button><Button type="text" size="small" onClick={() => openEditor(question)}>编辑</Button><Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => {
        if (key === 'status') changeStatus.mutate(question)
        else Modal.confirm({ title: question.type === 'READING' ? '删除整个阅读题组？' : '删除题目？', content: question.type === 'READING' ? '材料与全部小题将一起删除。已有反馈关联时会阻止删除，需要保留内容时可停用题组。' : '已有反馈关联的题目会受到保护；需要保留内容时可以停用题目。', okText: '确认删除', cancelText: '取消', okButtonProps: { status: 'danger' }, onOk: () => remove.mutateAsync(question.id) })
      }}><Menu.Item key="status" disabled={changeStatus.isPending}>{question.status === 'ACTIVE' ? '停用题目' : '启用题目'}</Menu.Item><Menu.Item key="delete" disabled={remove.isPending}>删除题目</Menu.Item></Menu>}><Button type="text" size="small" aria-label={`更多题目操作 ${question.stem}`}>更多</Button></Dropdown></Space> },
    ]} noDataElement={<div className="bw-table-empty"><Empty description={scoped.length ? '没有符合条件的题目' : '还没有题目，可以手动录入或批量导入'} />{scoped.length ? <Button onClick={() => { setKeyword(''); setType('ALL'); setStatus('ALL') }}>清空筛选</Button> : <Button onClick={() => openEditor(null)}>新建第一道题目</Button>}</div>} />
    <div className="bw-panel-foot">题目更新会递增内容版本，已有反馈中的原题快照继续保留。</div>
    {editing !== undefined && <QuestionFormDrawer visible editing={editing} chapters={chapters} questionBanks={[bank]} lockBank defaultQuestionBankId={bank.id}
      defaultChapterId={chapterId === 'unassigned' ? undefined : chapterId} saving={save.isPending} error={save.error?.message} onCancel={() => setEditing(undefined)} onSave={(input) => { if (!save.isPending) save.mutate(input) }} />}
    <QuestionDetailDrawer questionId={detailId} questionBanks={[bank]} onClose={() => setDetailId(undefined)} />
  </div>
}
