import api from '../api/axios';


export const shopService = {
  // Consumer-facing
  placeOrder: async (orderData: any) => {
    const res = await api.post(`/shop/orders`, orderData);
    return res.data;
  },

  // Admin: Dashboard
  getShopDashboard: async () => {
    const res = await api.get(`/shop/admin/dashboard`);
    return res.data;
  },
  getShopSalesReport: async () => {
    const res = await api.get(`/shop/reports/sales`);
    return res.data;
  },
  getShopTopProducts: async () => {
    const res = await api.get(`/shop/reports/top-products`);
    return res.data;
  },

  // Admin: Orders
  getAdminOrders: async (params: { page?: number; per_page?: number; status?: string; search?: string } = {}) => {
    const res = await api.get(`/shop/admin/orders`, { params });
    return res.data;
  },
  getOrderDetail: async (orderId: number) => {
    const res = await api.get(`/shop/admin/orders/${orderId}`);
    return res.data;
  },
  updateOrderStatus: async (orderId: number, status: string) => {
    const res = await api.put(`/shop/admin/orders/${orderId}/status`, null, { params: { status } });
    return res.data;
  },

  // Admin: Customers
  getAdminCustomers: async (params: { page?: number; per_page?: number; search?: string } = {}) => {
    const res = await api.get(`/shop/admin/customers`, { params });
    return res.data;
  },

  // Banners
  getBanners: async () => {
    const res = await api.get(`/shop/banners`);
    return res.data;
  },
  getAdminBanners: async () => {
    const res = await api.get(`/shop/admin/banners`);
    return res.data;
  },
  createBanner: async (data: any) => {
    const res = await api.post(`/shop/admin/banners`, data);
    return res.data;
  },
  deleteBanner: async (id: number) => {
    const res = await api.delete(`/shop/admin/banners/${id}`);
    return res.data;
  },
  autoSetupProductImages: async (dryRun: boolean = false) => {
    const res = await api.post(`/shop/admin/products/auto-image-setup`, { dry_run: dryRun });
    return res.data;
  }
};
