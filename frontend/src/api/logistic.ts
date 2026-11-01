import axios from './axios';

export interface LogisticTransferItem {
    id?: number;
    product_id: number;
    quantity: number;
}

export interface LogisticBoxItem {
    id?: number;
    product_id: number;
    quantity: number;
}

export interface LogisticBox {
    id?: number;
    transfer_id?: number;
    box_number: string;
    weight_kg?: number;
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
    seal_number?: string;
    box_type?: string;
    is_printed?: boolean;
    items?: LogisticBoxItem[];
}

export interface LogisticDispatchDetail {
    id?: number;
    vehicle_reg_no?: string;
    vehicle_type?: string;
    gps_tracking_id?: string;
    eta?: string;
    driver_name?: string;
    driver_mobile?: string;
    driver_license_no?: string;
    helper_name?: string;
    dispatched_at?: string;
}

export interface LogisticTimeline {
    id: number;
    event: string;
    description?: string;
    user_id?: number;
    created_at: string;
}

export interface LogisticTransfer {
    id: number;
    transfer_number: string;
    source_location_id: number;
    destination_location_id: number;
    transfer_date: string;
    priority: string;
    notes?: string;
    status: string;
    items: LogisticTransferItem[];
    boxes: LogisticBox[];
    dispatch_details?: LogisticDispatchDetail;
    timeline: LogisticTimeline[];
}

export const createLogisticTransfer = async (data: any) => {
    const response = await axios.post('/logistics/transfers', data);
    return response.data;
};

export const getLogisticTransfers = async () => {
    const response = await axios.get('/logistics/transfers');
    return response.data;
};

export const getLogisticTransfer = async (id: number) => {
    const response = await axios.get(`/logistics/transfers/${id}`);
    return response.data;
};

export const updateLogisticItems = async (id: number, items: LogisticTransferItem[]) => {
    const response = await axios.put(`/logistics/transfers/${id}/items`, items);
    return response.data;
};

export const createLogisticBox = async (id: number, box: LogisticBox) => {
    const response = await axios.post(`/logistics/transfers/${id}/boxes`, box);
    return response.data;
};

export const updateDispatchDetails = async (id: number, details: LogisticDispatchDetail) => {
    const response = await axios.put(`/logistics/transfers/${id}/dispatch`, details);
    return response.data;
};

export const confirmDispatch = async (id: number) => {
    const response = await axios.post(`/logistics/transfers/${id}/dispatch-confirm`);
    return response.data;
};

export const markBoxPrinted = async (boxId: number) => {
    const response = await axios.post(`/logistics/boxes/${boxId}/mark-printed`);
    return response.data;
};

export const lookupSourceTransfers = async (q: string) => {
    const response = await axios.get('/logistics/transfers/lookup-source', { params: { q } });
    return response.data;
};

export const getSourceTransferDetails = async (id: number) => {
    const response = await axios.get(`/logistics/transfers/source-details/${id}`);
    return response.data;
};
