import { useTabStore } from './tabStore'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { auth_user } from '../api/auth'

interface auth_state {
  access_token: string | null
  user: auth_user | null
  set_auth: (token: string, user: auth_user) => void
  set_token: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<auth_state>()(
  persist(
    (set) => ({
      access_token: null,
      user: null,
      set_auth: (token, user) => set({ access_token: token, user }),
      set_token: (token) => set({ access_token: token }),
      logout: () => { useTabStore.setState({ tabs: [], activeTabId: null }); set({ access_token: null, user: null }) },
    }),
    {
      name: 'nutribay-auth',
      partialize: (s) => ({ access_token: s.access_token, user: s.user }),
    }
  )
)
