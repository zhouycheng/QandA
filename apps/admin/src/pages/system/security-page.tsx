import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  InputNumber,
  Message,
  Select,
  Skeleton,
  Space,
  Switch,
} from '@arco-design/web-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageTitle } from '../../components/page-title'
import { ErrorState } from '../../components/error-state'
import { useAdminGateway } from '../../gateways/gateway-context'
import { touchAdminSession } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import type { SecuritySettings } from '../../types/operations'

export function SecurityPage() {
  const gateway = useAdminGateway()
  const settings = useQuery({ queryKey: ['security'], queryFn: () => gateway.getSecuritySettings() })
  return (
    <>
      <PageTitle title="安全设置" description="配置管理员登录与账号安全" />
      {settings.isError ? (
        <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />
      ) : settings.data ? (
        <SecurityForm initial={settings.data} />
      ) : (
        <Skeleton text={{ rows: 10 }} animation />
      )}
    </>
  )
}
function SecurityForm({ initial }: { initial: SecuritySettings }) {
  const gateway = useAdminGateway()
  const client = useQueryClient()
  const [form] = Form.useForm<SecuritySettings>()
  const [savedAt, setSavedAt] = useState(initial.updatedAt)
  const save = useMutation({
    mutationFn: (input: SecuritySettings) => gateway.saveSecuritySettings(input),
    onSuccess: (v) => {
      setSavedAt(v.updatedAt)
      touchAdminSession(v.sessionMinutes)
      void client.invalidateQueries({ queryKey: ['security'] })
      void client.invalidateQueries({ queryKey: ['logs'] })
      Message.success('安全设置已保存')
    },
    onError: (e) => Message.error(e.message),
  })
  return (
    <Form
      form={form}
      initialValues={initial}
      onSubmit={(v) => save.mutate(v)}
      layout="vertical"
      className="security-form"
    >
      <Alert
        type="info"
        content="当前为本地演示：失败锁定、会话超时及新密码校验在本浏览器生效。新设备验证和首次登录改密需接入真实身份服务，暂不可启用。"
      />
      <Card title="登录保护" bordered={false}>
        <div className="setting-row">
          <div>
            <strong>登录失败锁定</strong>
            <span>连续登录失败后暂时锁定账号</span>
          </div>
          <Space>
            <Form.Item field="lockEnabled" triggerPropName="checked" noStyle>
              <Switch />
            </Form.Item>
            <Form.Item field="maxAttempts" noStyle>
              <Select aria-label="最大登录失败次数" style={{ width: 130 }}>
                {[3, 5, 10].map((n) => (
                  <Select.Option key={n} value={n}>
                    {n} 次失败
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item field="lockMinutes" noStyle>
              <Select aria-label="锁定时长" style={{ width: 145 }}>
                {[5, 15, 30, 60].map((n) => (
                  <Select.Option key={n} value={n}>
                    锁定 {n} 分钟
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Space>
        </div>
        <div className="setting-row">
          <div>
            <strong>会话超时</strong>
            <span>管理员无操作后自动退出</span>
          </div>
          <Form.Item field="sessionMinutes" noStyle>
            <Select aria-label="会话超时" style={{ width: 220 }}>
              {[5, 15, 30, 60, 120].map((n) => (
                <Select.Option key={n} value={n}>
                  {n} 分钟
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </div>
        <div className="setting-row">
          <div>
            <strong>新设备验证</strong>
            <span>接入真实身份服务后可启用</span>
          </div>
          <Form.Item field="newDeviceVerification" triggerPropName="checked" noStyle>
            <Switch disabled />
          </Form.Item>
        </div>
      </Card>
      <Card title="密码规则" bordered={false}>
        <div className="setting-row">
          <div>
            <strong>最短密码长度</strong>
          </div>
          <Form.Item field="minPasswordLength" noStyle>
            <InputNumber aria-label="最短密码长度" min={8} max={64} suffix="位" style={{ width: 220 }} />
          </Form.Item>
        </div>
        <div className="setting-row">
          <div>
            <strong>密码组成要求</strong>
          </div>
          <Space wrap>
            <Form.Item field="requireLetter" triggerPropName="checked" noStyle>
              <Checkbox>包含字母</Checkbox>
            </Form.Item>
            <Form.Item field="requireNumber" triggerPropName="checked" noStyle>
              <Checkbox>包含数字</Checkbox>
            </Form.Item>
            <Form.Item field="requireMixedCase" triggerPropName="checked" noStyle>
              <Checkbox>包含大小写</Checkbox>
            </Form.Item>
          </Space>
        </div>
        <div className="setting-row">
          <div>
            <strong>首次登录修改密码</strong>
            <span>接入真实身份服务后可启用</span>
          </div>
          <Form.Item field="changeInitialPassword" triggerPropName="checked" noStyle>
            <Switch disabled />
          </Form.Item>
        </div>
      </Card>
      <div className="form-actions">
        <span className="muted">上次保存：{formatDate(savedAt)}</span>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          保存设置
        </Button>
      </div>
    </Form>
  )
}
