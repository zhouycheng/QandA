import { useState } from 'react'
import { Alert, Form, Input, Message, Modal, Radio } from '@arco-design/web-react'
import { useMutation } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import type { ContentStatus, Subject } from '../../types/admin'

export function CourseEditorModal({ course, onClose, onSaved }: {
  course?: Subject
  onClose: () => void
  onSaved: (course: Subject) => void
}) {
  const gateway = useAdminGateway()
  const [form] = Form.useForm<{ name: string; status: ContentStatus }>()
  const [dirty, setDirty] = useState(false)
  const save = useMutation({
    mutationFn: (values: { name: string; status: ContentStatus }) => course
      ? gateway.updateSubject(course.id, { ...values, majorIds: course.majorIds })
      : gateway.createSubject({ ...values, majorIds: [] }),
    onSuccess: (result) => { Message.success('课程已保存'); onSaved(result) },
  })
  const cancel = () => {
    if (save.isPending) return
    if (!dirty) return onClose()
    Modal.confirm({ title: '放弃本次修改？', content: '尚未保存的课程信息将丢失。', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
  }
  return <Modal className="bw-course-editor" title={course ? '编辑课程' : '新建课程'} visible maskClosable={false}
    style={{ width: 460, maxWidth: 'calc(100vw - 32px)' }} onCancel={cancel} onOk={() => form.submit()}
    confirmLoading={save.isPending} closable={!save.isPending} escToExit={!save.isPending}
    cancelButtonProps={{ disabled: save.isPending }} okText="保存课程" cancelText="取消">
    {save.error && <Alert type="error" content={save.error.message} style={{ marginBottom: 20 }} />}
    <Form form={form} layout="vertical" disabled={save.isPending} initialValues={{ name: course?.name ?? '', status: course?.status ?? 'ACTIVE' }}
      onValuesChange={() => { setDirty(true); save.reset() }} onSubmit={(values) => { if (!save.isPending) save.mutate(values) }}>
      <Form.Item field="name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
        <Input autoFocus maxLength={50} placeholder="例如：数据结构" />
      </Form.Item>
      <Form.Item field="status" label="课程状态"><Radio.Group><Radio value="ACTIVE">启用</Radio><Radio value="INACTIVE">停用</Radio></Radio.Group></Form.Item>
      <p className="directory-form-note">同一门课程可以维护多份题库。课程停用后，其题库暂停在学生列表中展示，已有内容与记录保留。</p>
    </Form>
  </Modal>
}
