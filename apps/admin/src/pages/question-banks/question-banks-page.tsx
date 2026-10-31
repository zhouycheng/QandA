import { useEffect, useState } from 'react'
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Space, Spin, Table, Tag } from '@arco-design/web-react'
import { IconBook, IconFile, IconFolder, IconInfoCircle, IconMore, IconPlus, IconRefresh } from '@arco-design/web-react/icon'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { scopeLabels } from '../../lib/bank-workbench'
import { formatDate } from '../../lib/format'
import { publicationColors, publicationLabels } from '../../lib/recommendations'
import type { QuestionBank, Subject } from '../../types/admin'
import { BankSettingsDrawer } from './bank-settings-drawer'
import { CourseEditorModal } from './course-editor-modal'
import { refreshWorkbench, useWorkbenchData } from './workbench-data'

export function QuestionBanksPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const courseId = params.get('course') ?? ''
  const [courseSearch, setCourseSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('ALL')
  const [courseEditor, setCourseEditor] = useState<Subject | null | undefined>()
  const [bankEditor, setBankEditor] = useState<{ bank?: QuestionBank; tab: 'basic' | 'scope' }>()
  const dataQuery = useWorkbenchData()
  const data = dataQuery.data
  useEffect(() => {
    if (data && !dataQuery.isFetching && courseId && !data.subjects.some((s) => s.id === courseId)) setParams({}, { replace: true })
  }, [courseId, data, dataQuery.isFetching, setParams])
  const selectCourse = (id: string) => { setParams(id ? { course: id } : {}); setKeyword(''); setStatus('ALL') }
  if (dataQuery.isPending) return <div className="directory-loading"><Spin tip="正在加载题库工作台" /></div>
  if (dataQuery.error) return <ErrorState message={dataQuery.error.message} onRetry={() => void dataQuery.refetch()} />
  if (!data) return null
  const course = data.subjects.find((s) => s.id === courseId)
  const scoped = data.banks.filter((b) => !course || b.subjectId === course.id)
  const matching = scoped.filter((b) => (status === 'ALL' || b.publicationStatus === status) &&
    `${b.name} ${b.textbook} ${data.subjects.find((s) => s.id === b.subjectId)?.name ?? ''}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const openBank = (bank: QuestionBank) => navigate(`/question-banks/${bank.id}`)
  const removeCourse = (subject: Subject) => {
    if (data.banks.some((b) => b.subjectId === subject.id)) {
      Modal.info({ title: '暂时无法删除课程', content: '当前课程下仍有题库。可以停用课程以保留内容与学生记录。', okText: '知道了' })
      return
    }
    Modal.confirm({ title: '删除课程？', content: `确认删除“${subject.name}”？已有学生关联的课程会受到保护。`, okText: '确认删除', cancelText: '取消', okButtonProps: { status: 'danger' },
      onOk: async () => { try { await gateway.deleteSubject(subject.id); if (courseId === subject.id) selectCourse(''); refreshWorkbench(client); Message.success('课程已删除') } catch (error) { Message.error((error as Error).message); throw error } } })
  }
  const bankAction = (key: string, bank: QuestionBank) => {
    if (key === 'basic' || key === 'scope') { setBankEditor({ bank, tab: key }); return }
    if (key === 'delete' && bank.questionCount) {
      Modal.info({ title: '暂时无法删除题库', content: '题库中仍有题目。可以下架或归档，保留原有内容及学习关联。', okText: '知道了' }); return
    }
    Modal.confirm({ title: key === 'delete' ? '删除题库？' : key === 'archive' ? '归档题库？' : '下架题库？',
      content: key === 'delete' ? `确认删除“${bank.name}”？关联章节、学生选择或反馈时会阻止删除。` : '操作后将从学生列表中移除，保留原有题目与记录。',
      okText: '确认操作', cancelText: '取消', okButtonProps: { status: key === 'delete' ? 'danger' : 'warning' },
      onOk: async () => { try { if (key === 'delete') await gateway.deleteQuestionBank(bank.id); else await gateway.setBankPublication(bank.id, key === 'archive' ? 'ARCHIVED' : 'UNPUBLISHED'); refreshWorkbench(client); Message.success('题库已更新') } catch (error) { Message.error((error as Error).message); throw error } },
    })
  }
  return <section className="bw-page" aria-label="题库工作台">
    <div className="bw-overview">
      {[{ label: '课程目录', value: data.subjects.length, icon: <IconBook />, tone: 'blue' },
        { label: '全部题库', value: data.banks.length, icon: <IconFolder />, tone: 'purple' },
        { label: '已发布', value: data.banks.filter((b) => b.publicationStatus === 'PUBLISHED').length, icon: <IconFile />, tone: 'green' },
        { label: '待完善草稿', value: data.banks.filter((b) => b.publicationStatus === 'DRAFT').length, icon: <IconFile />, tone: 'orange' },
      ].map((item) => <div className="bw-overview-item" key={item.label}><span className={`directory-summary-icon ${item.tone}`}>{item.icon}</span><div><span>{item.label}</span><strong>{item.value}<small>{item.label === '课程目录' ? '门' : '份'}</small></strong></div></div>)}
    </div>
    <div className="bw-catalogue">
      <aside className="bw-courses" aria-label="课程目录">
        <div className="bw-section-heading"><h2>课程目录</h2><Button type="text" size="mini" icon={<IconPlus />} aria-label="新建课程" onClick={() => setCourseEditor(null)} /></div>
        <Input.Search aria-label="搜索课程目录" value={courseSearch} onChange={setCourseSearch} allowClear placeholder="搜索课程名称" />
        <div className="bw-course-list">
          <button className={`bw-course-choice ${!course ? 'active' : ''}`} onClick={() => selectCourse('')}><IconFolder /><span>全部课程</span><small>{data.banks.length}</small></button>
          {data.subjects.filter((s) => s.name.toLocaleLowerCase().includes(courseSearch.trim().toLocaleLowerCase())).map((subject) => <div className={`bw-course-row ${courseId === subject.id ? 'active' : ''}`} key={subject.id}>
            <button className="bw-course-choice" onClick={() => selectCourse(subject.id)}><IconBook /><span>{subject.name}{subject.status === 'INACTIVE' && <em>已停用</em>}</span><small>{data.banks.filter((b) => b.subjectId === subject.id).length}</small></button>
            <Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => key === 'edit' ? setCourseEditor(subject) : removeCourse(subject)}><Menu.Item key="edit">编辑课程</Menu.Item><Menu.Item key="delete">删除课程</Menu.Item></Menu>}>
              <Button type="text" size="mini" aria-label={`管理课程 ${subject.name}`} icon={<IconMore />} />
            </Dropdown>
          </div>)}
          {!data.subjects.length && <div className="bw-course-empty"><p>先建立课程，再添加第一份题库。</p><Button size="small" onClick={() => setCourseEditor(null)}>新建课程</Button></div>}
          {data.subjects.length > 0 && !data.subjects.some((s) => s.name.toLocaleLowerCase().includes(courseSearch.trim().toLocaleLowerCase())) && <p className="empty-note">没有匹配的课程</p>}
        </div>
        <div className="bw-side-note"><IconInfoCircle /><span>一门课程可维护多份题库，按教材版本或复习用途分别整理。</span></div>
      </aside>
      <div className="bw-bank-panel">
        <div className="bw-location">课程目录 <span>/</span> {course?.name ?? '全部课程'}</div>
        <div className="bw-panel-heading"><div><h2>{course?.name ?? '全部题库'}{course?.status === 'INACTIVE' && <Tag color="gray">课程已停用</Tag>}</h2><p>{course ? '当前课程' : '全部课程'}下共 {scoped.length} 份题库，发布后按学生资料匹配展示。</p></div><Button type="primary" icon={<IconPlus />} onClick={() => setBankEditor({ tab: 'basic' })}>新建题库</Button></div>
        {course?.status === 'INACTIVE' && <div className="bw-course-warning"><IconInfoCircle /><span>当前课程已停用，其题库暂停在学生列表中展示。</span><Button size="mini" type="text" onClick={() => setCourseEditor(course)}>编辑课程</Button></div>}
        <div className="bw-status-filters" aria-label="按发布状态筛选">{(['ALL', 'DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'] as const).map((value) => <button key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value === 'ALL' ? '全部' : publicationLabels[value]}<small>{scoped.filter((b) => value === 'ALL' || b.publicationStatus === value).length}</small></button>)}</div>
        <div className="bw-list-toolbar"><Input.Search aria-label="搜索题库" placeholder="搜索题库、教材或课程" value={keyword} onChange={setKeyword} allowClear /><Button icon={<IconRefresh />} aria-label="刷新题库" loading={dataQuery.isFetching} onClick={() => void dataQuery.refetch()} /></div>
        <Table<QuestionBank> className="bw-bank-table" rowKey="id" data={matching} loading={dataQuery.isFetching} border={false} scroll={{ x: 920 }} pagination={{ pageSize: 8, hideOnSinglePage: true }} columns={[
          { title: '题库名称 / 教材', width: 270, render: (_, bank) => <button className="bw-bank-name" onClick={() => openBank(bank)}><span className="bw-bank-icon"><IconBook /></span><span><strong>{bank.name}</strong><small>{!course && `${data.subjects.find((s) => s.id === bank.subjectId)?.name ?? '未知课程'} · `}{bank.textbook || '教材说明待补充'}</small></span></button> },
          { title: '展示范围', width: 230, render: (_, bank) => <div className="bw-range-cell" title={scopeLabels(bank, data).join('\n')}>{scopeLabels(bank, data).slice(0, 2).map((label) => <Tag key={label} color={bank.scopeType === 'ALL' ? 'arcoblue' : 'gray'}>{label}</Tag>)}{bank.audiences.length > 2 && <small>另有 {bank.audiences.length - 2} 组条件</small>}</div> },
          { title: '题目数', width: 90, render: (_, bank) => <span className="bw-number">{bank.questionCount}<small> 道</small></span> },
          { title: '发布状态', width: 100, render: (_, bank) => <Tag color={publicationColors[bank.publicationStatus]}>{publicationLabels[bank.publicationStatus]}</Tag> },
          { title: '最近更新', width: 150, render: (_, bank) => <span className="bw-updated">{formatDate(bank.updatedAt)}</span> },
          { title: '操作', width: 190, render: (_, bank) => <Space size={2}><Button type="text" size="small" onClick={() => openBank(bank)}>管理题目</Button><Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => bankAction(key, bank)}><Menu.Item key="basic">编辑基本信息</Menu.Item><Menu.Item key="scope">调整展示范围</Menu.Item>{bank.publicationStatus === 'PUBLISHED' && <Menu.Item key="unpublish">下架题库</Menu.Item>}{bank.publicationStatus !== 'ARCHIVED' && <Menu.Item key="archive">归档题库</Menu.Item>}<Menu.Item key="delete">删除题库</Menu.Item></Menu>}><Button type="text" size="small" aria-label={`更多操作 ${bank.name}`}>更多</Button></Dropdown></Space> },
        ]} noDataElement={<div className="bw-table-empty"><Empty description={scoped.length ? '没有符合条件的题库' : '还没有题库，从第一份复习内容开始'} /><Button type={scoped.length ? 'secondary' : 'primary'} onClick={scoped.length ? () => { setKeyword(''); setStatus('ALL') } : () => setBankEditor({ tab: 'basic' })}>{scoped.length ? '清空筛选' : '新建题库'}</Button></div>} />
        <div className="bw-panel-foot"><IconInfoCircle /><span>先保存草稿，再整理题目与展示范围，检查通过后发布。</span></div>
      </div>
    </div>
    {courseEditor !== undefined && <CourseEditorModal course={courseEditor ?? undefined} onClose={() => setCourseEditor(undefined)} onSaved={(result) => { setCourseEditor(undefined); selectCourse(result.id); refreshWorkbench(client) }} />}
    {bankEditor && <BankSettingsDrawer bank={bankEditor.bank} subjectId={course?.id} data={data} initialTab={bankEditor.tab} onClose={() => setBankEditor(undefined)} onSaved={(result) => { const created = !bankEditor.bank; setBankEditor(undefined); if (created) openBank(result) }} />}
  </section>
}
