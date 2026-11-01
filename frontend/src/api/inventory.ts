import axios from './axios';

export const inventory_api = {
    getBranches: () => axios.get('/inventory/multi-transfer/branches').then(r => r.data),
    
    saveDraft: (data: any) => axios.post('/inventory/multi-transfer/save', data).then(r => r.data),
    
    confirmSession: (sessionId: number) => axios.post(`/inventory/multi-transfer/confirm/${sessionId}`).then(r => r.data),

    getTransferPrint: (trfId: number) => axios.get(`/inventory/multi-transfer/transfer/${trfId}/print`).then(r => r.data),

    receiveTransfer: (trfId: number, body: { lines: { item_id: number; received_qty: number }[]; remarks?: string }) =>
        axios.post(`/inventory/multi-transfer/transfer/${trfId}/receive`, body).then(r => r.data),

    listTransfers: (params: Record<string, string | number | undefined>) =>
        axios.get('/inventory/multi-transfer/transfers', { params }).then(r => r.data),
    
    // Existing inventory endpoints could go here...
    getStatus: () => axios.get('/inventory/status').then(r => r.data),
};
