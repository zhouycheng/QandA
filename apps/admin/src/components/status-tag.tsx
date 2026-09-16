import { Tag } from '@arco-design/web-react'
import { statusLabels } from '../lib/labels'
import type { ContentStatus } from '../types/admin'

export function StatusTag({ status }: { status: ContentStatus }) {
  return <Tag color={status === 'ACTIVE' ? 'green' : 'gray'}>{statusLabels[status]}</Tag>
}
