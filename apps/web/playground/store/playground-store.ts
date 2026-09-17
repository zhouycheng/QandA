import { create } from 'zustand'

export type PlaygroundScenario =
  | 'normal'
  | 'empty'
  | 'error'
  | 'slow'
  | 'submit-error'
  | 'restore'
  | 'large'

interface PlaygroundState {
  scenario: PlaygroundScenario
  setScenario: (scenario: PlaygroundScenario) => void
}

export const scenarioLabels: Record<PlaygroundScenario, string> = {
  normal: '正常数据',
  empty: '空数据',
  error: '请求失败',
  slow: '网络延迟 3 秒',
  'submit-error': '提交失败',
  restore: '恢复练习',
  large: '100 道题',
}

export const usePlaygroundStore = create<PlaygroundState>((set) => ({
  scenario: 'normal',
  setScenario: (scenario) => set({ scenario }),
}))

export function getPlaygroundScenario() {
  return usePlaygroundStore.getState().scenario
}
