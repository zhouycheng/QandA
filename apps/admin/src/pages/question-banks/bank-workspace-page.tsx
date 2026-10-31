import { useEffect, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Input, Menu, Message, Modal, Space, Spin, Tabs, Tag } from '@arco-design/web-react'
import { IconArrowLeft, IconBook, IconMore, IconPlus, IconUpload } from '@arco-design/web-react/icon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { PageTitle } from '../../components/page-title'
import { useAdminGateway } from '../../gateways/gateway-context'
import { scopeLabels } from '../../lib/bank-workbench'
import { formatDate } from '../../lib/format'
import { publicationColors, publicationLabels } from '../../lib/recommendations'
import { countQuestions } from '../../lib/question-content'
import type { Chapter } from '../../types/admin'
import { BankSettingsDrawer } from './bank-settings-drawer'
import { ImportQuestionsModal } from './import-questions-modal'
import { PublicationModal } from './publication-modal'
import { QuestionsManager } from './questions-manager'
import { ScopePreview } from './scope-editor'
import { refreshWorkbench, useWorkbenchData } from './workbench-data'

export function BankWorkspacePage() {
  const { id = '' } = useParams()
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'questions'
  const chapterId = params.get('chapter') ?? undefined
  const [settings, setSettings] = useState<'basic' | 'scope'>()
  const [importing, setImporting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [chapterEditor, setChapterEditor] = useState<Chapter | null | undefined>()
  const [chapterName, setChapterName] = useState('')
  const dataQuery = useWorkbenchData()
  const questions = useQuery({ queryKey: ['questions', 'bank', id], queryFn: () => gateway.listQuestions({ questionBankId: id }) })
  const chapters = useQuery({ queryKey: ['chapters', id], queryFn: () => gateway.listChapters(id) })
  const refresh = () => refreshWorkbench(client)
  const saveChapter = useMutation({
    mutationFn: () => gateway.saveChapter(chapterEditor?.id, { name: chapterName, questionBankId: id, sortOrder: chapterEditor?.sortOrder ?? chapters.data?.length ?? 0 }),
    onSuccess: () => { setChapterEditor(undefined); refresh(); Message.success('章节已保存') },
  })
  const reorder = useMutation({ mutationFn: (ids: string[]) => gateway.reorderChapters(id, ids), onSuccess: refresh, onError: (error) => Message.error(error.message) })
  const selectChapter = (value?: string) => setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set('chapter', value); else next.delete('chapter'); return next })
  useEffect(() => {
    if (chapters.data && chapterId && chapterId !== 'unassigned' && !chapters.data.some((c) => c.id === chapterId)) selectChapter()
  }, [chapters.data, chapterId])
  const error = dataQuery.error ?? questions.error ?? chapters.error
  if (error) return <ErrorState message={error.message} onRetry={() => { void dataQuery.refetch(); void questions.refetch(); void chapters.refetch() }} />
  if (dataQuery.isPending || questions.isPending || chapters.isPending) return <div className="directory-loading"><Spin tip="正在加载题库内容" /></div>
  const data = dataQuery.data!
  const bank = data.banks.find((b) => b.id === id)
  if (!bank) return <Empty description={<span>题库不存在或已删除。<Link to="/question-banks">返回题库工作台</Link></span>} />
  const course = data.subjects.find((s) => s.id === bank.subjectId)
  const rows = questions.data ?? []
  const chapterRows = chapters.data ?? []
  const changePublication = (archive = false) => Modal.confirm({ title: archive ? '归档题库？' : '下架题库？', content: '从学生列表中移除题库，保留原有题目与记录。', okText: '确认操作', cancelText: '取消',
    onOk: async () => { try { await gateway.setBankPublication(id, archive ? 'ARCHIVED' : 'UNPUBLISHED'); refresh(); Message.success('题库状态已更新') } catch (error) { Message.error((error as Error).message); throw error } } })
  const chapterAction = (key: string, chapter: Chapter, index: number) => {
    if (key === 'edit') { saveChapter.reset(); setChapterEditor(chapter); setChapterName(chapter.name); return }
    if (key === 'up' || key === 'down') {
      const ids = chapterRows.map((c) => c.id)
      const target = index + (key === 'up' ? -1 : 1)
      if (target < 0 || target >= ids.length) return
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
      reorder.mutate(ids); return
    }
    if (rows.some((q) => q.chapterId === chapter.id)) { Modal.info({ title: '章节中仍有题目', content: '请先编辑题目，将它们移到其他章节或设为未分章，再删除空章节。', okText: '知道了' }); return }
    Modal.confirm({ title: '删除空章节？', content: `确认删除“${chapter.name}”？`, okText: '确认删除', cancelText: '取消',
      onOk: async () => { try { await gateway.deleteChapter(chapter.id); if (chapterId === chapter.id) selectChapter(); refresh(); Message.success('空章节已删除') } catch (error) { Message.error((error as Error).message); throw error } } })
  }
  return <section className="bw-page bw-bank-detail" aria-label="题库内容工作台">
    <Link className="bw-back" to={`/question-banks?course=${encodeURIComponent(bank.subjectId)}`}><IconArrowLeft /> 返回{course?.name ?? '课程'}题库</Link>
    <div className="bw-detail-hero"><div><div className="bw-location"><IconBook /> {course?.name}</div><PageTitle title={bank.name} description={bank.textbook || '补充教材和版本说明，帮助学生找到合适的复习内容。'} /></div><Space wrap>
      <Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => key === 'archive' ? changePublication(true) : setSettings('basic')}><Menu.Item key="settings">题库设置</Menu.Item>{bank.publicationStatus !== 'ARCHIVED' && <Menu.Item key="archive">归档题库</Menu.Item>}</Menu>}><Button icon={<IconMore />} aria-label="更多题库操作" /></Dropdown>
      {bank.publicationStatus === 'PUBLISHED' ? <Button status="warning" onClick={() => changePublication()}>下架题库</Button> : <Button type="primary" onClick={() => setPublishing(true)}>检查并发布</Button>}
    </Space></div>
    <div className="bw-detail-meta"><Tag color={publicationColors[bank.publicationStatus]}>{publicationLabels[bank.publicationStatus]}</Tag><span>{countQuestions(rows)} 道题</span><span>{chapterRows.length} 个章节</span><span>{countQuestions(rows.filter((q) => q.status === 'ACTIVE'))} 道已启用</span><span className="bw-detail-scope">{bank.scopeType === 'ALL' ? '全校可见' : bank.audiences.length ? `${bank.audiences.length} 组展示条件` : '展示范围待配置'}</span></div>
    {course?.status !== 'ACTIVE' && <Alert className="bw-detail-alert" type="warning" content="所属课程已停用，题库暂不在学生列表中展示。请到课程目录恢复启用。" />}
    <Tabs className="bw-detail-tabs" activeTab={tab} onChange={(value) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('tab', value); return next })}>
      <Tabs.TabPane key="questions" title="题目管理">
        <div className="bw-content-grid">
          <aside className="bw-chapters" aria-label="章节目录"><div className="bw-section-heading"><h2>章节目录</h2><Button type="text" size="mini" aria-label="新建章节" icon={<IconPlus />} onClick={() => { saveChapter.reset(); setChapterEditor(null); setChapterName('') }} /></div>
            <button className={`bw-chapter-choice ${!chapterId ? 'active' : ''}`} onClick={() => selectChapter()}><span>全部题目</span><small>{countQuestions(rows)}</small></button>
            <button className={`bw-chapter-choice ${chapterId === 'unassigned' ? 'active' : ''}`} onClick={() => selectChapter('unassigned')}><span>未分章</span><small>{countQuestions(rows.filter((q) => !q.chapterId))}</small></button>
            <div className="bw-chapter-divider" />
            {chapterRows.map((chapter, index) => <div className="bw-chapter-row" key={chapter.id}><button className={`bw-chapter-choice ${chapterId === chapter.id ? 'active' : ''}`} onClick={() => selectChapter(chapter.id)}><span>{chapter.name}</span><small>{countQuestions(rows.filter((q) => q.chapterId === chapter.id))}</small></button><Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => chapterAction(key, chapter, index)}><Menu.Item key="edit">编辑章节</Menu.Item><Menu.Item key="up" disabled={index === 0 || reorder.isPending}>上移章节</Menu.Item><Menu.Item key="down" disabled={index === chapterRows.length - 1 || reorder.isPending}>下移章节</Menu.Item><Menu.Item key="delete">删除章节</Menu.Item></Menu>}><Button size="mini" type="text" aria-label={`管理章节 ${chapter.name}`} icon={<IconMore />} /></Dropdown></div>)}
            {!chapterRows.length && <p className="bw-chapter-empty">可以先录入题目，再按章节逐步整理。</p>}
          </aside>
          <QuestionsManager bank={bank} questions={rows} chapters={chapterRows} chapterId={chapterId} loading={questions.isFetching} onImport={() => setImporting(true)} />
        </div>
      </Tabs.TabPane>
      <Tabs.TabPane key="basic" title="基本信息"><div className="bw-settings-block"><div className="bw-section-heading"><h2>题库基本信息</h2><Button onClick={() => setSettings('basic')}>编辑基本信息</Button></div><dl className="bw-basic-info">
        {[['题库名称', bank.name], ['所属课程', course?.name ?? '未知课程'], ['教材 / 版本', bank.textbook || '尚未填写'], ['最近更新', formatDate(bank.updatedAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl><div className="bw-bank-description"><h3>题库说明</h3><p>{bank.description || '尚未填写题库说明，发布前请补充。'}</p></div></div></Tabs.TabPane>
      <Tabs.TabPane key="scope" title="展示范围"><div className="bw-settings-block"><div className="bw-section-heading"><h2>题库展示范围</h2><Button onClick={() => setSettings('scope')}>调整展示范围</Button></div><p className="muted">学生符合任意一组条件即可展示，修改资料后重新匹配列表。</p><div className="bw-saved-scopes">{scopeLabels(bank, data).map((label) => <div key={label}><IconBook /><span>{label}</span></div>)}</div></div><ScopePreview bank={bank} directory={data} subjects={data.subjects} /></Tabs.TabPane>
    </Tabs>
    {settings && <BankSettingsDrawer bank={bank} data={data} initialTab={settings} onClose={() => setSettings(undefined)} onSaved={() => setSettings(undefined)} />}
    {importing && <ImportQuestionsModal bank={bank} defaultChapterId={chapterId === 'unassigned' ? undefined : chapterId} onClose={() => setImporting(false)} />}
    {publishing && <PublicationModal bank={bank} data={data} questions={rows} chapters={chapterRows} onClose={() => setPublishing(false)} />}
    <Modal className="bw-chapter-editor" title={chapterEditor ? '编辑章节' : '新建章节'} visible={chapterEditor !== undefined} style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }} maskClosable={false}
      confirmLoading={saveChapter.isPending} onOk={() => { if (!saveChapter.isPending) saveChapter.mutate() }} onCancel={() => { if (!saveChapter.isPending) setChapterEditor(undefined) }}
      closable={!saveChapter.isPending} cancelButtonProps={{ disabled: saveChapter.isPending }} okText="保存章节" cancelText="取消">
      {saveChapter.error && <Alert type="error" className="bw-form-error" content={saveChapter.error.message} />}
      <label className="input-label">章节名称<Input placeholder="例如：第一章 函数与极限" value={chapterName} onChange={(value) => { setChapterName(value); saveChapter.reset() }} maxLength={60} disabled={saveChapter.isPending} /></label>
    </Modal>
  </section>
}
