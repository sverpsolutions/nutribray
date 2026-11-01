import api from './axios';

export const audit_api = {
  log: (data: { action: string; module: string; record_id?: string; details?: string; meta_data?: any }) =>
    api.post('/audit-logs', data),
  list: (params?: any) => api.get('/audit-logs', { params }),
};
