import { useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Message, Modal, Select, Space, Tabs } from '@arco-design/web-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import type { QuestionBank } from '../../types/admin'
import { CourseEditorModal } from './course-editor-modal'
import { audienceGroups, emptyScopeGroup, groupsToAudiences } from '../../lib/bank-workbench'
import { ScopeEditor } from './scope-editor'
import { refreshWorkbench, type WorkbenchData } from './workbench-data'

export function BankSettingsDrawer({ bank, subjectId, data, initialTab = 'basic', onClose, onSaved }: {
  bank?: QuestionBank
  subjectId?: string
  data: WorkbenchData
  initialTab?: 'basic' | 'scope'
  onClose: () => void
  onSaved: (bank: QuestionBank) => void
}) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [form] = Form.useForm<{ subjectId: string; name: string; textbook: string; description: string }>()
  const [tab, setTab] = useState(initialTab)
  const [scopeType, setScopeType] = useState<'ALL' | 'TARGETED'>(bank?.scopeType ?? 'TARGETED')
  const [groups, setGroups] = useState(() => bank?.audiences.length ? audienceGroups(bank.audiences, data) : [emptyScopeGroup()])
  const [dirty, setDirty] = useState(false)
  const [newCourse, setNewCourse] = useState(false)
  const save = useMutation({
    mutationFn: (values: { subjectId: string; name: string; textbook: string; description: string }) => {
      const input = {
        subjectId: values.subjectId ?? bank?.subjectId ?? subjectId ?? '',
        name: values.name ?? bank?.name ?? '',
        textbook: values.textbook ?? bank?.textbook ?? '',
        description: values.description ?? bank?.description ?? '',
        owner: bank?.owner ?? '',
        status: bank?.status ?? 'INACTIVE' as const,
        scopeType,
        audiences: scopeType === 'ALL' ? [] : groupsToAudiences(groups),
      }
      return bank ? gateway.updateQuestionBank(bank.id, input) : gateway.createQuestionBank(input)
    },
    onSuccess: (result) => { Message.success(bank ? '题库设置已保存' : '题库草稿已创建'); refreshWorkbench(client); onSaved(result) },
    onError: (error) => { if (/范围|展示|年级|学院|专业/.test(error.message)) setTab('scope') },
  })
  const markDirty = () => { setDirty(true); if (!save.isPending) save.reset() }
  const cancel = () => {
    if (save.isPending) return
    if (!dirty) return onClose()
    Modal.confirm({ title: '放弃本次修改？', content: '尚未保存的题库设置将丢失。', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
  }
  return <>
    <Drawer className="bw-settings-drawer" width={660} style={{ maxWidth: '100vw' }} title={bank ? '题库设置' : '新建题库'} visible
      onCancel={cancel} maskClosable={false} closable={!save.isPending} escToExit={!save.isPending}
      footer={<Space><Button onClick={cancel} disabled={save.isPending}>取消</Button><Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{bank ? '保存修改' : '创建草稿'}</Button></Space>}>
      {save.error && <Alert type="error" className="bw-form-error" content={save.error.message} />}
      <Form form={form} layout="vertical" disabled={save.isPending} initialValues={{ subjectId: bank?.subjectId ?? subjectId, name: bank?.name ?? '', textbook: bank?.textbook ?? '', description: bank?.description ?? '' }}
        onValuesChange={markDirty} onSubmitFailed={() => setTab('basic')} onSubmit={(values) => { if (!save.isPending) save.mutate(values) }}>
        <Tabs activeTab={tab} onChange={(next) => setTab(next as 'basic' | 'scope')}>
          <Tabs.TabPane key="basic" title="基本信息">
            <Form.Item field="subjectId" label="所属课程" rules={[{ required: true, message: '请选择所属课程' }]}>
              <Select showSearch placeholder="选择这份题库所属的课程" disabled={save.isPending || Boolean(bank && (bank.questionCount || bank.publicationStatus === 'PUBLISHED'))}
                options={data.subjects.map((s) => ({ label: `${s.name}${s.status === 'INACTIVE' ? '（已停用）' : ''}`, value: s.id }))} />
            </Form.Item>
            <Button className="bw-inline-create" size="small" type="text" disabled={save.isPending} onClick={() => setNewCourse(true)}>找不到课程？新建课程</Button>
            <Form.Item field="name" label="题库名称" rules={[{ required: true, message: '请输入题库名称' }]}><Input placeholder="例如：同济版上册 · 章节练习" maxLength={80} /></Form.Item>
            <Form.Item field="textbook" label="教材 / 版本说明"><Input placeholder="例如：同济大学《高等数学》第七版上册" maxLength={120} /></Form.Item>
            <Form.Item field="description" label="题库说明" extra="草稿可以稍后补充，发布前需要填写。"><Input.TextArea placeholder="说明内容范围、适用教材和复习建议，帮助学生选择" maxLength={2000} showWordLimit autoSize={{ minRows: 4, maxRows: 8 }} /></Form.Item>
            <p className="bw-form-note">题库创建后先保存为草稿。可以继续添加题目和章节，检查通过后再发布。</p>
          </Tabs.TabPane>
          <Tabs.TabPane key="scope" title="展示范围"><ScopeEditor directory={data} scopeType={scopeType} groups={groups} disabled={save.isPending}
            onTypeChange={(value) => { setScopeType(value); markDirty() }} onChange={(value) => { setGroups(value); markDirty() }} /></Tabs.TabPane>
        </Tabs>
      </Form>
    </Drawer>
    {newCourse && <CourseEditorModal onClose={() => setNewCourse(false)} onSaved={(course) => { form.setFieldValue('subjectId', course.id); markDirty(); setNewCourse(false); refreshWorkbench(client) }} />}
  </>
}
