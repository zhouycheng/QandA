import { useRef, useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Message,
  Modal,
  Radio,
  Select,
  Skeleton,
  Space,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { AnnouncementBody } from '../../components/announcement-body'
import { useAdminGateway } from '../../gateways/gateway-context'
import type { Announcement, AnnouncementInput } from '../../types/operations'

function BodyEditor({ value = '', onChange }: { value?: string; onChange?: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const wrap = (prefix: string, suffix = prefix) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    onChange?.(
      value.slice(0, start) + prefix + (value.slice(start, end) || '文字') + suffix + value.slice(end),
    )
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + prefix.length, end + prefix.length)
    })
  }
  return (
    <div className="body-editor">
      <div className="editor-toolbar">
        <Button type="text" aria-label="加粗" onClick={() => wrap('**')}>
          <strong>B</strong>
        </Button>
        <Button type="text" aria-label="斜体" onClick={() => wrap('_')}>
          <em>I</em>
        </Button>
        <Button type="text" aria-label="插入列表" onClick={() => wrap('\n• ', '')}>
          ☷
        </Button>
        <span className="muted">支持加粗、斜体与分段</span>
      </div>
      <textarea
        ref={ref}
        aria-label="公告正文"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        maxLength={20000}
        placeholder="输入公告正文"
      />
    </div>
  )
}
const empty: AnnouncementInput = {
  title: '',
  summary: '',
  body: '',
  audience: 'ALL',
  userIds: [],
  platforms: ['MINIAPP', 'WEB'],
  status: 'DRAFT',
}
export function AnnouncementEditorPage() {
  const { id } = useParams()
  const gateway = useAdminGateway()
  const list = useQuery({
    queryKey: ['announcements'],
    queryFn: () => gateway.listAnnouncements(),
    enabled: Boolean(id),
  })
  if (id && list.isLoading) return <Skeleton text={{ rows: 10 }} animation />
  if (id && list.isError)
    return <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
  const initial = id ? list.data?.find((a) => a.id === id) : undefined
  if (id && !initial)
    return <ErrorState message="公告不存在，可能已被删除。" onRetry={() => void list.refetch()} />
  return <Editor key={id ?? 'new'} initial={initial} />
}
function Editor({ initial }: { initial?: Announcement }) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [form] = Form.useForm<AnnouncementInput & { mode: string }>()
  const [preview, setPreview] = useState<AnnouncementInput>()
  const [dirty, setDirty] = useState(false)
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => gateway.listUsers() })
  const save = useMutation({
    mutationFn: (input: AnnouncementInput) => gateway.saveAnnouncement(initial?.id, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['announcements'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('公告已保存')
      navigate('/announcements')
    },
    onError: (e) => Message.error(e.message),
  })
  const publish = (values: AnnouncementInput & { mode?: string }) => {
    let publishAt: string | undefined
    if (values.mode === 'scheduled' && values.publishAt) {
      const d = new Date(values.publishAt.replace(' ', 'T'))
      if (!Number.isNaN(d.getTime())) publishAt = d.toISOString()
    }
    save.mutate({ ...values, publishAt, status: values.mode === 'scheduled' ? 'SCHEDULED' : 'PUBLISHED' })
  }
  const draft = () => {
    const values = form.getFieldsValue()
    save.mutate({ ...empty, ...values, status: 'DRAFT', publishAt: undefined })
  }
  return (
    <>
      <PageTitle
        title={initial ? '编辑公告' : '新建公告'}
        description="撰写并发布通知到所选用户和展示端"
        action={
          <Button
            type="text"
            onClick={() => {
              if (!dirty || window.confirm('公告尚未保存，确认返回列表？')) navigate('/announcements')
            }}
          >
            ← 返回公告列表
          </Button>
        }
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...empty,
          ...initial,
          mode: initial?.status === 'SCHEDULED' ? 'scheduled' : 'now',
          publishAt: initial?.publishAt ? initial.publishAt : undefined,
        }}
        onChange={() => setDirty(true)}
        onSubmit={publish}
      >
        <div className="announcement-form-grid">
          <Card bordered={false}>
            <Form.Item field="title" label="公告标题" rules={[{ required: true, message: '请输入公告标题' }]}>
              <Input maxLength={80} showWordLimit placeholder="输入公告标题" />
            </Form.Item>
            <Form.Item
              field="summary"
              label="公告摘要"
              rules={[{ required: true, message: '请输入公告摘要' }]}
            >
              <Input maxLength={200} showWordLimit placeholder="一句话概括公告内容" />
            </Form.Item>
            <Form.Item field="body" label="公告正文" rules={[{ required: true, message: '请输入公告正文' }]}>
              <BodyEditor />
            </Form.Item>
          </Card>
          <Card bordered={false}>
            <Form.Item field="audience" label="发布范围" rules={[{ required: true }]}>
              <Radio.Group direction="vertical">
                <Radio value="ALL">
                  全部用户<small className="field-help">面向所有注册用户展示该公告</small>
                </Radio>
                <Radio value="SELECTED">
                  指定用户<small className="field-help">仅对指定的用户展示该公告</small>
                </Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {(values) =>
                values.audience === 'SELECTED' && (
                  <Form.Item
                    field="userIds"
                    label="选择用户"
                    rules={[{ required: true, message: '请选择用户' }]}
                  >
                    <Select mode="multiple" showSearch placeholder="搜索用户" loading={users.isLoading}>
                      {users.data?.map((u) => (
                        <Select.Option key={u.id} value={u.id}>
                          {u.name} · {u.account}
                        </Select.Option>
                      ))}
                    </Select>
                    {users.isError && (
                      <p role="alert">
                        {users.error.message}
                        <Button type="text" onClick={() => void users.refetch()}>
                          重试
                        </Button>
                      </p>
                    )}
                  </Form.Item>
                )
              }
            </Form.Item>
            <Form.Item
              field="platforms"
              label="展示端"
              rules={[{ required: true, message: '请至少选择一个展示端' }]}
            >
              <Checkbox.Group
                direction="vertical"
                options={[
                  { label: '小程序', value: 'MINIAPP' },
                  { label: '用户 Web', value: 'WEB' },
                ]}
              />
            </Form.Item>
            <Form.Item field="mode" label="发布时间">
              <Radio.Group direction="vertical">
                <Radio value="now">
                  立即发布<small className="field-help">保存后在所选端展示</small>
                </Radio>
                <Radio value="scheduled">
                  定时发布<small className="field-help">演示环境在列表刷新时更新发布状态</small>
                </Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {(values) =>
                values.mode === 'scheduled' && (
                  <Form.Item
                    field="publishAt"
                    label="定时发布时间"
                    rules={[{ required: true, message: '请选择发布时间' }]}
                  >
                    <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" />
                  </Form.Item>
                )
              }
            </Form.Item>
          </Card>
        </div>
        <div className="form-actions">
          <Button onClick={draft} loading={save.isPending}>
            保存草稿
          </Button>
          <Button onClick={() => setPreview({ ...empty, ...form.getFieldsValue() })}>预览</Button>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            发布公告
          </Button>
        </div>
      </Form>
      <Modal
        title={preview?.title || '公告预览'}
        visible={Boolean(preview)}
        footer={null}
        onCancel={() => setPreview(undefined)}
        style={{ width: 720, maxWidth: 'calc(100vw - 32px)' }}
      >
        <p className="muted">{preview?.summary}</p>
        <AnnouncementBody text={preview?.body ?? ''} />
      </Modal>
    </>
  )
}
