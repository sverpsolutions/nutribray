import api from './axios'

export interface access_module { key: string; label: string; kind: 'module' | 'report'; actions: string[] }
export interface access_catalog {
  modules: access_module[]; actions: string[]
  roles: { id: number; name: string; slug: string }[]; role_permissions: Record<string, string[]>
  outlets: { id: number; unit_code: string; outlet_name: string }[]
  categories: { id: number; name: string; department: string | null }[]
  groups: { id: number; name: string; category_id: number }[]
  mfg_stores: { id: number; code: string; name: string }[]
}
export interface access_user_row {
  id: number; name: string; username: string; employee_code: string | null; mobile: string | null; email: string | null
  department: string | null; designation: string | null; role: string; status: boolean; last_login: string | null
  valid_from: string | null; valid_until: string | null; all_outlets: boolean; all_categories: boolean
  default_outlet: string | null; outlet_count: number; category_count: number; group_count: number
}
export interface access_form {
  name: string; username: string; password?: string; email: string | null; mobile: string | null
  employee_code: string | null; department: string | null; designation: string | null; role: string
  outlet_id: number | null; status: boolean; valid_from: string | null; valid_until: string | null
  all_outlets: boolean; outlet_ids: number[]; all_categories: boolean; category_ids: number[]; group_ids: number[]
  permissions: string[]; mfg_store_ids?: number[]
}
export interface access_user extends access_form {
  id: number; last_login: string | null; created_at: string; updated_at: string
  created_by_name: string | null; updated_by_name: string | null
  audit: { created_at: string; changed_by_name: string; summary: string }[]
}

export const access_api = {
  me: () => api.get<{ admin: boolean; permissions: string[]; scope: any }>('/access/me'),
  catalog: () => api.get<access_catalog>('/access/catalog'),
  users: (params: { search?: string; status?: string }) => api.get<access_user_row[]>('/access/users', { params }),
  user: (id: number) => api.get<access_user>(`/access/users/${id}`),
  create: (data: access_form) => api.post<{ id: number }>('/access/users', data),
  update: (id: number, data: access_form) => api.put(`/access/users/${id}`, data),
  reset_password: (id: number, new_password: string) => api.post(`/access/users/${id}/reset-password`, { new_password }),
  toggle: (id: number) => api.post<{ status: boolean }>(`/access/users/${id}/toggle`),
  set_role_template: (role: string, perms: string[]) => api.put(`/access/roles/${role}/permissions`, perms),
  audit: (user_id?: number) => api.get<{ changes: any[]; denials: any[] }>('/access/audit', { params: { user_id } }),
}
