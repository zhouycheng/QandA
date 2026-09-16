import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Divider,
  Drawer,
  Form,
  Input,
  Message,
  Radio,
  Select,
  Space,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'
import type {
  ContentStatus,
  CreateQuestionInput,
  Question,
  QuestionBank,
  QuestionOption,
  QuestionType,
} from '../../types/admin'

interface QuestionFormValues {
  questionBankId: string
  stem: string
  type: QuestionType
  correctAnswer?: string | string[]
  explanation: string
  status: ContentStatus
}

interface QuestionFormDrawerProps {
  visible: boolean
  editing: Question | null
  questionBanks: QuestionBank[]
  saving: boolean
  onCancel: () => void
  onSave: (input: CreateQuestionInput) => void
}

const defaultOptions: QuestionOption[] = [
  { key: 'A', content: '' },
  { key: 'B', content: '' },
  { key: 'C', content: '' },
  { key: 'D', content: '' },
]

const trueFalseOptions: QuestionOption[] = [
  { key: 'TRUE', content: '正确' },
  { key: 'FALSE', content: '错误' },
]

const optionKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function QuestionFormDrawer({
  visible,
  editing,
  questionBanks,
  saving,
  onCancel,
  onSave,
}: QuestionFormDrawerProps) {
  const [form] = Form.useForm<QuestionFormValues>()
  const [type, setType] = useState<QuestionType>('SINGLE_CHOICE')
  const [options, setOptions] = useState<QuestionOption[]>(defaultOptions)

  useEffect(() => {
    if (!visible) return
    const nextType = editing?.type ?? 'SINGLE_CHOICE'
    setType(nextType)
    setOptions(editing?.options.map((option) => ({ ...option })) ?? defaultOptions.map((option) => ({ ...option })))
    form.setFieldsValue(
      editing
        ? {
            questionBankId: editing.questionBankId,
            stem: editing.stem,
            type: editing.type,
            correctAnswer: editing.type === 'MULTIPLE_CHOICE' ? editing.correctAnswer : editing.correctAnswer[0],
            explanation: editing.explanation,
            status: editing.status,
          }
        : {
            questionBankId: questionBanks[0]?.id,
            stem: '',
            type: 'SINGLE_CHOICE',
            correctAnswer: undefined,
            explanation: '',
            status: 'ACTIVE',
          },
    )
  }, [editing, form, questionBanks, visible])

  const availableAnswers = useMemo(
    () => options.filter((option) => option.content.trim()).map((option) => option.key),
    [options],
  )

  const changeType = (nextType: QuestionType) => {
    setType(nextType)
    const nextOptions = nextType === 'TRUE_FALSE' ? trueFalseOptions : defaultOptions
    setOptions(nextOptions.map((option) => ({ ...option })))
    form.setFieldValue('correctAnswer', undefined)
  }

  const updateOption = (index: number, content: string) => {
    setOptions((current) => current.map((option, optionIndex) => optionIndex === index ? { ...option, content } : option))
  }

  const addOption = () => {
    if (options.length >= optionKeys.length) return
    setOptions((current) => [...current, { key: optionKeys[current.length], content: '' }])
  }

  const removeOption = (index: number) => {
    if (options.length <= 2) {
      Message.warning('选择题至少需要两个选项')
      return
    }
    const nextOptions = options
      .filter((_, optionIndex) => optionIndex !== index)
      .map((option, optionIndex) => ({ ...option, key: optionKeys[optionIndex] }))
    setOptions(nextOptions)
    form.setFieldValue('correctAnswer', undefined)
  }

  const submit = (values: QuestionFormValues) => {
    const normalizedOptions = options.map((option) => ({ ...option, content: option.content.trim() }))
    if (normalizedOptions.some((option) => !option.content)) {
      Message.error('请填写所有选项内容')
      return
    }

    const answer = Array.isArray(values.correctAnswer)
      ? values.correctAnswer
      : values.correctAnswer
        ? [values.correctAnswer]
        : []

    if (type === 'MULTIPLE_CHOICE' && answer.length < 2) {
      Message.error('多选题至少需要两个正确答案')
      return
    }
    if (type !== 'MULTIPLE_CHOICE' && answer.length !== 1) {
      Message.error(type === 'SINGLE_CHOICE' ? '单选题只能设置一个正确答案' : '请选择正确或错误')
      return
    }
    if (answer.some((key) => !availableAnswers.includes(key))) {
      Message.error('正确答案必须对应有效选项')
      return
    }

    onSave({
      questionBankId: values.questionBankId,
      stem: values.stem.trim(),
      type,
      options: normalizedOptions,
      correctAnswer: answer,
      explanation: values.explanation.trim(),
      status: values.status,
    })
  }

  return (
    <Drawer
      width={640}
      title={editing ? '编辑题目' : '新建题目'}
      visible={visible}
      onCancel={onCancel}
      unmountOnExit
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>保存题目</Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onSubmit={submit}>
        <Form.Item field="questionBankId" label="所属题库" rules={[{ required: true, message: '请选择题库' }]}>
          <Select placeholder="选择题库">
            {questionBanks.map((bank) => <Select.Option key={bank.id} value={bank.id}>{bank.name}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item field="type" label="题型" rules={[{ required: true, message: '请选择题型' }]}>
          <Select onChange={changeType} disabled={Boolean(editing)}>
            <Select.Option value="SINGLE_CHOICE">单选题</Select.Option>
            <Select.Option value="MULTIPLE_CHOICE">多选题</Select.Option>
            <Select.Option value="TRUE_FALSE">判断题</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item field="stem" label="题干" rules={[{ required: true, message: '请输入题干' }, { maxLength: 1000, message: '题干不能超过 1000 个字符' }]}>
          <Input.TextArea placeholder="输入题目内容" autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1000} showWordLimit />
        </Form.Item>

        <Divider orientation="left">选项与答案</Divider>
        <div className="option-editor">
          {options.map((option, index) => (
            <div className="option-row" key={option.key}>
              <span className="option-key">{option.key}</span>
              <Input
                value={option.content}
                disabled={type === 'TRUE_FALSE'}
                placeholder={`选项 ${option.key}`}
                onChange={(value) => updateOption(index, value)}
              />
              {type !== 'TRUE_FALSE' && (
                <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeOption(index)} aria-label={`删除选项 ${option.key}`} />
              )}
            </div>
          ))}
          {type !== 'TRUE_FALSE' && options.length < optionKeys.length && (
            <Button type="dashed" long icon={<IconPlus />} onClick={addOption}>添加选项</Button>
          )}
        </div>

        <Form.Item field="correctAnswer" label="正确答案" rules={[{ required: true, message: '请选择正确答案' }]}>
          {type === 'MULTIPLE_CHOICE' ? (
            <Checkbox.Group options={availableAnswers} />
          ) : (
            <Radio.Group>
              {options.map((option) => (
                <Radio key={option.key} value={option.key} disabled={!option.content.trim()}>
                  {type === 'TRUE_FALSE' ? option.content : option.key}
                </Radio>
              ))}
            </Radio.Group>
          )}
        </Form.Item>

        <Form.Item field="explanation" label="答案解析" rules={[{ required: true, message: '请输入答案解析' }, { maxLength: 2000, message: '解析不能超过 2000 个字符' }]}>
          <Input.TextArea placeholder="说明正确答案及解题思路" autoSize={{ minRows: 3, maxRows: 8 }} maxLength={2000} showWordLimit />
        </Form.Item>
        <Form.Item field="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
          <Radio.Group>
            <Radio value="ACTIVE">启用</Radio>
            <Radio value="INACTIVE">停用</Radio>
          </Radio.Group>
        </Form.Item>
        {editing && <Typography.Text type="secondary">编辑时不可切换题型，以避免答案语义发生意外变化。</Typography.Text>}
      </Form>
    </Drawer>
  )
}
