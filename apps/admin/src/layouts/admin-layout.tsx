import { useEffect, useState } from 'react'
import { Avatar, Breadcrumb, Button, Drawer, Message, Select, Space } from '@arco-design/web-react'
import { IconMenuFold, IconMenuUnfold, IconPoweroff, IconUser } from '@arco-design/web-react/icon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { scenarioLabels, type PlaygroundScenario } from '../../playground/scenarios'
import { useMockAdminStore } from '../../playground/store/mock-admin-store'
import { getAdminSession, isAuthenticated, logout, touchAdminSession } from '../lib/auth'
import { useUiStore } from '../stores/ui-store'
import { useAdminGateway } from '../gateways/gateway-context'
import { DesignIcon } from '../components/design-icon'

const groups = [
  {
    title: '工作台',
    icon: 'home',
    items: [['/dashboard', '运营概览', 'dashboard']],
  },
  {
    title: '内容管理',
    icon: 'book',
    items: [
      ['/subjects', '课程目录', 'book'],
      ['/question-banks', '共享题库', 'file'],
      ['/questions', '全部题目', 'book'],
      ['/recommendations', '适用范围', 'users'],
    ],
  },
  {
    title: '反馈与运营',
    icon: 'users',
    items: [
      ['/feedback', '学生反馈', 'announcement'],
      ['/users', '注册用户', 'user'],
      ['/activity', '使用统计', 'activity'],
      ['/announcements', '平台公告', 'announcement'],
    ],
  },
  { title: '分类目录', icon: 'book', items: [['/colleges', '院系分类', 'book']] },
  {
    title: '系统管理',
    icon: 'settings',
    items: [
      ['/admins', '管理员', 'user'],
      ['/logs', '操作日志', 'file'],
      ['/security', '安全设置', 'shield'],
    ],
  },
] as const
const pageNames: Record<string, string> = Object.fromEntries(
  groups.flatMap((g) => g.items.map(([path, name]) => [path, name])),
)
Object.assign(pageNames, {
  '/colleges': '学院管理',
  '/majors': '专业管理',
  '/subjects': '课程目录',
  '/questions': '题目管理',
})
export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const gateway = useAdminGateway()
  const { collapsed, setCollapsed } = useUiStore()
  const [mobile, setMobile] = useState(window.innerWidth <= 760)
  const scenario = useMockAdminStore((s) => s.scenario)
  const setScenario = useMockAdminStore((s) => s.setScenario)
  const security = useQuery({ queryKey: ['security'], queryFn: () => gateway.getSecuritySettings() })
  const timeoutMinutes = security.data?.sessionMinutes ?? getAdminSession()?.timeoutMinutes ?? 30
  const session = getAdminSession()
  useEffect(() => {
    if (mobile) setCollapsed(true)
  }, [mobile, setCollapsed])
  useEffect(() => {
    const resize = () => setMobile(window.innerWidth <= 760)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let lastTouch = 0
    const check = () => {
      if (!isAuthenticated()) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      const current = getAdminSession()!
      timer = setTimeout(
        check,
        Math.max(100, current.timeoutMinutes * 60000 - (Date.now() - current.lastActivity)),
      )
    }
    const activity = () => {
      if (!isAuthenticated()) {
        check()
        return
      }
      if (Date.now() - lastTouch < 1000) return
      lastTouch = Date.now()
      touchAdminSession(timeoutMinutes)
      clearTimeout(timer)
      check()
    }
    check()
    const storage = () => {
      clearTimeout(timer)
      check()
    }
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    window.addEventListener('storage', storage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      window.removeEventListener('storage', storage)
    }
  }, [navigate, timeoutMinutes])
  const changeScenario = (next: PlaygroundScenario) => {
    setScenario(next)
    void queryClient.resetQueries()
    Message.success(`已切换到“${scenarioLabels[next]}”场景，演示数据已重置`)
  }
  const navigation = (
    <>
      <Link className="brand" to="/dashboard">
        QandA
      </Link>
      <nav aria-label="管理导航">
        {groups.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="nav-group-title">
              <DesignIcon name={group.icon} />
              {group.title}
            </div>
            {group.items.map(([path, label, icon]) => (
              <Link
                className={`nav-link ${location.pathname.startsWith(path) || (path === '/colleges' && location.pathname === '/majors') ? 'active' : ''}`}
                key={path}
                title={label}
                to={path}
                aria-current={location.pathname === path ? 'page' : undefined}
                onClick={() => {
                  if (mobile) setCollapsed(true)
                }}
              >
                <DesignIcon name={icon} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">学生共建 · 高效复习</div>
    </>
  )
  const pageName = location.pathname.startsWith('/announcements/')
    ? '公告编辑'
    : location.pathname.startsWith('/question-banks/')
      ? '题库工作台'
      : (pageNames[location.pathname] ?? '管理端')
  return (
    <div className={`admin-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="admin-sider">{navigation}</aside>
      <Drawer
        className="mobile-navigation"
        placement="left"
        width={250}
        visible={!collapsed && mobile}
        footer={null}
        title="管理导航"
        onCancel={() => setCollapsed(true)}
      >
        {navigation}
      </Drawer>
      <div className="admin-main">
        <header className="admin-header">
          <Space>
            <Button
              className="sidebar-toggle"
              type="text"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Breadcrumb>
              <Breadcrumb.Item>后台管理</Breadcrumb.Item>
              <Breadcrumb.Item>{pageName}</Breadcrumb.Item>
            </Breadcrumb>
          </Space>
          <Space>
            <Avatar size={34}>
              <IconUser />
            </Avatar>
            <span className="admin-name">{session?.name ?? '管理员'}</span>
            <Button
              type="text"
              icon={<IconPoweroff />}
              aria-label="退出登录"
              onClick={() => {
                logout()
                queryClient.clear()
                navigate('/login', { replace: true })
              }}
            />
          </Space>
        </header>
        <main className="admin-content">
          {['/colleges', '/majors'].includes(location.pathname) && (
            <nav className="content-tabs" aria-label="内容管理页面">
              {[
                ['/colleges', '学院管理'],
                ['/majors', '专业管理'],
              ].map(([path, name]) => (
                <Link key={path} to={path} className={location.pathname === path ? 'active' : ''}>
                  {name}
                </Link>
              ))}
            </nav>
          )}
          <Outlet />
        </main>
        <footer className="environment-bar">
          <span>本地演示环境</span>
          <div className="scenario-picker">
            <span>Playground</span>
            <Select
              aria-label="Playground 场景"
              size="small"
              value={scenario}
              onChange={changeScenario}
              style={{ width: 130 }}
            >
              {Object.entries(scenarioLabels).map(([value, label]) => (
                <Select.Option key={value} value={value}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </div>
        </footer>
      </div>
    </div>
  )
}
