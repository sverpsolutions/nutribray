import api from './axios';

export const import_export_api = {
  downloadTemplate: () => api.get('/import-export/template', { responseType: 'blob' }),
  previewImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/import-export/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  processImport: (filename: string, autoCreate: boolean = true) => api.post(`/import-export/process?filename=${filename}&auto_create=${autoCreate}`),
  getHistory: () => api.get('/import-export/history'),
};
