import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, ShoppingCart, Package, Calendar, ArrowUpRight, DollarSign, Users, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { shopService } from '../../services/shopService';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, LineElement, PointElement, ArcElement } from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend);

const ShopReports: React.FC = () => {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [sales, products] = await Promise.all([
          shopService.getShopSalesReport(),
          shopService.getShopTopProducts()
        ]);
        setSalesData(sales);
        setTopProducts(products);
      } catch (err) {
        console.error("Error loading shop reports:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const totalSales = salesData.reduce((acc, curr) => acc + parseFloat(curr.total_sales), 0);
  const totalOrders = salesData.reduce((acc, curr) => acc + curr.order_count, 0);

  const lineChartData = {
    labels: salesData.map(d => d.date),
    datasets: [
      {
        label: 'Daily Sales (₹)',
        data: salesData.map(d => d.total_sales),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
      }
    ]
  };

  const barChartData = {
    labels: topProducts.map(p => p.name),
    datasets: [
      {
        label: 'Sales by Product (₹)',
        data: topProducts.map(p => p.total_sales),
        backgroundColor: '#3b82f6',
        borderRadius: 8,
      }
    ]
  };

  return (
    <div className="p-6 space-y-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <ShoppingCart className="text-green-600 w-8 h-8" />
            Online Shop Analytics
          </h1>
          <p className="text-slate-500 font-medium">Tracking separate transactional data from the consumer app</p>
        </div>
        <div className="flex gap-2 bg-white p-1 rounded-2xl shadow-sm border border-slate-200">
          <Link 
            to="/admin/shop/settings"
            className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-slate-600 rounded-xl font-bold text-sm transition-colors"
          >
            <Settings className="w-4 h-4" />
            Shop Settings
          </Link>
          <div className="w-px h-6 bg-slate-200 my-auto mx-1" />
          <button className="px-4 py-2 bg-slate-100 text-slate-900 rounded-xl font-bold text-sm">Last 30 Days</button>
          <button className="px-4 py-2 text-slate-500 hover:bg-slate-50 rounded-xl font-bold text-sm">Last Quarter</button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Shop Sales', value: `₹${totalSales.toLocaleString()}`, icon: DollarSign, color: 'bg-emerald-500', trend: '+12.5%' },
          { label: 'Shop Orders', value: totalOrders, icon: ShoppingCart, color: 'bg-blue-500', trend: '+8.2%' },
          { label: 'Shop Customers', value: '1,240', icon: Users, color: 'bg-violet-500', trend: '+15.3%' },
          { label: 'Avg Order Value', value: `₹${totalOrders ? (totalSales / totalOrders).toFixed(2) : 0}`, icon: TrendingUp, color: 'bg-amber-500', trend: '+2.1%' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className={`${stat.color} p-3 rounded-2xl`}>
                <stat.icon className="text-white w-6 h-6" />
              </div>
              <span className="text-emerald-500 text-xs font-bold flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-full">
                <ArrowUpRight className="w-3 h-3" /> {stat.trend}
              </span>
            </div>
            <div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{stat.label}</p>
              <h3 className="text-2xl font-black text-slate-900">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-500" />
              Sales Timeline
            </h2>
          </div>
          <div className="h-64">
            <Line data={lineChartData} options={{ maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }} />
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-500" />
              Top Selling Products
            </h2>
          </div>
          <div className="h-64">
            <Bar data={barChartData} options={{ maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }} />
          </div>
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">Recent Shop Orders</h2>
          <button className="text-blue-600 font-bold text-sm hover:underline">Download CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
              <tr>
                <th className="px-6 py-4">Order ID</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="text-sm font-medium text-slate-600 divide-y divide-slate-50">
              {salesData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">No recent shop transactions found</td>
                </tr>
              ) : (
                salesData.slice(0, 5).map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">SHOP-{Math.random().toString(36).substring(7).toUpperCase()}</td>
                    <td className="px-6 py-4">{row.date}</td>
                    <td className="px-6 py-4 text-emerald-600 font-bold">₹{parseFloat(row.total_sales).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">Delivered</span>
                    </td>
                    <td className="px-6 py-4">
                      <button className="text-slate-400 hover:text-blue-600"><ArrowUpRight className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ShopReports;
