import api from './axios'

export const USER_ROLES = [
  'admin', 'manager', 'staff', 'viewer',
  'category_manager', 'area_sales_manager', 'store_manager', 'purchase_manager', 'accounts_manager'
] as const  // superadmin is set by a superadmin only

export interface user_row {
  id: number; name: string; username: string; email: string | null; role: string
  outlet_id: number | null; outlet_name: string | null; status: boolean; last_login: string | null
}
export interface paginated<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number }

export const users_api = {
  list: (params: { page?: number; per_page?: number; search?: string; role?: string; outlet_id?: number; status?: boolean }) =>
    api.get<paginated<user_row>>('/users', { params }),
  create: (b: { name: string; username: string; password: string; email?: string | null; role: string; outlet_id: number | null }) => api.post('/users', b),
  update: (id: number, b: Partial<{ name: string; email: string | null; role: string; outlet_id: number | null; status: boolean }>) => api.put(`/users/${id}`, b),
  deactivate: (id: number) => api.delete(`/users/${id}`),
  reset_password: (id: number, new_password: string) => api.post(`/users/${id}/reset-password`, { new_password }),
}
