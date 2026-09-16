import { Button, Card, Form, Input, Message, Typography } from '@arco-design/web-react'
import { IconLock, IconUser } from '@arco-design/web-react/icon'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isAuthenticated, login } from '../../lib/auth'

interface LoginValues {
  username: string
  password: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [form] = Form.useForm<LoginValues>()

  if (isAuthenticated()) return <Navigate to="/dashboard" replace />

  const submit = (values: LoginValues) => {
    if (!login(values.username, values.password)) {
      Message.error('用户名或密码错误，请使用 admin / mock。')
      return
    }
    const target = (location.state as { from?: string } | null)?.from ?? '/dashboard'
    navigate(target, { replace: true })
  }

  const enterPlayground = () => {
    form.setFieldsValue({ username: 'admin', password: 'mock' })
    submit({ username: 'admin', password: 'mock' })
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand brand-large"><span className="brand-mark">Q</span><span>QandA</span></div>
        <Typography.Title heading={1}>让题库维护更清晰、更可靠。</Typography.Title>
        <Typography.Paragraph>
          管理科目、题库和三种题型。当前环境使用本地 Mock 数据，可独立验证完整内容管理流程。
        </Typography.Paragraph>
      </section>
      <Card className="login-card" bordered={false}>
        <Typography.Title heading={3}>欢迎回来</Typography.Title>
        <Typography.Paragraph type="secondary">登录 QandA 内容管理后台</Typography.Paragraph>
        <Form form={form} layout="vertical" onSubmit={submit} initialValues={{ username: 'admin', password: 'mock' }}>
          <Form.Item field="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<IconUser />} placeholder="admin" />
          </Form.Item>
          <Form.Item field="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<IconLock />} placeholder="mock" />
          </Form.Item>
          <Button type="primary" htmlType="submit" long size="large">登录</Button>
        </Form>
        <Button type="text" long className="playground-button" onClick={enterPlayground}>进入 Playground Admin</Button>
        <Typography.Text type="secondary" className="login-hint">测试账号：admin / mock</Typography.Text>
      </Card>
    </main>
  )
}
