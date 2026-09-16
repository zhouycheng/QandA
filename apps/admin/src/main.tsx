import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@arco-design/web-react/dist/css/arco.css'
import App from './App'
import { GatewayProvider } from './gateways/gateway-context'
import { MockAdminContentGateway } from '../playground/gateways/mock-admin-gateway'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 10_000 },
    mutations: { retry: false },
  },
})

const gateway = new MockAdminContentGateway()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider>
      <QueryClientProvider client={queryClient}>
        <GatewayProvider gateway={gateway}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </GatewayProvider>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
)
