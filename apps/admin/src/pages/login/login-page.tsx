import { useState } from 'react'
import { Button, Checkbox, Form, Input, Message, Modal } from '@arco-design/web-react'
import { IconLock, IconUser } from '@arco-design/web-react/icon'
import { useMutation } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAdminGateway } from '../../gateways/gateway-context'
import { isAuthenticated, saveAdminSession } from '../../lib/auth'
import illustration from '../../assets/figma/login-illustration.png'

interface LoginValues {
  username: string
  password: string
}
export function LoginPage() {
  const gateway = useAdminGateway()
  const navigate = useNavigate()
  const location = useLocation()
  const [remember, setRemember] = useState(Boolean(localStorage.getItem('qanda-admin-remember')))
  const signIn = useMutation({
    mutationFn: async (values: LoginValues) => ({
      account: await gateway.loginAdmin(values.username.trim(), values.password),
      settings: await gateway.getSecuritySettings(),
      username: values.username.trim(),
    }),
    onSuccess: ({ account, settings, username }) => {
      saveAdminSession(account, settings.sessionMinutes)
      if (remember) localStorage.setItem('qanda-admin-remember', username)
      else localStorage.removeItem('qanda-admin-remember')
      const target = (location.state as { from?: string } | null)?.from
      navigate(
        target?.startsWith('/') && !target.startsWith('//') && target !== '/login' ? target : '/dashboard',
        { replace: true },
      )
    },
    onError: (error) => Message.error(error.message),
  })
  if (isAuthenticated()) return <Navigate to="/dashboard" replace />
  return (
    <main className="login-page">
      <div className="login-brand">QandA</div>
      <section className="login-art">
        <img src={illustration} alt="问答与学习" />
      </section>
      <section className="login-card">
        <h1>管理端登录</h1>
        <p className="login-subtitle">请使用管理员账号登录</p>
        <Form
          layout="vertical"
          onSubmit={(values) => signIn.mutate(values)}
          initialValues={{ username: localStorage.getItem('qanda-admin-remember') ?? '', password: '' }}
        >
          <Form.Item
            field="username"
            label="管理员账号"
            rules={[{ required: true, message: '请输入管理员账号' }]}
          >
            <Input
              prefix={<IconUser />}
              placeholder="请输入管理员账号"
              autoComplete="username"
              size="large"
            />
          </Form.Item>
          <Form.Item
            field="password"
            label="登录密码"
            rules={[{ required: true, message: '请输入登录密码' }]}
          >
            <Input.Password
              prefix={<IconLock />}
              placeholder="请输入登录密码"
              autoComplete="current-password"
              size="large"
            />
          </Form.Item>
          <div className="login-options">
            <Checkbox checked={remember} onChange={setRemember}>
              记住账号
            </Checkbox>
            <Button
              type="text"
              onClick={() =>
                Modal.info({
                  title: '找回密码',
                  content: '请联系系统管理员重置密码。当前演示账号：admin / mock。',
                })
              }
            >
              忘记密码？
            </Button>
          </div>
          <Button type="primary" htmlType="submit" long size="large" loading={signIn.isPending}>
            登录管理端
          </Button>
        </Form>
        <p className="login-hint">本地演示账号：admin / mock</p>
      </section>
    </main>
  )
}
