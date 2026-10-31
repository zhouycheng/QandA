import { useState } from 'react'
import { Alert, Button, Checkbox, Divider, Form, Input, Modal, Radio, Select, Space, Tag } from '@arco-design/web-react'
import { IconArrowDown, IconArrowUp, IconDelete, IconPlus } from '@arco-design/web-react/icon'
import { questionTypeLabels } from '../../lib/labels'
import { createQuestionContent } from '../../lib/question-content'
import type { AtomicQuestionContent, AtomicQuestionType, QuestionContent, QuestionType, ReadingSubQuestion } from '../../types/admin'

export function QuestionContentEditor({ value, onChange, disabled, lockType, prefix = '', allowReading = true, lockedSubIds = [] }: {
  value: QuestionContent
  onChange: (value: QuestionContent) => void
  disabled: boolean
  lockType?: boolean
  prefix?: string
  allowReading?: boolean
  lockedSubIds?: string[]
}) {
  const [newSubType, setNewSubType] = useState<AtomicQuestionType>('SINGLE_CHOICE')
  const q = value
  const change = (patch: Partial<QuestionContent>) => onChange({ ...q, ...patch })
  const label = (name: string) => `${prefix}${name}`
  const choice = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.type)
  const subQuestions = q.subQuestions ?? []
  const changeType = (type: QuestionType) => {
    if (type === q.type) return
    const apply = () => {
      const next = createQuestionContent(type)
      const stem = type === 'FILL_BLANK' ? `${q.stem} ${'{{1}}'}`.trim() : q.stem
      onChange({ ...next, stem, explanation: q.explanation })
    }
    const hasAnswers = q.correctAnswer.length || q.options.some((o) => o.content.trim()) || q.blanks?.some((b) => b.answers.some((a) => a.trim())) || q.referenceAnswer?.trim() || q.passage?.trim() || subQuestions.length
    if (hasAnswers) Modal.confirm({ title: '切换题型？', content: '题干和解析会保留，选项、答案及阅读小题将重置。', okText: '切换题型', cancelText: '继续编辑', onOk: apply })
    else apply()
  }
  const updateSub = (id: string, next: QuestionContent) => change({ subQuestions: subQuestions.map((sub) => sub.id === id ? { ...next as AtomicQuestionContent, id } : sub) })
  const moveSub = (index: number, direction: number) => {
    const next = [...subQuestions]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    change({ subQuestions: next })
  }
  const removeSub = (sub: ReadingSubQuestion) => {
    const remove = () => change({ subQuestions: subQuestions.filter((s) => s.id !== sub.id) })
    if (sub.stem.trim()) Modal.confirm({ title: '移除这道小题？', content: '保存题组后生效。取消整个编辑可以保留原有内容。', okText: '移除小题', cancelText: '继续编辑', onOk: remove })
    else remove()
  }
  return <div className="bw-content-editor">
    <Form.Item label={label('题型')} required>
      <Select aria-label={label('题型')} value={q.type} disabled={disabled || lockType} onChange={changeType}
        options={Object.entries(questionTypeLabels).filter(([type]) => allowReading || type !== 'READING').map(([value, label]) => ({ value, label }))} />
    </Form.Item>
    <Form.Item label={label(q.type === 'READING' ? '题组标题' : '题干')} required
      extra={q.type === 'FILL_BLANK' ? '用 {{1}}、{{2}} 标记空位，每个编号在题干中出现一次。添加空位会自动补到题干末尾，可调整位置。' : undefined}>
      <Input.TextArea aria-label={label(q.type === 'READING' ? '题组标题' : '题干')} value={q.stem} disabled={disabled} onChange={(stem) => change({ stem })}
        placeholder={q.type === 'READING' ? '例如：Unit 1 · Campus Life' : q.type === 'FILL_BLANK' ? '例如：水的化学式是 {{1}}，常压沸点是 {{2}} ℃。' : '输入题目内容'} maxLength={1000} showWordLimit autoSize={{ minRows: q.type === 'READING' ? 2 : 3, maxRows: 8 }} />
    </Form.Item>
    {choice && <>
      <Divider orientation="left">选项与答案</Divider>
      <div className="option-editor">
        {q.options.map((option, index) => <div className="option-row" key={option.key}>
          <span className="option-key">{option.key}</span>
          <Input aria-label={label(`选项 ${option.key}`)} value={option.content} placeholder={`选项 ${option.key}`} disabled={disabled || q.type === 'TRUE_FALSE'}
            onChange={(content) => change({ options: q.options.map((o, i) => i === index ? { ...o, content } : o), correctAnswer: content.trim() ? q.correctAnswer : q.correctAnswer.filter((a) => a !== option.key) })} />
          {q.type !== 'TRUE_FALSE' && <Button type="text" status="danger" icon={<IconDelete />} disabled={disabled || q.options.length <= 2} aria-label={label(`删除选项 ${option.key}`)}
            onClick={() => change({ options: q.options.filter((_, i) => i !== index).map((o, i) => ({ ...o, key: String.fromCharCode(65 + i) })), correctAnswer: [] })} />}
        </div>)}
        {q.type !== 'TRUE_FALSE' && <Button type="dashed" long icon={<IconPlus />} disabled={disabled || q.options.length >= 26}
          onClick={() => change({ options: [...q.options, { key: String.fromCharCode(65 + q.options.length), content: '' }] })}>添加选项</Button>}
      </div>
      <Form.Item label={label('正确答案')} required>
        {q.type === 'MULTIPLE_CHOICE' ? <Checkbox.Group aria-label={label('正确答案')} disabled={disabled} value={q.correctAnswer}
          options={q.options.filter((o) => o.content.trim()).map((o) => o.key)} onChange={(correctAnswer) => change({ correctAnswer: correctAnswer as string[] })} />
          : <Radio.Group aria-label={label('正确答案')} value={q.correctAnswer[0]} onChange={(answer) => change({ correctAnswer: [answer] })}>
            {q.options.map((o) => <Radio key={o.key} value={o.key} disabled={disabled || !o.content.trim()}>{q.type === 'TRUE_FALSE' ? o.content : o.key}</Radio>)}
          </Radio.Group>}
      </Form.Item>
    </>}
    {q.type === 'FILL_BLANK' && <>
      <Divider orientation="left">空位与可接受答案</Divider>
      {(q.blanks ?? []).map((blank, index) => <div className="bw-blank-card" key={index}>
        <div className="bw-sub-heading"><strong>第 {index + 1} 空 <Tag>{`{{${index + 1}}}`}</Tag></strong>
          <Button type="text" status="danger" icon={<IconDelete />} aria-label={label(`移除第${index + 1}空`)} disabled={disabled || (q.blanks?.length ?? 0) <= 1}
            onClick={() => change({ blanks: q.blanks?.filter((_, i) => i !== index), stem: q.stem.replace(/\{\{(\d+)\}\}/g, (match, number: string) => Number(number) === index + 1 ? '' : Number(number) > index + 1 ? `{{${Number(number) - 1}}}` : match) })} />
        </div>
        <Form.Item label={label(`第${index + 1}空可接受答案`)} required extra="每行一个答案，学生填写任意一个即可匹配。">
          <Input.TextArea aria-label={label(`第${index + 1}空可接受答案`)} value={blank.answers.join('\n')} disabled={disabled} placeholder={'例如：H₂O\nH2O'} autoSize={{ minRows: 2, maxRows: 5 }}
            onChange={(text) => change({ blanks: q.blanks?.map((b, i) => i === index ? { answers: text.split('\n') } : b) })} />
        </Form.Item>
      </div>)}
      <Button long type="dashed" icon={<IconPlus />} disabled={disabled || (q.blanks?.length ?? 0) >= 20} onClick={() => change({ blanks: [...q.blanks ?? [], { answers: [] }], stem: `${q.stem} {{${(q.blanks?.length ?? 0) + 1}}}` })}>添加空位</Button>
      <Form.Item label="答案匹配设置" className="section-gap"><Space wrap>
        <Checkbox disabled={disabled} checked={q.blankMatch?.ignoreCase ?? true} onChange={(ignoreCase) => change({ blankMatch: { trimWhitespace: q.blankMatch?.trimWhitespace ?? true, ignoreCase } })}>忽略英文字母大小写</Checkbox>
        <Checkbox disabled={disabled} checked={q.blankMatch?.trimWhitespace ?? true} onChange={(trimWhitespace) => change({ blankMatch: { ignoreCase: q.blankMatch?.ignoreCase ?? true, trimWhitespace } })}>忽略首尾空格</Checkbox>
      </Space></Form.Item>
    </>}
    {q.type === 'SHORT_ANSWER' && <>
      <Alert type="info" className="bw-form-error" content="按参考答案与评分要点设计学生自评，不使用关键词自动判对错。" />
      <Form.Item label={label('参考答案')} required><Input.TextArea aria-label={label('参考答案')} disabled={disabled} value={q.referenceAnswer ?? ''} onChange={(referenceAnswer) => change({ referenceAnswer })} placeholder="填写完整的参考作答" maxLength={4000} showWordLimit autoSize={{ minRows: 4, maxRows: 10 }} /></Form.Item>
      <Form.Item label={label('评分要点')} required extra="每行一条，帮助学生逐项核对，最多 30 条。"><Input.TextArea aria-label={label('评分要点')} disabled={disabled} value={q.scoringPoints?.join('\n') ?? ''} onChange={(text) => change({ scoringPoints: text.split('\n') })} placeholder={'例如：准确说明概念\n给出关键推导或例子'} autoSize={{ minRows: 3, maxRows: 8 }} /></Form.Item>
    </>}
    {q.type === 'READING' && <>
      <Form.Item label="阅读材料" required extra="所有小题共用此材料，支持保留段落。"><Input.TextArea aria-label="阅读材料" disabled={disabled} value={q.passage ?? ''} onChange={(passage) => change({ passage })} placeholder="粘贴文章、案例或分析材料" maxLength={20000} showWordLimit autoSize={{ minRows: 6, maxRows: 14 }} /></Form.Item>
      <Alert type="info" content="阅读材料不计题数，按下方小题统计。小题随题组统一管理章节与启用状态。" />
      <Divider orientation="left">阅读小题 · {subQuestions.length} 道</Divider>
      {subQuestions.map((sub, index) => <section className="bw-reading-sub" key={sub.id}>
        <div className="bw-sub-heading"><strong>小题 {index + 1}</strong><Space size={0}>
          <Button type="text" icon={<IconArrowUp />} aria-label={`上移小题${index + 1}`} disabled={disabled || index === 0} onClick={() => moveSub(index, -1)} />
          <Button type="text" icon={<IconArrowDown />} aria-label={`下移小题${index + 1}`} disabled={disabled || index === subQuestions.length - 1} onClick={() => moveSub(index, 1)} />
          <Button type="text" status="danger" icon={<IconDelete />} aria-label={`移除小题${index + 1}`} disabled={disabled} onClick={() => removeSub(sub)} />
        </Space></div>
        <QuestionContentEditor value={sub} onChange={(next) => updateSub(sub.id, next)} disabled={disabled} lockType={lockedSubIds.includes(sub.id)} allowReading={false} prefix={`小题${index + 1}`} />
      </section>)}
      {!subQuestions.length && <p className="empty-note">先选择小题题型，再添加第一道小题。</p>}
      <div className="bw-add-sub"><Select aria-label="新增小题题型" value={newSubType} disabled={disabled} onChange={setNewSubType} options={Object.entries(questionTypeLabels).filter(([type]) => type !== 'READING').map(([value, label]) => ({ value, label }))} />
        <Button type="dashed" icon={<IconPlus />} disabled={disabled || subQuestions.length >= 50} onClick={() => change({ subQuestions: [...subQuestions, { ...createQuestionContent(newSubType) as AtomicQuestionContent, id: crypto.randomUUID() }] })}>添加小题</Button></div>
    </>}
    <Form.Item label={label(q.type === 'READING' ? '材料说明（选填）' : '答案解析（发布前必填）')} className="section-gap">
      <Input.TextArea aria-label={label(q.type === 'READING' ? '材料说明' : '答案解析')} value={q.explanation} disabled={disabled} onChange={(explanation) => change({ explanation })} placeholder={q.type === 'READING' ? '可补充文章背景或材料导读；每道小题分别填写解析' : '说明正确答案及解题思路'} maxLength={2000} showWordLimit autoSize={{ minRows: 3, maxRows: 8 }} />
    </Form.Item>
  </div>
}
