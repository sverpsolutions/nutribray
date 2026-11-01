import api from './axios'

export interface login_payload {
  username: string
  password: string
}

export interface auth_user {
  id: number
  name: string
  username: string
  email: string | null
  role: string
  role_id: number | null
  outlet_id: number | null
  /** Category IDs this user is allowed to manage masters for.
   *  Empty / undefined = no master-add access.
   *  Populated by backend user-settings when the admin assigns category permissions. */
  allowed_category_ids?: number[]
  /** If true, user can add/edit ALL master records regardless of category */
  can_manage_all_masters?: boolean
}

export interface login_response {
  access_token: string
  token_type: string
  user: auth_user
}

export const auth_api = {
  login: (payload: login_payload) =>
    api.post<login_response>('/auth/login', payload),

  me: () =>
    api.get<auth_user>('/auth/me'),

  refresh: () =>
    api.post<{ access_token: string; token_type: string }>('/auth/refresh'),

  logout: () =>
    api.post('/auth/logout'),
}
