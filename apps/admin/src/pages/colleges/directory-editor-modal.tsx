import { useState } from 'react'
import { Alert, Form, Input, InputNumber, Message, Modal, Radio, Select } from '@arco-design/web-react'
import { useMutation } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import type { College, ContentStatus, Grade, Major } from '../../types/admin'

export type DirectoryEntry =
  | { kind: 'college'; record: College }
  | { kind: 'major'; record: Major }
  | { kind: 'grade'; record: Grade }

export type EditorTarget =
  | { kind: 'college'; record?: College }
  | { kind: 'major'; college: College; record?: Major }
  | { kind: 'grade'; college: College; major: Major; record?: Grade }

const labels = { college: '学院', major: '专业', grade: '年级' }

interface EditorValues {
  name: string
  code: string
  status: ContentStatus
  enrollmentYear: number
  enrollmentYears: number[]
}

export function DirectoryEditorModal({ target, existingYears, yearLocked, onCancel, onSaved }: {
  target: EditorTarget
  existingYears: number[]
  yearLocked: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const gateway = useAdminGateway()
  const [form] = Form.useForm<EditorValues>()
  const [dirty, setDirty] = useState(false)
  const label = labels[target.kind]
  const currentYear = new Date().getFullYear()
  const save = useMutation({
    mutationFn: async (values: EditorValues) => {
      if (target.kind === 'college') {
        const input = { name: values.name, code: values.code, status: values.status }
        return target.record ? gateway.updateCollege(target.record.id, input) : gateway.createCollege(input)
      }
      if (target.kind === 'major') {
        const input = { name: values.name, code: values.code, status: values.status, collegeId: target.college.id }
        return target.record ? gateway.updateMajor(target.record.id, input) : gateway.createMajor(input)
      }
      return target.record
        ? gateway.updateGrade(target.record.id, { enrollmentYear: values.enrollmentYear, status: values.status })
        : gateway.createGrades({ majorId: target.major.id, enrollmentYears: values.enrollmentYears, status: values.status })
    },
    onSuccess: () => {
      Message.success(`${label}已${target.record ? '更新' : '新增'}`)
      onSaved()
    },
  })
  const cancel = () => {
    if (save.isPending) return
    if (!dirty) return onCancel()
    Modal.confirm({
      title: '放弃本次修改？',
      content: '尚未保存的内容将丢失。',
      okText: '放弃修改', cancelText: '继续编辑', onOk: onCancel,
    })
  }
  return (
    <Modal
      className="directory-editor"
      title={`${target.record ? '编辑' : '新增'}${label}`}
      visible
      style={{ width: 480, maxWidth: 'calc(100vw - 32px)' }}
      maskClosable={false}
      escToExit={!save.isPending}
      closable={!save.isPending}
      confirmLoading={save.isPending}
      cancelButtonProps={{ disabled: save.isPending }}
      okText={target.record ? '保存修改' : `新增${label}`}
      cancelText="取消"
      onCancel={cancel}
      onOk={() => form.submit()}
    >
      {save.error && <Alert className="directory-form-error" type="error" content={save.error.message} />}
      <Form<EditorValues>
        form={form}
        layout="vertical"
        initialValues={{ ...target.record, status: target.record?.status ?? 'ACTIVE', enrollmentYears: [] }}
        onValuesChange={() => { setDirty(true); save.reset() }}
        onSubmit={(values) => { if (!save.isPending) save.mutate(values) }}
        disabled={save.isPending}
      >
        {target.kind !== 'college' && <Form.Item label="所属学院"><Input value={target.college.name} disabled /></Form.Item>}
        {target.kind === 'grade' && <Form.Item label="所属专业"><Input value={target.major.name} disabled /></Form.Item>}
        {target.kind !== 'grade' ? <>
          <Form.Item field="name" label={`${label}名称`} rules={[{ required: true, message: `请输入${label}名称` }]}>
            <Input autoFocus placeholder={target.kind === 'college' ? '例如：信息学院' : '例如：计算机科学与技术'} maxLength={60} />
          </Form.Item>
          <Form.Item field="code" label={`${label}代码`} rules={[{ required: true, message: `请输入${label}代码` }]}>
            <Input placeholder={target.kind === 'college' ? '例如：INFO' : '例如：CS'} maxLength={24} />
          </Form.Item>
        </> : target.record ? (
          <Form.Item field="enrollmentYear" label="入学年份" rules={[{ required: true, message: '请输入入学年份' }]} extra={yearLocked ? '已有学生或题库关联，入学年份不可直接修改；可调整下方的可选状态。' : '年级以入学年份记录，例如 2025 年入学的学生为 2025 级。'}>
            <InputNumber disabled={yearLocked || save.isPending} min={2000} max={currentYear + 1} step={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        ) : (
          <Form.Item field="enrollmentYears" label="入学年份" rules={[{ required: true, message: '请至少选择一个入学年份' }]} extra="可以一次选择多个年份，保存后分别建立年级。已添加的年级不可重复选择。">
            <Select mode="multiple" placeholder="请选择入学年份，可多选" allowClear options={Array.from({ length: currentYear - 2000 + 2 }, (_, index) => {
              const year = currentYear + 1 - index
              return { label: `${year} 级${existingYears.includes(year) ? '（已添加）' : ''}`, value: year, disabled: existingYears.includes(year) }
            })} />
          </Form.Item>
        )}
        <Form.Item field="status" label="学生可选状态">
          <Radio.Group>
            <Radio value="ACTIVE">启用</Radio>
            <Radio value="INACTIVE">停用</Radio>
          </Radio.Group>
        </Form.Item>
        <p className="directory-form-note">停用后不再供学生新选择，已有学生的归属与学习记录保留。上级停用时，下级也暂停供学生新选择。</p>
      </Form>
    </Modal>
  )
}
