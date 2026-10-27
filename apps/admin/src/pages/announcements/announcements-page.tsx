import { useState } from 'react'
import {
  Button,
  Card,
  Dropdown,
  Input,
  Menu,
  Message,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { AnnouncementBody } from '../../components/announcement-body'
import { useAdminGateway } from '../../gateways/gateway-context'
import { formatDate } from '../../lib/format'
import type { Announcement, AnnouncementStatus } from '../../types/operations'
export const announcementStatusLabels = { PUBLISHED: '已发布', DRAFT: '草稿', SCHEDULED: '定时发布' }
export function AnnouncementsPage() {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('ALL')
  const [keyword, setKeyword] = useState('')
  const [preview, setPreview] = useState<Announcement>()
  const list = useQuery({
    queryKey: ['announcements'],
    queryFn: () => gateway.listAnnouncements(),
    refetchInterval: 30000,
  })
  const remove = useMutation({
    mutationFn: (id: string) => gateway.deleteAnnouncement(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['announcements'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('公告已删除')
    },
    onError: (e) => Message.error(e.message),
  })
  const unpublish = useMutation({
    mutationFn: (a: Announcement) => gateway.saveAnnouncement(a.id, { ...a, status: 'DRAFT' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['announcements'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('公告已转为草稿')
    },
    onError: (e) => Message.error(e.message),
  })
  return (
    <>
      <PageTitle
        title="公告管理"
        description="管理公告内容、发布状态和展示范围"
        action={
          <Button type="primary" onClick={() => navigate('/announcements/new')}>
            新建公告
          </Button>
        }
      />
      <Card bordered={false}>
        <div className="announcement-toolbar">
          <Tabs activeTab={tab} onChange={setTab}>
            {[['ALL', '全部'], ...Object.entries(announcementStatusLabels)].map(([v, label]) => (
              <Tabs.TabPane
                key={v}
                title={`${label} ${list.data?.filter((a) => v === 'ALL' || a.status === v).length ?? 0}`}
              />
            ))}
          </Tabs>
          <Input.Search
            allowClear
            placeholder="搜索公告标题"
            value={keyword}
            onChange={setKeyword}
            style={{ width: 260 }}
          />
        </div>
        {list.isError ? (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        ) : (
          <Table
            rowKey="id"
            data={
              list.data?.filter(
                (a) => (tab === 'ALL' || a.status === tab) && a.title.includes(keyword.trim()),
              ) ?? []
            }
            loading={list.isLoading}
            pagination={{ pageSize: 10, showTotal: true, sizeCanChange: true }}
            scroll={{ x: 950 }}
            columns={[
              {
                title: '公告标题',
                dataIndex: 'title',
                width: 260,
                render: (_, a) => (
                  <Button className="table-title-link" type="text" onClick={() => setPreview(a)}>
                    {a.title}
                  </Button>
                ),
              },
              {
                title: '发布范围',
                width: 170,
                render: (_, a) => (
                  <>
                    {a.audience === 'ALL' ? '全部用户' : `指定 ${a.userIds.length} 位用户`}
                    <div className="muted">
                      {a.platforms.map((p) => (p === 'WEB' ? 'Web' : '小程序')).join(' + ')}
                    </div>
                  </>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 120,
                render: (v) => (
                  <Tag color={v === 'PUBLISHED' ? 'green' : v === 'SCHEDULED' ? 'arcoblue' : 'gray'}>
                    {announcementStatusLabels[v as AnnouncementStatus]}
                  </Tag>
                ),
              },
              { title: '发布时间', dataIndex: 'publishAt', width: 180, render: formatDate },
              { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: formatDate },
              {
                title: '操作',
                width: 170,
                fixed: 'right',
                render: (_, a) => (
                  <Space>
                    <Button type="text" onClick={() => navigate(`/announcements/${a.id}/edit`)}>
                      编辑
                    </Button>
                    <Dropdown
                      droplist={
                        <Menu
                          onClickMenuItem={(key) => {
                            if (key === 'preview') setPreview(a)
                            else if (key === 'draft') unpublish.mutate(a)
                            else
                              Modal.confirm({
                                title: '删除公告',
                                content: `确认删除“${a.title}”？删除后无法恢复。`,
                                okButtonProps: { status: 'danger' },
                                onOk: () => remove.mutateAsync(a.id),
                              })
                          }}
                        >
                          <Menu.Item key="preview">预览</Menu.Item>
                          {a.status !== 'DRAFT' && <Menu.Item key="draft">撤回为草稿</Menu.Item>}
                          <Menu.Item key="delete">删除</Menu.Item>
                        </Menu>
                      }
                    >
                      <Button type="text">更多⌄</Button>
                    </Dropdown>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title={preview?.title}
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
