import { useState } from 'react'
import { Alert, Button, Radio, Select, Tag } from '@arco-design/web-react'
import { IconDelete, IconEye, IconPlus } from '@arco-design/web-react/icon'
import type { QuestionBank, Subject } from '../../types/admin'
import { bankVisibility, emptyScopeGroup, groupsToAudiences, scopeLabels, type AudienceDirectory, type ScopeGroup } from '../../lib/bank-workbench'

export function DirectorySelectors({ directory, value, onChange, multipleYears = false, disabled = false, prefix }: {
  directory: AudienceDirectory
  value: ScopeGroup
  onChange: (value: ScopeGroup) => void
  multipleYears?: boolean
  disabled?: boolean
  prefix: string
}) {
  const majors = directory.majors.filter((m) => !value.collegeId || m.collegeId === value.collegeId)
  const years = [...new Set(directory.grades.filter((g) => (!value.majorId || g.majorId === value.majorId) && majors.some((m) => m.id === g.majorId)).map((g) => g.enrollmentYear))].sort((a, b) => b - a)
  return <div className="bw-directory-selectors">
    <label><span>学院</span><Select aria-label={`${prefix}学院`} value={value.collegeId ?? ''} disabled={disabled} showSearch
      onChange={(collegeId) => onChange({ ...value, collegeId: collegeId || undefined, majorId: undefined, years: [] })}
      options={[{ label: '全部学院', value: '' }, ...directory.colleges.map((c) => ({ label: `${c.name}${c.status === 'INACTIVE' ? '（已停用）' : ''}`, value: c.id }))]} /></label>
    <label><span>专业</span><Select aria-label={`${prefix}专业`} value={value.majorId ?? ''} disabled={disabled} showSearch
      onChange={(majorId) => onChange({ ...value, collegeId: directory.majors.find((m) => m.id === majorId)?.collegeId ?? value.collegeId, majorId: majorId || undefined, years: [] })}
      options={[{ label: '全部专业', value: '' }, ...majors.map((m) => ({ label: `${m.name}${m.status === 'INACTIVE' ? '（已停用）' : ''}`, value: m.id }))]} /></label>
    <label><span>入学年级{multipleYears ? '（可多选）' : ''}</span><Select aria-label={`${prefix}年级`} value={multipleYears ? value.years : value.years[0]} mode={multipleYears ? 'multiple' : undefined}
      placeholder={multipleYears ? '全部年级' : '选择入学年级'} allowClear disabled={disabled} showSearch
      onChange={(year) => onChange({ ...value, years: multipleYears ? year : year === undefined ? [] : [year] })}
      options={years.map((year) => ({ label: `${year} 级`, value: year }))} /></label>
  </div>
}

export function ScopeEditor({ directory, scopeType, groups, onTypeChange, onChange, disabled }: {
  directory: AudienceDirectory
  scopeType: 'ALL' | 'TARGETED'
  groups: ScopeGroup[]
  onTypeChange: (type: 'ALL' | 'TARGETED') => void
  onChange: (groups: ScopeGroup[]) => void
  disabled: boolean
}) {
  const labels = scopeLabels({ scopeType, audiences: groupsToAudiences(groups) }, directory)
  return <div className="bw-scope-editor">
    <h3>哪些学生可以看到这个题库？</h3>
    <Radio.Group className="bw-scope-mode" value={scopeType} disabled={disabled} onChange={onTypeChange}>
      <Radio value="ALL">全校可见</Radio><Radio value="TARGETED">指定范围</Radio>
    </Radio.Group>
    {scopeType === 'ALL' ? <Alert type="info" content="向全校学生展示，不限定学院、专业和入学年级。" /> : <>
      <p className="muted">每组条件同时满足，多组之间满足任意一组即可。下级选择“全部”表示不限定，面向全校请选择上方“全校可见”。</p>
      {groups.map((group, index) => <div className="bw-scope-group" key={group.id}>
        <div className="bw-scope-group-heading"><span>展示对象 {index + 1}</span><Button aria-label={`移除展示对象 ${index + 1}`} type="text" status="danger" icon={<IconDelete />} disabled={disabled} onClick={() => onChange(groups.filter((g) => g.id !== group.id))} /></div>
        <DirectorySelectors directory={directory} value={group} multipleYears prefix={`展示对象${index + 1}`} disabled={disabled} onChange={(next) => onChange(groups.map((g) => g.id === group.id ? next : g))} />
      </div>)}
      <Button type="dashed" long icon={<IconPlus />} disabled={disabled} onClick={() => onChange([...groups, emptyScopeGroup()])}>添加一组展示范围</Button>
      {!directory.colleges.length && <p className="muted">还没有院系目录，可以先保存草稿，之后在院级管理中建立分类。</p>}
    </>}
    <div className="bw-scope-summary"><span>范围摘要</span>{labels.map((label) => <p key={label}>{label}</p>)}</div>
    <p className="bw-form-note">学生修改并保存院系资料后，重新匹配题库列表；已有学习记录保留。已停用分类可供原有归属学生匹配。</p>
  </div>
}

export function ScopePreview({ bank, directory, subjects }: { bank: QuestionBank; directory: AudienceDirectory; subjects: Subject[] }) {
  const [profile, setProfile] = useState<ScopeGroup>({ id: 'preview', years: [] })
  const result = bankVisibility(bank, { collegeId: profile.collegeId, majorId: profile.majorId, enrollmentYear: profile.years[0] }, subjects)
  const selected = bank.scopeType === 'ALL' || Boolean(profile.collegeId || profile.majorId || profile.years.length)
  return <section className="bw-scope-preview">
    <div className="bw-section-heading"><h3><IconEye /> 学生资料匹配预览</h3><Tag color="arcoblue">预览</Tag></div>
    <p className="muted">选择一组学生资料，检查这个题库是否会出现在他的列表中。</p>
    <DirectorySelectors directory={directory} value={profile} onChange={setProfile} prefix="预览" />
    <div className={`bw-preview-result ${selected && result.visible ? 'is-visible' : ''}`} role="status">
      {selected ? <><Tag color={result.visible ? 'green' : result.matches ? 'orange' : 'gray'}>{result.visible ? '会展示' : result.matches ? '范围匹配' : '不展示'}</Tag><span>{result.message}</span></> : <span>请选择学生资料后查看匹配结果。</span>}
    </div>
  </section>
}
