import api from './axios'

export interface ScopeItem {
  id: number
  name: string
  code?: string
}

export interface UserScope {
  user_id: number
  username: string
  role: string
  is_unrestricted: boolean
  permitted_outlets: ScopeItem[]
  permitted_categories: ScopeItem[]
  default_template_id: number | null
}

export interface WidgetModel {
  id?: number
  widget_id?: number
  widget_key: string
  name: string
  category: string
  description?: string
  default_width?: number
  min_width?: number
  max_width?: number
  endpoint_url: string
  position: number
  col_span: number
  row_span?: number
  config?: Record<string, any>
  is_visible: boolean
}

export interface DashboardTemplate {
  id: number
  name: string
  slug: string
  description?: string
  role_id?: number | null
  role_name?: string | null
  department?: string | null
  is_default: boolean
  allow_user_customization: boolean
  layout_config?: Record<string, any>
  widget_count?: number
  created_at?: string
  updated_at?: string
}

export interface MyDashboardResponse {
  template: DashboardTemplate
  widgets: WidgetModel[]
  scope: UserScope
  has_custom_preferences: boolean
}

export interface UserAssignmentsResponse {
  user: {
    id: number
    username: string
    name: string
    role: string
    role_id?: number | null
    outlet_id?: number | null
    default_dashboard_template_id?: number | null
  }
  assigned_stores: { outlet_id: number; is_primary: boolean; outlet_name: string; unit_code: string }[]
  assigned_categories: { category_id: number; include_subcategories: boolean; category_name: string }[]
}

export const dashboardBuilderApi = {
  getMyDashboard: async (): Promise<MyDashboardResponse> => {
    const res = await api.get('/dashboard/my-dashboard')
    return res.data
  },

  getWidgetData: async (
    widgetKey: string,
    params?: { days?: number; on?: string; outlet_id?: number; category_id?: number }
  ) => {
    const res = await api.get(`/dashboard/widgets/data/${widgetKey}`, { params })
    return res.data
  },

  getUserScope: async (): Promise<UserScope> => {
    const res = await api.get('/dashboard/user-scope')
    return res.data
  },

  getTemplates: async (): Promise<DashboardTemplate[]> => {
    const res = await api.get('/dashboard/templates')
    return res.data
  },

  getTemplate: async (id: number): Promise<{ template: DashboardTemplate; widgets: WidgetModel[] }> => {
    const res = await api.get(`/dashboard/templates/${id}`)
    return res.data
  },

  createTemplate: async (payload: {
    name: string
    slug: string
    description?: string
    role_id?: number | null
    department?: string | null
    is_default?: boolean
    allow_user_customization?: boolean
    widgets: {
      widget_id: number
      widget_key: string
      position: number
      col_span: number
      is_visible: boolean
    }[]
  }) => {
    const res = await api.post('/dashboard/templates', payload)
    return res.data
  },

  updateTemplate: async (
    id: number,
    payload: {
      name?: string
      description?: string
      role_id?: number | null
      department?: string | null
      is_default?: boolean
      allow_user_customization?: boolean
      widgets?: {
        widget_id: number
        widget_key: string
        position: number
        col_span: number
        is_visible: boolean
      }[]
    }
  ) => {
    const res = await api.put(`/dashboard/templates/${id}`, payload)
    return res.data
  },

  cloneTemplate: async (id: number) => {
    const res = await api.post(`/dashboard/templates/${id}/clone`)
    return res.data
  },

  deleteTemplate: async (id: number) => {
    const res = await api.delete(`/dashboard/templates/${id}`)
    return res.data
  },

  getWidgetLibrary: async (): Promise<WidgetModel[]> => {
    const res = await api.get('/dashboard/widgets')
    return res.data
  },

  savePreferences: async (templateId: number, layoutOverrides: Record<string, any>) => {
    const res = await api.post('/dashboard/preferences', {
      template_id: templateId,
      layout_overrides: layoutOverrides,
    })
    return res.data
  },

  resetPreferences: async (templateId: number) => {
    const res = await api.delete(`/dashboard/preferences/${templateId}`)
    return res.data
  },

  getUserAssignments: async (userId: number): Promise<UserAssignmentsResponse> => {
    const res = await api.get(`/dashboard/users/${userId}/assignments`)
    return res.data
  },

  updateUserAssignments: async (
    userId: number,
    payload: {
      outlet_ids: number[]
      category_ids: number[]
      default_template_id?: number | null
    }
  ) => {
    const res = await api.post(`/dashboard/users/${userId}/assignments`, payload)
    return res.data
  },
}
