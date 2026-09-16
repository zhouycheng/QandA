import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    { name: 'qanda-admin-ui' },
  ),
)
