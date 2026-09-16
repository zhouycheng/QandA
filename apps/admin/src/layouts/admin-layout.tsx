import {
  Avatar,
  Breadcrumb,
  Button,
  Layout,
  Menu,
  Message,
  Select,
  Space,
  Typography,
} from '@arco-design/web-react'
import {
  IconApps,
  IconBook,
  IconDashboard,
  IconFile,
  IconMenuFold,
  IconMenuUnfold,
  IconPoweroff,
  IconUser,
} from '@arco-design/web-react/icon'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { scenarioLabels, type PlaygroundScenario } from '../../playground/scenarios'
import { useMockAdminStore } from '../../playground/store/mock-admin-store'
import { logout } from '../lib/auth'
import { useUiStore } from '../stores/ui-store'

const { Header, Sider, Content } = Layout

const pageNames: Record<string, string> = {
  '/dashboard': '数据概览',
  '/subjects': '科目管理',
  '/question-banks': '题库管理',
  '/questions': '题目管理',
}

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { collapsed, setCollapsed } = useUiStore()
  const scenario = useMockAdminStore((state) => state.scenario)
  const setScenario = useMockAdminStore((state) => state.setScenario)

  const changeScenario = (next: PlaygroundScenario) => {
    setScenario(next)
    void queryClient.invalidateQueries()
    Message.success(`已切换到“${scenarioLabels[next]}”场景`)
  }

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout className="admin-shell">
      <Sider collapsed={collapsed} collapsible trigger={null} breakpoint="lg" className="admin-sider">
        <div className="brand">
          <span className="brand-mark">Q</span>
          {!collapsed && <span>QandA Admin</span>}
        </div>
        <Menu selectedKeys={[location.pathname]} onClickMenuItem={(key) => navigate(key)}>
          <Menu.Item key="/dashboard"><IconDashboard />数据概览</Menu.Item>
          <Menu.Item key="/subjects"><IconApps />科目管理</Menu.Item>
          <Menu.Item key="/question-banks"><IconBook />题库管理</Menu.Item>
          <Menu.Item key="/questions"><IconFile />题目管理</Menu.Item>
        </Menu>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <Space>
            <Button
              type="text"
              icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            />
            <Breadcrumb>
              <Breadcrumb.Item>内容管理</Breadcrumb.Item>
              <Breadcrumb.Item>{pageNames[location.pathname] ?? '管理端'}</Breadcrumb.Item>
            </Breadcrumb>
          </Space>
          <Space size="medium">
            <Space className="scenario-control">
              <Typography.Text type="secondary">Playground</Typography.Text>
              <Select value={scenario} onChange={changeScenario} style={{ width: 132 }}>
                {Object.entries(scenarioLabels).map(([value, label]) => (
                  <Select.Option key={value} value={value}>{label}</Select.Option>
                ))}
              </Select>
            </Space>
            <Avatar size={30}><IconUser /></Avatar>
            <Typography.Text>测试管理员</Typography.Text>
            <Button type="text" icon={<IconPoweroff />} onClick={signOut}>退出</Button>
          </Space>
        </Header>
        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
