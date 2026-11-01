import React, { useEffect, useState } from 'react';
import { Package, Search, Filter, Eye, Clock, CheckCircle, XCircle, Truck, ChevronLeft, ChevronRight, RefreshCw, X, ShoppingBag } from 'lucide-react';
import { shopService } from '../../services/shopService';
import toast from 'react-hot-toast';

const ShopOrders: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: 15 };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const res = await shopService.getAdminOrders(params);
      setOrders(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      console.error('Error loading orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrders(); }, [page, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadOrders();
  };

  const viewOrderDetail = async (orderId: number) => {
    setDetailLoading(true);
    try {
      const detail = await shopService.getOrderDetail(orderId);
      setSelectedOrder(detail);
    } catch (err) {
      toast.error('Failed to load order details');
    } finally {
      setDetailLoading(false);
    }
  };

  const updateStatus = async (orderId: number, newStatus: string) => {
    try {
      await shopService.updateOrderStatus(orderId, newStatus);
      toast.success(`Order status updated to ${newStatus}`);
      loadOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, order_status: newStatus });
      }
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    processing: 'bg-blue-100 text-blue-700 border-blue-200',
    shipped: 'bg-purple-100 text-purple-700 border-purple-200',
    delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-100 text-red-700 border-red-200',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-3.5 h-3.5" />,
    processing: <Package className="w-3.5 h-3.5" />,
    shipped: <Truck className="w-3.5 h-3.5" />,
    delivered: <CheckCircle className="w-3.5 h-3.5" />,
    cancelled: <XCircle className="w-3.5 h-3.5" />,
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center">
              <Package className="text-white w-5 h-5" />
            </div>
            Shop Orders
          </h1>
          <p className="text-slate-500 font-medium mt-1">Manage all online shop orders • {total} total</p>
        </div>
        <button onClick={loadOrders} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl font-bold text-sm text-slate-600 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by order number..."
            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-medium text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none transition-all"
          />
        </form>
        <div className="flex gap-2">
          {['', 'pending', 'processing', 'shipped', 'delivered', 'cancelled'].map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                statusFilter === s 
                  ? 'bg-slate-900 text-white border-slate-900' 
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
              <tr>
                <th className="px-6 py-4">Order No</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Customer</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm font-medium text-slate-600 divide-y divide-slate-50">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-slate-100 rounded-full animate-pulse w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <ShoppingBag className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                    <p className="text-slate-400 font-bold">No orders found</p>
                  </td>
                </tr>
              ) : (
                orders.map((order: any) => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => viewOrderDetail(order.id)}>
                    <td className="px-6 py-4 font-black text-slate-900">{order.order_no}</td>
                    <td className="px-6 py-4 text-slate-500">{order.order_date}</td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-slate-800">{order.customer_name || 'Walk-in'}</p>
                        <p className="text-xs text-slate-400">{order.customer_phone || '-'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-black text-emerald-600">₹{parseFloat(order.total_amount).toLocaleString('en-IN')}</td>
                    <td className="px-6 py-4 capitalize text-slate-500">{order.payment_mode}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${statusColors[order.order_status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {statusIcons[order.order_status]}
                        {order.order_status}
                      </span>
                    </td>
                    <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                      <select
                        value={order.order_status}
                        onChange={e => updateStatus(order.id, e.target.value)}
                        className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 outline-none cursor-pointer"
                      >
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-medium">Page {page} of {totalPages} • {total} orders</p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedOrder(null)}>
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white rounded-t-3xl z-10">
              <div>
                <h2 className="text-xl font-black text-slate-900">{selectedOrder.order_no}</h2>
                <p className="text-xs text-slate-400 font-medium">Placed on {selectedOrder.order_date}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Customer Info */}
              <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase">Customer</p>
                <p className="font-bold text-slate-800">{selectedOrder.customer_name || 'Walk-in Customer'}</p>
                <p className="text-sm text-slate-500">{selectedOrder.customer_phone || 'No phone'}</p>
                {selectedOrder.delivery_address && (
                  <p className="text-sm text-slate-500">📍 {selectedOrder.delivery_address}</p>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase border ${statusColors[selectedOrder.order_status]}`}>
                  {statusIcons[selectedOrder.order_status]}
                  {selectedOrder.order_status}
                </span>
                <span className="text-xs text-slate-400 font-medium">Payment: {selectedOrder.payment_mode} ({selectedOrder.payment_status})</span>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase">Items</p>
                <div className="space-y-2">
                  {(selectedOrder.items || []).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div>
                        <p className="font-bold text-sm text-slate-800">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.qty} {item.unit || 'pcs'} × ₹{item.rate}</p>
                      </div>
                      <p className="font-black text-sm text-slate-900">₹{item.total}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t border-dashed border-slate-200 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-bold">₹{selectedOrder.subtotal}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Delivery</span>
                  <span className="font-bold">₹{selectedOrder.delivery_fee}</span>
                </div>
                {selectedOrder.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span className="font-bold">-₹{selectedOrder.discount}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-black text-slate-900 pt-2 border-t border-slate-200">
                  <span>Total</span>
                  <span>₹{selectedOrder.total_amount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopOrders;
