import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
} from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'
import { useQuery } from '@tanstack/react-query'
import { useAdminGateway } from '../../gateways/gateway-context'
import { ErrorState } from '../../components/error-state'
import type { BankAudience, CreateQuestionBankInput, QuestionBank, Subject } from '../../types/admin'

type Fields = Pick<QuestionBank, 'subjectId' | 'name' | 'description' | 'textbook' | 'owner'>

export function BankEditorDrawer({
  bank,
  visible,
  subjects,
  defaultSubjectId,
  saving,
  onClose,
  onSave,
}: {
  bank?: QuestionBank
  visible: boolean
  subjects: Subject[]
  defaultSubjectId?: string
  saving: boolean
  onClose: () => void
  onSave: (input: CreateQuestionBankInput) => void
}) {
  const gateway = useAdminGateway()
  const [form] = Form.useForm<Fields>()
  const [scope, setScope] = useState<'ALL' | 'TARGETED'>('ALL')
  const [audiences, setAudiences] = useState<BankAudience[]>([])
  const colleges = useQuery({
    queryKey: ['colleges', 'all'],
    queryFn: () => gateway.listColleges(),
    enabled: visible,
  })
  const majors = useQuery({
    queryKey: ['majors', 'all'],
    queryFn: () => gateway.listMajors(),
    enabled: visible,
  })
  useEffect(() => {
    if (!visible) return
    form.resetFields()
    form.setFieldsValue(
      bank ?? { subjectId: defaultSubjectId, name: '', description: '', textbook: '', owner: '' },
    )
    setScope(bank?.scopeType ?? 'ALL')
    setAudiences(structuredClone(bank?.audiences ?? []))
  }, [visible, bank, defaultSubjectId, form])
  const update = (index: number, patch: Partial<BankAudience>) =>
    setAudiences((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const error = colleges.error ?? majors.error
  return (
    <Drawer
      width={680}
      visible={visible}
      title={bank ? '编辑题库与适用范围' : '新建共享题库'}
      onCancel={() => {
        if (!saving) onClose()
      }}
      maskClosable={!saving}
      footer={
        <Space>
          <Button disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={saving} disabled={Boolean(error)} onClick={() => form.submit()}>
            保存{bank ? '修改' : '草稿'}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onSubmit={(values) =>
          onSave({
            ...values,
            status: bank?.status ?? 'INACTIVE',
            scopeType: scope,
            audiences: scope === 'ALL' ? [] : audiences,
          })
        }
      >
        <Form.Item field="subjectId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
          <Select placeholder="选择已有课程" disabled={Boolean(bank)}>
            {subjects.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item field="name" label="题库名称" rules={[{ required: true, message: '请输入题库名称' }]}>
          <Input maxLength={80} placeholder="例如：高数 A 上册期末基础题库" />
        </Form.Item>
        <div className="form-grid">
          <Form.Item field="textbook" label="教材 / 内容版本">
            <Input maxLength={120} placeholder="教材、册次或大纲说明" />
          </Form.Item>
          <Form.Item field="owner" label="内容负责人">
            <Input maxLength={60} placeholder="负责维护的团队成员" />
          </Form.Item>
        </div>
        <Form.Item field="description" label="题库说明">
          <Input.TextArea
            maxLength={2000}
            showWordLimit
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="说明覆盖章节、考试范围和使用建议，帮助学生选对题库。"
          />
        </Form.Item>
        <Divider orientation="left">适用范围</Divider>
        <p className="field-help">用于课程推荐。学生仍可搜索和使用其他专业的已发布题库。</p>
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void colleges.refetch()
              void majors.refetch()
            }}
          />
        ) : (
          <>
            <Radio.Group type="button" value={scope} onChange={setScope}>
              <Radio value="ALL">全校适用</Radio>
              <Radio value="TARGETED">指定适用范围</Radio>
            </Radio.Group>
            {scope === 'TARGETED' && (
              <div className="audience-editor">
                <p className="muted">同一行条件同时满足，多行之间满足任意一行即可。留空表示该项不限。</p>
                {audiences.map((row, index) => (
                  <div className="audience-rule" key={index}>
                    <div className="audience-rule-title">
                      <strong>条件 {index + 1}</strong>
                      <Button
                        type="text"
                        status="danger"
                        aria-label={`删除条件 ${index + 1}`}
                        icon={<IconDelete />}
                        onClick={() => setAudiences((rows) => rows.filter((_, i) => i !== index))}
                      />
                    </div>
                    <div className="audience-rule-fields">
                      <div>
                        <span>学院</span>
                        <Select
                          allowClear
                          aria-label={`条件 ${index + 1} 学院`}
                          placeholder="不限学院"
                          value={row.collegeId}
                          onChange={(collegeId) => update(index, { collegeId, majorId: undefined })}
                        >
                          {colleges.data?.map((c) => (
                            <Select.Option key={c.id} value={c.id}>
                              {c.name}
                            </Select.Option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <span>专业</span>
                        <Select
                          allowClear
                          aria-label={`条件 ${index + 1} 专业`}
                          placeholder="不限专业"
                          value={row.majorId}
                          onChange={(majorId) => update(index, { majorId })}
                        >
                          {majors.data
                            ?.filter((m) => !row.collegeId || m.collegeId === row.collegeId)
                            .map((m) => (
                              <Select.Option key={m.id} value={m.id}>
                                {m.name}
                              </Select.Option>
                            ))}
                        </Select>
                      </div>
                      <div>
                        <span>入学年份</span>
                        <InputNumber
                          aria-label={`条件 ${index + 1} 入学年份`}
                          placeholder="不限"
                          min={2000}
                          max={new Date().getFullYear() + 1}
                          precision={0}
                          value={row.enrollmentYear}
                          onChange={(enrollmentYear) =>
                            update(index, {
                              enrollmentYear: typeof enrollmentYear === 'number' ? enrollmentYear : undefined,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  long
                  type="dashed"
                  icon={<IconPlus />}
                  onClick={() => setAudiences((rows) => [...rows, {}])}
                >
                  添加推荐条件
                </Button>
              </div>
            )}
          </>
        )}
        <Alert
          style={{ marginTop: 24 }}
          type="info"
          content="新题库先保存为草稿。进入内容工作台整理章节和题目，检查完成后再发布。"
        />
      </Form>
    </Drawer>
  )
}
