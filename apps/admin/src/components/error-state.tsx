import { Button, Result } from '@arco-design/web-react'

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Result
      status="error"
      title="加载失败"
      subTitle={message}
      extra={<Button onClick={onRetry}>重新加载</Button>}
    />
  )
}
