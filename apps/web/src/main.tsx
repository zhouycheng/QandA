import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { MockPracticeGateway } from '../playground/gateways/mock-practice-gateway'
import App from './App'
import { AppServicesProvider } from './app-context'
import { BrowserPracticeSessionRepository } from './repositories/browser-practice-session-repository'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 10_000 },
    mutations: { retry: false },
  },
})

const services = {
  gateway: new MockPracticeGateway(),
  sessionRepository: new BrowserPracticeSessionRepository(),
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={services}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppServicesProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
