import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Input, Message, Modal, Select, Space, Spin, Table, Tag, Tree } from '@arco-design/web-react'
import { IconBook, IconCalendar, IconDown, IconFolder, IconInfoCircle, IconPlus, IconRefresh, IconRight, IconUp, IconUserGroup } from '@arco-design/web-react/icon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DesignIcon } from '../../components/design-icon'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { referencesGrade } from '../../lib/directory'
import { getErrorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import type { College, Grade, Major, QuestionBank } from '../../types/admin'
import type { ManagedUser } from '../../types/operations'
import { DirectoryEditorModal, type DirectoryEntry, type EditorTarget } from './directory-editor-modal'

const emptyDirectory = { colleges: [] as College[], majors: [] as Major[], grades: [] as Grade[], users: [] as ManagedUser[], banks: [] as QuestionBank[] }
const labels = { college: '学院', major: '专业', grade: '年级' }
const entryName = (entry: DirectoryEntry) => entry.kind === 'grade' ? `${entry.record.enrollmentYear} 级` : entry.record.name
const entryIcon = (kind: DirectoryEntry['kind']) => kind === 'college' ? <DesignIcon name="college" /> : kind === 'major' ? <IconBook /> : <IconCalendar />

export function CollegesPage() {
  const gateway = useAdminGateway()
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState('all')
  const [treeSearch, setTreeSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('ALL')
  const [expandedKeys, setExpandedKeys] = useState<string[]>()
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const directory = useQuery({
    queryKey: ['organization-directory'],
    queryFn: async () => {
      const [colleges, majors, grades, users, banks] = await Promise.all([
        gateway.listColleges(), gateway.listMajors(), gateway.listGrades(), gateway.listUsers(), gateway.listQuestionBanks(),
      ])
      return { colleges, majors, grades, users, banks }
    },
  })
  const { colleges, majors, grades, users, banks } = directory.data ?? emptyDirectory
  const currentExpandedKeys = expandedKeys ?? colleges.map((college) => college.id)
  const entries: DirectoryEntry[] = [
    ...colleges.map((record) => ({ kind: 'college' as const, record })),
    ...majors.map((record) => ({ kind: 'major' as const, record })),
    ...grades.map((record) => ({ kind: 'grade' as const, record })),
  ]
  const selected = entries.find((entry) => entry.record.id === selectedKey)
  const selectedGrade = selected?.kind === 'grade' ? selected.record : undefined
  const selectedMajor = selected?.kind === 'major' ? selected.record : majors.find((m) => m.id === selectedGrade?.majorId)
  const selectedCollege = selected?.kind === 'college' ? selected.record : colleges.find((c) => c.id === selectedMajor?.collegeId)
  const level = selected?.kind === 'college' ? 'major' : selected?.kind === 'major' ? 'grade' : 'college'
  const scopeRows = entries.filter((entry) => !selected ? entry.kind === 'college'
    : selected.kind === 'college' ? entry.kind === 'major' && entry.record.collegeId === selected.record.id
    : selected.kind === 'major' ? entry.kind === 'grade' && entry.record.majorId === selected.record.id : false)
  const matches = (value: string, search: string) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())

  useEffect(() => {
    if (directory.data && selectedKey !== 'all' && ![
      ...directory.data.colleges, ...directory.data.majors, ...directory.data.grades,
    ].some((record) => record.id === selectedKey)) setSelectedKey('all')
  }, [directory.data, selectedKey])

  const select = (key: string) => {
    setSelectedKey(key)
    setKeyword('')
    setStatus('ALL')
    const grade = grades.find((g) => g.id === key)
    const major = majors.find((m) => m.id === (grade?.majorId ?? key))
    setExpandedKeys((keys) => [...new Set([...(keys ?? colleges.map((c) => c.id)), key, ...(major ? [major.collegeId, major.id] : [])])])
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['organization-directory'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['bank-workbench'] })
  }
  const peopleFor = (entry: DirectoryEntry) => users.filter((u) => entry.kind === 'college'
    ? u.collegeId === entry.record.id : entry.kind === 'major' ? u.majorId === entry.record.id
    : u.majorId === entry.record.majorId && u.enrollmentYear === entry.record.enrollmentYear)
  const bankReferences = (entry: DirectoryEntry) => banks.filter((b) => b.scopeType === 'TARGETED' && b.audiences.some((a) => entry.kind === 'college'
    ? a.collegeId === entry.record.id : entry.kind === 'major' ? a.majorId === entry.record.id
    : referencesGrade(a, entry.record, majors.find((m) => m.id === entry.record.majorId)!))).length
  const isAvailable = (entry: DirectoryEntry) => {
    const major = entry.kind === 'major' ? entry.record : entry.kind === 'grade' ? majors.find((m) => m.id === entry.record.majorId) : undefined
    const college = entry.kind === 'college' ? entry.record : colleges.find((c) => c.id === major?.collegeId)
    return entry.record.status === 'ACTIVE' && college?.status === 'ACTIVE' && (!major || major.status === 'ACTIVE')
  }
  const statusTag = (entry: DirectoryEntry) => <Tag color={isAvailable(entry) ? 'green' : 'gray'}>{isAvailable(entry) ? '可选' : entry.record.status === 'ACTIVE' ? '随上级停用' : '已停用'}</Tag>
  const edit = (entry: DirectoryEntry) => {
    if (entry.kind === 'college') setEditor(entry)
    else if (entry.kind === 'major') setEditor({ ...entry, college: colleges.find((c) => c.id === entry.record.collegeId)! })
    else {
      const major = majors.find((m) => m.id === entry.record.majorId)!
      setEditor({ ...entry, major, college: colleges.find((c) => c.id === major.collegeId)! })
    }
  }
  const add = () => {
    if (selected?.kind === 'college') setEditor({ kind: 'major', college: selected.record })
    else if (selected?.kind === 'major') setEditor({ kind: 'grade', major: selected.record, college: selectedCollege! })
    else setEditor({ kind: 'college' })
  }
  const remove = (entry: DirectoryEntry) => {
    const childCount = entry.kind === 'college' ? majors.filter((m) => m.collegeId === entry.record.id).length
      : entry.kind === 'major' ? grades.filter((g) => g.majorId === entry.record.id).length : 0
    const bankCount = bankReferences(entry)
    if (childCount || peopleFor(entry).length || bankCount) {
      Modal.info({
        title: `暂时无法删除${labels[entry.kind]}`,
        content: <><p>“{entryName(entry)}”仍有{[childCount ? `${childCount} 个下级分类` : '', peopleFor(entry).length ? `${peopleFor(entry).length} 名学生` : '', bankCount ? `${bankCount} 份题库引用` : ''].filter(Boolean).join('、')}。</p><p>请先处理关联，或在编辑中将其停用，以保留已有资料。</p></>,
        okText: '知道了',
      })
      return
    }
    Modal.confirm({
      title: `删除${labels[entry.kind]}？`,
      content: `确认删除“${entryName(entry)}”？删除后将不再出现在学生可选目录中。`,
      okText: '确认删除', cancelText: '取消', okButtonProps: { status: 'danger' },
      onOk: async () => {
        setDeleting(true)
        try {
          if (entry.kind === 'college') await gateway.deleteCollege(entry.record.id)
          else if (entry.kind === 'major') await gateway.deleteMajor(entry.record.id)
          else await gateway.deleteGrade(entry.record.id)
          Message.success('已删除')
          if (selectedKey === entry.record.id) select(entry.kind === 'college' ? 'all' : entry.kind === 'major' ? entry.record.collegeId : entry.record.majorId)
          refresh()
        } catch (error) {
          Message.error(getErrorMessage(error))
          throw error
        } finally { setDeleting(false) }
      },
    })
  }
  const title = selected ? entryName(selected) : '全部学院'
  const filteredRows = scopeRows.filter((entry) => matches(`${entryName(entry)} ${'code' in entry.record ? entry.record.code : ''}`, keyword) &&
    (status === 'ALL' || (status === 'ACTIVE' ? isAvailable(entry) : !isAvailable(entry))))
  const treeLabel = (entry: DirectoryEntry, count?: number) => <span className={`directory-tree-label ${isAvailable(entry) ? '' : 'is-inactive'}`}><span className="directory-tree-icon">{entryIcon(entry.kind)}</span><span className="directory-tree-name">{entryName(entry)}</span>{count !== undefined && <small>{count}</small>}</span>
  const treeData = colleges.flatMap((college) => {
    const collegeEntry: DirectoryEntry = { kind: 'college', record: college }
    const collegeMatches = matches(`${college.name} ${college.code}`, treeSearch)
    const children = majors.filter((m) => m.collegeId === college.id).flatMap((major) => {
      const majorEntry: DirectoryEntry = { kind: 'major', record: major }
      const majorMatches = collegeMatches || matches(`${major.name} ${major.code}`, treeSearch)
      const yearNodes = grades.filter((g) => g.majorId === major.id && (majorMatches || matches(`${g.enrollmentYear} 级`, treeSearch))).map((grade) => ({ key: grade.id, title: treeLabel({ kind: 'grade', record: grade }), isLeaf: true }))
      return majorMatches || yearNodes.length ? [{ key: major.id, title: treeLabel(majorEntry), children: yearNodes }] : []
    })
    return collegeMatches || children.length ? [{ key: college.id, title: treeLabel(collegeEntry, majors.filter((m) => m.collegeId === college.id).length), children }] : []
  })
  const columns = [
    { title: `${labels[level]}名称`, dataIndex: 'name', width: 230, render: (_: unknown, entry: DirectoryEntry) => <button className="directory-entity" onClick={() => select(entry.record.id)}><span className={`directory-entity-icon ${entry.kind}`}>{entryIcon(entry.kind)}</span><span><strong>{entryName(entry)}</strong>{'code' in entry.record && <small>{entry.record.code}</small>}</span></button> },
    ...(level !== 'grade' ? [{ title: level === 'college' ? '专业数' : '年级数', width: 90, render: (_: unknown, entry: DirectoryEntry) => entry.kind === 'college' ? majors.filter((m) => m.collegeId === entry.record.id).length : grades.filter((g) => g.majorId === entry.record.id).length }] : []),
    { title: '学生人数', width: 100, render: (_: unknown, entry: DirectoryEntry) => <span className="directory-count">{peopleFor(entry).length}<small> 人</small></span> },
    { title: '可选状态', width: 110, render: (_: unknown, entry: DirectoryEntry) => statusTag(entry) },
    { title: '操作', width: 230, render: (_: unknown, entry: DirectoryEntry) => <Space size={4}><Button type="text" size="small" onClick={() => select(entry.record.id)}>{entry.kind === 'college' ? '管理专业' : entry.kind === 'major' ? '管理年级' : '查看学生'}</Button><Button type="text" size="small" onClick={() => edit(entry)}>编辑</Button><Button type="text" status="danger" size="small" disabled={deleting} onClick={() => remove(entry)}>删除</Button></Space> },
  ]
  const treeKeys = [...colleges.map((c) => c.id), ...majors.map((m) => m.id)]
  if (directory.isPending) return <div className="directory-loading"><Spin tip="正在加载院系目录" /></div>
  if (directory.error) return <ErrorState message={directory.error.message} onRetry={() => void directory.refetch()} />
  return (
    <section aria-label="院级管理" className="directory-page">
      <div className="directory-summary">
        {[
          { label: '学院', value: colleges.length, icon: <DesignIcon name="college" />, tone: 'blue' },
          { label: '专业', value: majors.length, icon: <IconBook />, tone: 'purple' },
          { label: '专业年级', value: grades.length, icon: <IconCalendar />, tone: 'orange' },
          { label: '已归属学生', value: users.filter((u) => grades.some((g) => g.majorId === u.majorId && g.enrollmentYear === u.enrollmentYear)).length, icon: <IconUserGroup />, tone: 'green' },
        ].map((item) => <div className="directory-summary-item" key={item.label}><span className={`directory-summary-icon ${item.tone}`}>{item.icon}</span><div><span>{item.label}</span><strong>{item.value}<small>{item.label === '已归属学生' ? '人' : '个'}</small></strong></div></div>)}
      </div>
      <div className="directory-workspace">
        <aside className="directory-tree-panel" aria-label="组织目录">
          <div className="directory-panel-heading"><h2>组织目录</h2><Button type="text" size="mini" icon={currentExpandedKeys.length ? <IconUp /> : <IconDown />} onClick={() => setExpandedKeys(currentExpandedKeys.length ? [] : treeKeys)} aria-label={currentExpandedKeys.length ? '收起全部目录' : '展开全部目录'} /></div>
          <Input.Search aria-label="搜索组织目录" placeholder="搜索学院、专业或年级" value={treeSearch} allowClear onChange={setTreeSearch} />
          <div className="directory-tree-scroll">
            <button className={`directory-all ${selectedKey === 'all' ? 'active' : ''}`} onClick={() => select('all')}><IconFolder /><span>全部学院</span><small>{colleges.length}</small></button>
            {treeData.length ? <Tree blockNode animation={false} treeData={treeData} selectedKeys={[selectedKey]} expandedKeys={treeSearch.trim() ? treeKeys : currentExpandedKeys} onExpand={setExpandedKeys} onSelect={(keys) => { if (keys[0]) select(keys[0]) }} /> : <p className="directory-tree-empty">{treeSearch ? '未找到匹配的目录' : '还没有学院，先从新增学院开始'}</p>}
          </div>
          <div className="directory-tree-footer"><IconInfoCircle /><span>这里维护学生可选目录，题库展示范围在题库工作台设置。</span></div>
        </aside>
        <div className="directory-detail-panel">
          <div className="directory-path"><button onClick={() => select('all')}>全校目录</button>{selectedCollege && <><IconRight /><button onClick={() => select(selectedCollege.id)}>{selectedCollege.name}</button></>}{selectedMajor && <><IconRight /><button onClick={() => select(selectedMajor.id)}>{selectedMajor.name}</button></>}{selectedGrade && <><IconRight /><span>{selectedGrade.enrollmentYear} 级</span></>}</div>
          <div className="directory-detail-heading"><div><div className="directory-title-line"><h2>{title}</h2>{selected && statusTag(selected)}</div><p>{selectedGrade ? '查看该年级的资料归属，保留每一位学生的学习记录。' : `管理${selected ? '当前' + (selected.kind === 'college' ? '学院下的专业' : '专业下的年级') : '当前大学的学院'}，共 ${scopeRows.length} 个。`}</p></div>{selectedGrade ? <Button icon={<IconPlus />} onClick={() => setEditor({ kind: 'grade', major: selectedMajor!, college: selectedCollege! })}>新增同专业年级</Button> : <Button type="primary" icon={<IconPlus />} onClick={add}>新增{labels[level]}</Button>}</div>
          {selected && !isAvailable(selected) && <Alert className="directory-status-alert" type="warning" content="当前分类或其上级已停用，暂停供学生新选择；已有归属和学习记录继续保留。" />}
          {selectedGrade ? <>
            <div className="directory-grade-overview"><div><span>入学年份</span><strong>{selectedGrade.enrollmentYear}<small> 年</small></strong></div><div><span>归属学生</span><strong>{peopleFor(selected!).length}<small> 人</small></strong></div><div className="directory-grade-actions"><Button onClick={() => edit(selected!)}>编辑年级</Button><Button status="danger" disabled={deleting} onClick={() => remove(selected!)}>删除年级</Button></div></div>
            <div className="directory-students-heading"><h3>归属学生</h3><span>只读查看</span></div>
            <Table<ManagedUser> rowKey="id" data={peopleFor(selected!)} border={false} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 500 }} columns={[
              { title: '学生姓名', dataIndex: 'name' }, { title: '账号', dataIndex: 'account' },
              { title: '账号状态', render: (_: unknown, user: ManagedUser) => <Tag color={user.status === 'ACTIVE' ? 'green' : 'gray'}>{user.status === 'ACTIVE' ? '正常' : user.status === 'DISABLED' ? '已停用' : '待激活'}</Tag> },
            ]} noDataElement={<Empty description="还没有学生选择这个年级，目录已可提前维护" />} />
            <p className="directory-updated">最近更新：{formatDate(selectedGrade.updatedAt)}</p>
          </> : <>
            <div className="directory-toolbar"><Input.Search aria-label={`搜索${labels[level]}`} placeholder={`搜索${labels[level]}名称${level === 'grade' ? '' : '或代码'}`} value={keyword} allowClear onChange={setKeyword} /><Select aria-label="筛选可选状态" value={status} onChange={setStatus} options={[{ label: '全部状态', value: 'ALL' }, { label: '学生可选', value: 'ACTIVE' }, { label: '已停用', value: 'INACTIVE' }]} /><Button aria-label="刷新院系目录" icon={<IconRefresh />} loading={directory.isFetching} onClick={() => void directory.refetch()} /></div>
            <Table<DirectoryEntry> rowKey={(entry) => entry.record.id} columns={columns} data={filteredRows} border={false} loading={directory.isFetching} scroll={{ x: level === 'grade' ? 670 : 760 }} pagination={{ pageSize: 8, hideOnSinglePage: true }} noDataElement={<div className="directory-table-empty"><Empty description={scopeRows.length ? '没有符合条件的结果' : `还没有${labels[level]}`} /><Button type={scopeRows.length ? 'secondary' : 'primary'} onClick={scopeRows.length ? () => { setKeyword(''); setStatus('ALL') } : add}>{scopeRows.length ? '清空筛选' : `新增${labels[level]}`}</Button></div>} />
          </>}
          <div className="directory-detail-footer"><IconUserGroup /><span>人数根据平台学生填写的资料统计；未完善归属的学生不计入当前分类。</span></div>
        </div>
      </div>
      {editor && <DirectoryEditorModal target={editor}
        existingYears={editor.kind === 'grade' ? grades.filter((g) => g.majorId === editor.major.id).map((g) => g.enrollmentYear) : []}
        yearLocked={Boolean(editor.kind === 'grade' && editor.record && (peopleFor({ kind: 'grade', record: editor.record }).length || bankReferences({ kind: 'grade', record: editor.record })))}
        onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); refresh() }} />}
    </section>
  )
}
