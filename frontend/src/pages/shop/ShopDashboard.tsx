import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, ShoppingCart, Package, Calendar, ArrowUpRight, DollarSign, Users, Settings, Eye, Clock, CheckCircle, XCircle, Truck, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { shopService } from '../../services/shopService';

const ShopDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [dashStats, sales, products, orders] = await Promise.all([
          shopService.getShopDashboard(),
          shopService.getShopSalesReport(),
          shopService.getShopTopProducts(),
          shopService.getAdminOrders({ per_page: 5 })
        ]);
        setStats(dashStats);
        setSalesData(sales);
        setTopProducts(products);
        setRecentOrders(orders.data || []);
      } catch (err) {
        console.error("Error loading shop dashboard:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    processing: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    delivered: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-3 h-3" />,
    processing: <Package className="w-3 h-3" />,
    shipped: <Truck className="w-3 h-3" />,
    delivered: <CheckCircle className="w-3 h-3" />,
    cancelled: <XCircle className="w-3 h-3" />,
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-10 bg-slate-200 rounded-xl w-64 animate-pulse" />
        <div className="grid grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-36 bg-white rounded-3xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-2 gap-6">
          {[1,2].map(i => <div key={i} className="h-72 bg-white rounded-3xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center">
              <ShoppingCart className="text-white w-5 h-5" />
            </div>
            Shop Dashboard
          </h1>
          <p className="text-slate-500 font-medium mt-1">Overview of your online shop performance</p>
        </div>
        <div className="flex gap-2">
          <Link 
            to="/admin/shop/orders"
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-sm transition-colors shadow-sm"
          >
            <Package className="w-4 h-4" />
            Orders
          </Link>
          <Link 
            to="/admin/shop/customers"
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-sm transition-colors shadow-sm"
          >
            <Users className="w-4 h-4" />
            Customers
          </Link>
          <Link 
            to="/shop"
            target="_blank"
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors shadow-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open Shop
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Sales', value: `₹${parseFloat(stats?.total_sales || 0).toLocaleString('en-IN')}`, icon: DollarSign, color: 'bg-emerald-500', bgLight: 'bg-emerald-50' },
          { label: 'Total Orders', value: stats?.total_orders || 0, icon: ShoppingCart, color: 'bg-blue-500', bgLight: 'bg-blue-50' },
          { label: 'Shop Customers', value: stats?.total_customers || 0, icon: Users, color: 'bg-violet-500', bgLight: 'bg-violet-50' },
          { label: 'Avg Order Value', value: `₹${parseFloat(stats?.avg_order_value || 0).toLocaleString('en-IN')}`, icon: TrendingUp, color: 'bg-amber-500', bgLight: 'bg-amber-50' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className={`${stat.color} p-3 rounded-2xl`}>
                <stat.icon className="text-white w-6 h-6" />
              </div>
            </div>
            <div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{stat.label}</p>
              <h3 className="text-2xl font-black text-slate-900">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Order Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-400 rounded-xl flex items-center justify-center">
            <Clock className="text-white w-6 h-6" />
          </div>
          <div>
            <p className="text-amber-600 text-xs font-bold uppercase">Pending Orders</p>
            <p className="text-2xl font-black text-amber-800">{stats?.pending_orders || 0}</p>
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-400 rounded-xl flex items-center justify-center">
            <CheckCircle className="text-white w-6 h-6" />
          </div>
          <div>
            <p className="text-emerald-600 text-xs font-bold uppercase">Delivered</p>
            <p className="text-2xl font-black text-emerald-800">{stats?.delivered_orders || 0}</p>
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-400 rounded-xl flex items-center justify-center">
            <BarChart3 className="text-white w-6 h-6" />
          </div>
          <div>
            <p className="text-blue-600 text-xs font-bold uppercase">Today's Sales</p>
            <p className="text-2xl font-black text-blue-800">
              ₹{salesData.length > 0 ? parseFloat(salesData[salesData.length - 1]?.total_sales || 0).toLocaleString('en-IN') : '0'}
            </p>
          </div>
        </div>
      </div>

      {/* Charts Area */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Top Products */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-500" />
            Top Selling Products
          </h2>
          {topProducts.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">No product data yet</div>
          ) : (
            <div className="space-y-3">
              {topProducts.slice(0, 8).map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-xs font-black text-slate-500">
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{p.name}</p>
                    <p className="text-xs text-slate-400">{parseFloat(p.total_qty).toFixed(0)} units sold</p>
                  </div>
                  <span className="text-sm font-black text-emerald-600">₹{parseFloat(p.total_sales).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-500" />
              Recent Orders
            </h2>
            <Link to="/admin/shop/orders" className="text-blue-600 text-xs font-bold hover:underline flex items-center gap-1">
              View All <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">No orders yet</div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order: any, i: number) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm">{order.order_no}</p>
                    <p className="text-xs text-slate-400">{order.customer_name || 'Walk-in'} • {order.order_date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-800">₹{parseFloat(order.total_amount).toLocaleString('en-IN')}</p>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColors[order.order_status] || 'bg-slate-100 text-slate-600'}`}>
                      {statusIcons[order.order_status]}
                      {order.order_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShopDashboard;
