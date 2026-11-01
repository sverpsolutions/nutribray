import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth_api, type login_payload } from '../api/auth'
import { useAuthStore } from '../store/authStore'

export function useAuth() {
  const [loading, set_loading] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const { set_auth, logout: store_logout } = useAuthStore()
  const navigate = useNavigate()

  async function login(payload: login_payload) {
    set_loading(true)
    set_error(null)
    try {
      const res = await auth_api.login(payload)
      set_auth(res.data.access_token, res.data.user)
      if (res.data.user?.role === 'vendor' || (res.data.user as any)?.supplier_id) {
        navigate('/vendor-portal', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'login failed'
      set_error(msg)
    } finally {
      set_loading(false)
    }
  }

  async function logout() {
    try {
      await auth_api.logout()
    } finally {
      store_logout()
      navigate('/login', { replace: true })
    }
  }

  return { login, logout, loading, error }
}
