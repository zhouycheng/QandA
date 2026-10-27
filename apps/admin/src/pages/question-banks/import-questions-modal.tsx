import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Message,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconArrowDown, IconArrowUp, IconClose, IconUpload } from '@arco-design/web-react/icon'
import { useAdminGateway } from '../../gateways/gateway-context'
import { parseQuestionFile } from '../../lib/content-rules'
import { questionTypeLabels } from '../../lib/labels'
import type { CreateQuestionInput, QuestionBank } from '../../types/admin'
interface ImportFile {
  id: string
  name: string
  progress: number
  questions: CreateQuestionInput[]
  error?: string
}
export function ImportQuestionsModal({
  bank,
  onClose,
  defaultChapterId,
}: {
  bank: QuestionBank
  onClose: () => void
  defaultChapterId?: string
}) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const chapters = useQuery({ queryKey: ['chapters', bank.id], queryFn: () => gateway.listChapters(bank.id) })
  const [chapterId, setChapterId] = useState(defaultChapterId)
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [files, setFiles] = useState<ImportFile[]>([])
  const [preview, setPreview] = useState<ImportFile>()
  const [dragging, setDragging] = useState(false)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const addFiles = async (incoming: FileList | File[]) => {
    if (files.length + incoming.length > 20) {
      Message.error('一次最多选择 20 个文件')
      return
    }
    const token = generation.current
    const next = Array.from(incoming).map((file) => ({ file, id: crypto.randomUUID() }))
    setFiles((current) => [
      ...current,
      ...next.map(({ file, id }) => ({ id, name: file.name, progress: 0, questions: [] })),
    ])
    for (const { file, id } of next) {
      try {
        if (!file.name.toLowerCase().endsWith('.json')) throw new Error('仅支持 JSON 文件')
        if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB')
        if (token !== generation.current) return
        setFiles((current) => current.map((f) => (f.id === id ? { ...f, progress: 40 } : f)))
        const questions = parseQuestionFile(await file.text(), bank.id)
        if (token === generation.current)
          setFiles((current) => current.map((f) => (f.id === id ? { ...f, progress: 100, questions } : f)))
      } catch (e) {
        if (token === generation.current)
          setFiles((current) =>
            current.map((f) =>
              f.id === id
                ? { ...f, progress: 100, error: e instanceof Error ? e.message : '无法识别文件' }
                : f,
            ),
          )
      }
    }
  }
  const save = useMutation({
    mutationFn: () =>
      gateway.importQuestions({
        questionBankId: bank.id,
        questions: files
          .flatMap((f) => f.questions)
          .map((q) => ({ ...q, chapterId: chapterId ?? q.chapterId })),
      }),
    onSuccess: (count) => {
      void client.invalidateQueries({ queryKey: ['questions'] })
      void client.invalidateQueries({ queryKey: ['question-banks'] })
      void client.invalidateQueries({ queryKey: ['dashboard-summary'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success(`已导入 ${count} 道题`)
      onClose()
    },
    onError: (e) => Message.error(e.message),
  })
  const total = files.reduce((sum, f) => sum + f.questions.length, 0)
  const ready =
    !chapters.isError &&
    !chapters.isLoading &&
    files.length > 0 &&
    files.every((f) => f.progress === 100 && !f.error) &&
    total <= 10000
  const move = (id: string, direction: number) =>
    setFiles((current) => {
      const next = [...current]
      const index = next.findIndex((f) => f.id === id)
      const target = index + direction
      if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]
      return next
    })
  return (
    <>
      <Modal
        title="批量导入题目文件"
        visible
        style={{ width: 940, maxWidth: 'calc(100vw - 32px)' }}
        onCancel={() => {
          if (!save.isPending) onClose()
        }}
        onOk={() => save.mutate()}
        okText={`确认导入${total ? `（${total} 道题）` : ''}`}
        okButtonProps={{ disabled: !ready }}
        confirmLoading={save.isPending}
        cancelButtonProps={{ disabled: save.isPending }}
        maskClosable={false}
      >
        <p>导入到：{bank.name}</p>
        {chapters.isError && (
          <Alert
            type="error"
            content={chapters.error.message}
            action={
              <Button type="text" onClick={() => void chapters.refetch()}>
                重试章节加载
              </Button>
            }
          />
        )}
        <div className="input-label">
          <span>归入章节</span>
          <Select
            aria-label="导入归入章节"
            allowClear
            placeholder="按文件章节，无章节则归入未分章"
            value={chapterId}
            onChange={setChapterId}
            disabled={save.isPending}
          >
            {chapters.data?.map((c) => (
              <Select.Option key={c.id} value={c.id}>
                {c.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!save.isPending) void addFiles(e.dataTransfer.files)
          }}
        >
          <IconUpload />
          <p>拖拽多个 JSON 文件到此处，或点击批量选择</p>
          <Button onClick={() => input.current?.click()} disabled={save.isPending}>
            选择 JSON 文件
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept=".json,application/json"
            aria-label="选择 JSON 文件"
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <small className="muted">每个文件最多 5 MB / 2000 题，一次最多 20 个文件 / 10000 题</small>
        </div>
        <h3>文件识别进度</h3>
        <Table
          rowKey="id"
          data={files}
          pagination={false}
          scroll={{ y: 300, x: 750 }}
          noDataElement={<p className="empty-note">请选择题目文件</p>}
          columns={[
            { title: '文件名称', dataIndex: 'name', width: 200 },
            { title: '题目数量', width: 90, render: (_, f) => `${f.questions.length} 道题` },
            {
              title: '识别进度',
              width: 160,
              render: (_, f) => (
                <Progress percent={f.progress} status={f.error ? 'error' : 'success'} size="small" />
              ),
            },
            {
              title: '状态',
              width: 170,
              render: (_, f) =>
                f.error ? (
                  <span className="error-text" role="alert">
                    {f.error}
                  </span>
                ) : (
                  <Tag color={f.progress === 100 ? 'green' : 'arcoblue'}>
                    {f.progress === 100 ? '识别完成' : '识别中'}
                  </Tag>
                ),
            },
            {
              title: '操作',
              width: 210,
              render: (_, f, i) => (
                <Space size="mini">
                  <Button type="text" disabled={!f.questions.length} onClick={() => setPreview(f)}>
                    预览
                  </Button>
                  <Button
                    type="text"
                    aria-label={`上移 ${f.name}`}
                    icon={<IconArrowUp />}
                    disabled={i === 0 || save.isPending}
                    onClick={() => move(f.id, -1)}
                  />
                  <Button
                    type="text"
                    aria-label={`下移 ${f.name}`}
                    icon={<IconArrowDown />}
                    disabled={i === files.length - 1 || save.isPending}
                    onClick={() => move(f.id, 1)}
                  />
                  <Button
                    type="text"
                    aria-label={`移除 ${f.name}`}
                    icon={<IconClose />}
                    disabled={save.isPending}
                    onClick={() => setFiles((current) => current.filter((v) => v.id !== f.id))}
                  />
                </Space>
              ),
            },
          ]}
        />
        <Alert
          style={{ marginTop: 20 }}
          type={total > 10000 ? 'error' : 'info'}
          content={
            total > 10000
              ? '题目总量超过 10000，请移除部分文件。'
              : '全部文件识别成功后可确认导入；通过上下箭头调整文件顺序。支持管理端格式及小程序导出的 questions JSON。导入不会覆盖已有题目。'
          }
        />
        <details className="import-example">
          <summary>查看 JSON 示例</summary>
          <Input.TextArea
            readOnly
            value={JSON.stringify(
              {
                questions: [
                  {
                    type: 'SINGLE_CHOICE',
                    stem: '1 + 1 等于？',
                    options: [
                      { key: 'A', content: '2' },
                      { key: 'B', content: '3' },
                    ],
                    correctAnswer: ['A'],
                    explanation: '1 + 1 = 2。',
                  },
                ],
              },
              null,
              2,
            )}
            autoSize={{ minRows: 5, maxRows: 12 }}
          />
        </details>
      </Modal>
      <Modal
        title={`文件预览：${preview?.name ?? ''}`}
        visible={Boolean(preview)}
        onCancel={() => setPreview(undefined)}
        footer={null}
        style={{ width: 760, maxWidth: 'calc(100vw - 32px)' }}
      >
        <Table
          rowKey="previewId"
          data={preview?.questions.map((q, i) => ({ ...q, previewId: i })) ?? []}
          pagination={{ pageSize: 5, showTotal: true }}
          columns={[
            {
              title: '题型',
              dataIndex: 'type',
              render: (v) => questionTypeLabels[v as keyof typeof questionTypeLabels],
            },
            { title: '题干', dataIndex: 'stem' },
            { title: '答案', dataIndex: 'correctAnswer', render: (v: string[]) => v.join('、') },
          ]}
        />
      </Modal>
    </>
  )
}
