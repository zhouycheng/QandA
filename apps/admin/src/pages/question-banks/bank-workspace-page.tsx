import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Message,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
} from '@arco-design/web-react'
import { IconArrowDown, IconArrowUp, IconDelete, IconEdit, IconPlus } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { audienceLabels, publicationColors, publicationLabels } from '../../lib/recommendations'
import type { BankPublicationStatus, Chapter, CreateQuestionBankInput } from '../../types/admin'
import { QuestionsPage } from '../questions/questions-page'
import { BankEditorDrawer } from './bank-editor-drawer'
import { ImportQuestionsModal } from './import-questions-modal'

export function BankWorkspacePage() {
  const { id = '' } = useParams()
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const chapterId = params.get('chapterId') ?? undefined
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState(false)
  const [chapterEditing, setChapterEditing] = useState<Chapter | null | undefined>()
  const [chapterName, setChapterName] = useState('')
  const banks = useQuery({ queryKey: ['question-banks', 'all'], queryFn: () => gateway.listQuestionBanks() })
  const subjects = useQuery({ queryKey: ['subjects', 'all'], queryFn: () => gateway.listSubjects() })
  const colleges = useQuery({ queryKey: ['colleges', 'all'], queryFn: () => gateway.listColleges() })
  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => gateway.listMajors() })
  const chapters = useQuery({ queryKey: ['chapters', id], queryFn: () => gateway.listChapters(id) })
  const questions = useQuery({
    queryKey: ['questions', 'bank', id],
    queryFn: () => gateway.listQuestions({ questionBankId: id }),
  })
  const bank = banks.data?.find((b) => b.id === id)
  const subject = subjects.data?.find((s) => s.id === bank?.subjectId)
  const refresh = () => {
    void client.invalidateQueries()
  }
  const saveBank = useMutation({
    mutationFn: (input: CreateQuestionBankInput) => gateway.updateQuestionBank(id, input),
    onSuccess: () => {
      setEditing(false)
      refresh()
      Message.success('题库信息已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const publish = useMutation({
    mutationFn: (status: BankPublicationStatus) => gateway.setBankPublication(id, status),
    onSuccess: (b) => {
      refresh()
      Message.success(`题库${publicationLabels[b.publicationStatus]}`)
    },
    onError: (e) => Message.error(e.message),
  })
  const saveChapter = useMutation({
    mutationFn: () =>
      gateway.saveChapter(chapterEditing?.id, {
        questionBankId: id,
        name: chapterName,
        sortOrder: chapterEditing?.sortOrder ?? chapters.data?.length ?? 0,
      }),
    onSuccess: () => {
      setChapterEditing(undefined)
      refresh()
      Message.success('章节已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  const deleteChapter = useMutation({
    mutationFn: (chapter: Chapter) => gateway.deleteChapter(chapter.id),
    onSuccess: () => {
      if (chapterId) setParams({})
      refresh()
      Message.success('空章节已删除')
    },
    onError: (e) => Message.error(e.message),
  })
  const reorder = useMutation({
    mutationFn: (ids: string[]) => gateway.reorderChapters(id, ids),
    onSuccess: refresh,
    onError: (e) => Message.error(e.message),
  })
  const move = (index: number, direction: number) => {
    const ids = chapters.data?.map((c) => c.id) ?? []
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate(ids)
  }
  const selectChapter = (value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set('chapterId', value)
    else next.delete('chapterId')
    setParams(next, { replace: true })
  }
  const error =
    banks.error ?? subjects.error ?? chapters.error ?? questions.error ?? colleges.error ?? majors.error
  if (error)
    return (
      <ErrorState
        message={error.message}
        onRetry={() => {
          void banks.refetch()
          void subjects.refetch()
          void chapters.refetch()
          void questions.refetch()
          void colleges.refetch()
          void majors.refetch()
        }}
      />
    )
  if (banks.isLoading || subjects.isLoading || chapters.isLoading || questions.isLoading)
    return (
      <div className="page-loading">
        <Spin />
      </div>
    )
  if (!bank)
    return (
      <Empty
        description={
          <span>
            题库不存在或已删除。<Link to="/question-banks">返回题库列表</Link>
          </span>
        }
      />
    )
  const rows = questions.data ?? []
  const unassigned = rows.filter((q) => !q.chapterId).length
  const missingExplanation = rows.filter((q) => q.status === 'ACTIVE' && !q.explanation.trim()).length
  return (
    <>
      <Link className="back-link" to="/question-banks">
        ← 返回共享题库
      </Link>
      <PageTitle
        title={bank.name}
        description={`${subject?.name ?? '未知课程'} · ${bank.textbook || '教材信息待补充'} · ${bank.owner || '尚未指定负责人'}`}
        action={
          <Space wrap>
            <Button onClick={() => setPreview(true)}>学生视角预览</Button>
            <Button onClick={() => setEditing(true)}>题库设置</Button>
            <Popconfirm
              title={
                bank.publicationStatus === 'PUBLISHED'
                  ? '下架后学生不能新开练习，确认下架？'
                  : '检查启用题目的答案、解析和适用范围后发布？'
              }
              onOk={() =>
                publish.mutate(bank.publicationStatus === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED')
              }
            >
              <Button type="primary" loading={publish.isPending}>
                {bank.publicationStatus === 'PUBLISHED' ? '下架题库' : '检查并发布'}
              </Button>
            </Popconfirm>
          </Space>
        }
      />
      <div className="bank-summary">
        <Space wrap>
          <Tag color={publicationColors[bank.publicationStatus]}>
            {publicationLabels[bank.publicationStatus]}
          </Tag>
          <Tag color="arcoblue">
            {bank.scopeType === 'ALL' ? '全校适用' : `${bank.audiences.length} 条推荐条件`}
          </Tag>
          <span>{rows.length} 道题</span>
          <span>{chapters.data?.length ?? 0} 个章节</span>
          <span>{unassigned} 道未分章</span>
        </Space>
        <Space>
          <Button onClick={() => setImporting(true)}>批量导入</Button>
          {bank.publicationStatus !== 'ARCHIVED' && (
            <Popconfirm
              title="归档后保留全部内容与记录，并退出学生端发现和推荐。"
              onOk={() => publish.mutate('ARCHIVED')}
            >
              <Button type="text" status="warning" disabled={publish.isPending}>
                归档
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>
      {(missingExplanation > 0 || rows.length === 0 || subject?.status !== 'ACTIVE') && (
        <Alert
          className="section-gap"
          type="warning"
          content={
            subject?.status !== 'ACTIVE'
              ? '所属课程已停用，题库暂不进入学生端发现和推荐。请先启用课程。'
              : rows.length === 0
                ? '题库尚无题目。先创建章节、添加或导入题目，再发布。'
                : `${missingExplanation} 道启用题目缺少解析，补全后才能发布。`
          }
        />
      )}
      <div className="bank-workspace">
        <Card
          bordered={false}
          title="章节目录"
          className="chapter-panel"
          extra={
            <Button
              type="text"
              aria-label="新建章节"
              icon={<IconPlus />}
              onClick={() => {
                setChapterEditing(null)
                setChapterName('')
              }}
            />
          }
        >
          <button
            className={`chapter-choice ${!chapterId ? 'selected' : ''}`}
            onClick={() => selectChapter()}
          >
            <span>全部题目</span>
            <span>{rows.length}</span>
          </button>
          <button
            className={`chapter-choice ${chapterId === 'unassigned' ? 'selected' : ''}`}
            onClick={() => selectChapter('unassigned')}
          >
            <span>未分章</span>
            <span>{unassigned}</span>
          </button>
          <div className="chapter-divider" />
          {chapters.data?.map((chapter, index, all) => (
            <div className="chapter-item" key={chapter.id}>
              <button
                className={`chapter-choice ${chapterId === chapter.id ? 'selected' : ''}`}
                onClick={() => selectChapter(chapter.id)}
              >
                <span>{chapter.name}</span>
                <span>{rows.filter((q) => q.chapterId === chapter.id).length}</span>
              </button>
              <div className="chapter-actions">
                <Button
                  type="text"
                  size="mini"
                  aria-label={`上移 ${chapter.name}`}
                  disabled={index === 0 || reorder.isPending}
                  icon={<IconArrowUp />}
                  onClick={() => move(index, -1)}
                />
                <Button
                  type="text"
                  size="mini"
                  aria-label={`下移 ${chapter.name}`}
                  disabled={index === all.length - 1 || reorder.isPending}
                  icon={<IconArrowDown />}
                  onClick={() => move(index, 1)}
                />
                <Button
                  type="text"
                  size="mini"
                  aria-label={`编辑 ${chapter.name}`}
                  icon={<IconEdit />}
                  onClick={() => {
                    setChapterEditing(chapter)
                    setChapterName(chapter.name)
                  }}
                />
                <Popconfirm title="仅空章节可以删除，确认删除？" onOk={() => deleteChapter.mutate(chapter)}>
                  <Button
                    type="text"
                    size="mini"
                    status="danger"
                    aria-label={`删除 ${chapter.name}`}
                    icon={<IconDelete />}
                  />
                </Popconfirm>
              </div>
            </div>
          ))}
          {!chapters.data?.length && <p className="muted">添加章节，帮助学生按单元复习。</p>}
        </Card>
        <div className="workspace-content">
          <QuestionsPage bankId={id} chapterFilter={chapterId} embedded />
        </div>
      </div>
      <BankEditorDrawer
        bank={bank}
        visible={editing}
        subjects={subjects.data ?? []}
        saving={saveBank.isPending}
        onClose={() => setEditing(false)}
        onSave={(input) => saveBank.mutate(input)}
      />
      {importing && (
        <ImportQuestionsModal
          bank={bank}
          defaultChapterId={chapterId === 'unassigned' ? undefined : chapterId}
          onClose={() => setImporting(false)}
        />
      )}
      <Modal
        title={chapterEditing ? '编辑章节' : '新建章节'}
        visible={chapterEditing !== undefined}
        confirmLoading={saveChapter.isPending}
        onCancel={() => {
          if (!saveChapter.isPending) setChapterEditing(undefined)
        }}
        onOk={() => saveChapter.mutate()}
        okText="保存章节"
      >
        <label className="input-label">
          章节名称
          <Input
            autoFocus
            value={chapterName}
            onChange={setChapterName}
            maxLength={60}
            placeholder="例如：第一章 函数与极限"
            onPressEnter={() => {
              if (!saveChapter.isPending) saveChapter.mutate()
            }}
          />
        </label>
      </Modal>
      <Modal
        title="学生视角预览"
        visible={preview}
        onCancel={() => setPreview(false)}
        footer={null}
        style={{ width: 680, maxWidth: 'calc(100vw - 32px)' }}
      >
        <div className="student-preview">
          <span className="eyebrow">{subject?.name}</span>
          <h2>{bank.name}</h2>
          <p>{bank.description || '题库说明待补充'}</p>
          <p className="muted">
            {bank.textbook || '教材未填写'} · {rows.filter((q) => q.status === 'ACTIVE').length} 道可练习题目
          </p>
          <Space wrap>
            {audienceLabels(bank, colleges.data ?? [], majors.data ?? []).map((label) => (
              <Tag key={label} color="arcoblue">
                {label}
              </Tag>
            ))}
          </Space>
          <p className="muted">可根据自身复习需要选择，推荐范围不限制访问。</p>
          {bank.publicationStatus !== 'PUBLISHED' && (
            <Alert
              style={{ marginTop: 20 }}
              type="warning"
              content="当前题库尚未发布，此处仅供团队检查内容。"
            />
          )}
          <h3>章节目录</h3>
          {chapters.data?.map((c) => (
            <div className="preview-chapter" key={c.id}>
              <span>{c.name}</span>
              <span className="muted">
                {rows.filter((q) => q.chapterId === c.id && q.status === 'ACTIVE').length} 题
              </span>
            </div>
          ))}
          <h3>题目示例</h3>
          {rows
            .filter((q) => q.status === 'ACTIVE')
            .slice(0, 3)
            .map((q) => (
              <div className="preview-question" key={q.id}>
                <strong>{q.stem}</strong>
                {q.options.map((o) => (
                  <p key={o.key}>
                    {o.key}．{o.content}
                  </p>
                ))}
                <details>
                  <summary>查看答案与解析</summary>
                  <p>答案：{q.correctAnswer.join('、')}</p>
                  <p>{q.explanation || '暂无解析'}</p>
                </details>
              </div>
            ))}
        </div>
      </Modal>
    </>
  )
}
