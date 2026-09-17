import { createContext, useContext, type PropsWithChildren } from 'react'
import type { PracticeGateway } from './gateways/practice-gateway'
import type { PracticeSessionRepository } from './repositories/practice-session-repository'

interface AppServices {
  gateway: PracticeGateway
  sessionRepository: PracticeSessionRepository
}

const AppContext = createContext<AppServices | null>(null)

export function AppServicesProvider({
  services,
  children,
}: PropsWithChildren<{ services: AppServices }>) {
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>
}

export function useAppServices() {
  const services = useContext(AppContext)
  if (!services) throw new Error('QandA 应用服务尚未注入')
  return services
}
