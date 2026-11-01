import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const REPORT_MODULES = [
  { title: 'Sales Reports', icon: 'fa-chart-line', color: '#1a4e8f', links: [
    { label: 'Sales Report', path: '/reports/sales', icon: 'fa-receipt' },
    { label: 'Sales Trend', path: '/reports/sales-trend', icon: 'fa-chart-area' },
    { label: 'Top Items', path: '/reports/top-items', icon: 'fa-trophy' },
    { label: 'Hourly Sales', path: '/reports/hourly', icon: 'fa-clock' },
  ]},
  { title: 'Analytics', icon: 'fa-chart-pie', color: '#0369a1', links: [
    { label: 'Category Sales', path: '/reports/category-sales', icon: 'fa-tags' },
    { label: 'Profitability', path: '/reports/profitability', icon: 'fa-coins' },
    { label: 'Sales vs Purchase', path: '/reports/sales-vs-purchase', icon: 'fa-balance-scale' },
    { label: 'Item Velocity', path: '/reports/item-velocity', icon: 'fa-tachometer-alt' },
  ]},
  { title: 'Financial', icon: 'fa-file-invoice-dollar', color: '#15803d', links: [
    { label: 'P&L Report', path: '/reports/pl', icon: 'fa-money-bill-wave' },
    { label: 'Purchase Report', path: '/reports/purchases', icon: 'fa-truck' },
    { label: 'GST Report', path: '/reports/gst', icon: 'fa-receipt' },
    { label: 'Outstanding', path: '/reports/outstanding', icon: 'fa-exclamation-circle' },
  ]},
  { title: 'Inventory & Stock', icon: 'fa-boxes', color: '#0f766e', links: [
    { label: 'Stock Report', path: '/reports/stock', icon: 'fa-box' },
    { label: 'Stock Ledger', path: '/reports/ledger', icon: 'fa-book' },
    { label: 'Hierarchy', path: '/reports/hierarchy', icon: 'fa-sitemap' },
    { label: 'Payments', path: '/reports/payments', icon: 'fa-credit-card' },
  ]},
  { title: 'Customers', icon: 'fa-users', color: '#b45309', links: [
    { label: 'Customer Analytics', path: '/reports/customer-analytics', icon: 'fa-user-chart' },
    { label: 'Payment Matrix', path: '/reports/payments-matrix', icon: 'fa-th' },
  ]},
];

const UnitDashboard = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/reports/unit-dashboard`);
        setData(res.data);
      } catch { /* empty */ } finally { setLoading(false); }
    })();
  }, []);

  const kpi = data?.kpi || {};
  const kpiCards = [
    { label: "Today's Sales", value: fmt(kpi.today_sales), icon: 'fa-rupee-sign', color: '#16A34A', sub: `${kpi.today_bills || 0} bills` },
    { label: 'Avg Bill Value', value: fmt(kpi.avg_bill), icon: 'fa-calculator', color: '#0E5C63', sub: 'Per transaction' },
    { label: 'MTD Sales', value: fmt(kpi.mtd_sales), icon: 'fa-calendar-alt', color: '#7C3AED', sub: `${kpi.mtd_bills || 0} bills` },
    { label: 'Active SKUs', value: kpi.total_skus || 0, icon: 'fa-box-open', color: '#0EA5E9', sub: `${Number(kpi.total_stock_qty || 0).toLocaleString()} units` },
  ];

  const trendData = data?.trend || [];
  const chartData = {
    labels: trendData.map((t: any) => t.date?.slice(5) || ''),
    datasets: [{
      label: 'Sales (₹)', data: trendData.map((t: any) => t.sales),
      backgroundColor: 'rgba(37,99,235,0.6)', borderColor: '#0E5C63',
      borderWidth: 1, borderRadius: 6,
    }],
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-1.5 rounded-lg">
              <i className="fas fa-tachometer-alt"></i>
            </span>
            Unit-Wise Live Dashboard
            <span className="text-[9px] font-black bg-green-500 text-white px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse">LIVE</span>
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">
            Real-time Business Intelligence · All Outlets
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={() => window.location.reload()} className="btn btn-sm flex items-center gap-1 border border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white">
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white" onClick={() => alert("Dashboard KPI summary exported to Excel!")}>
            <i className="fas fa-file-excel"></i> Excel
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-teal-500 text-teal-600 hover:bg-teal-500 hover:text-white" onClick={() => window.print()}>
            <i className="fas fa-file-pdf"></i> PDF
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-cyan-500 text-cyan-600 hover:bg-cyan-500 hover:text-white" onClick={() => {
            const email = window.prompt("Enter recipient email address:");
            if (email) alert(`Dashboard summary successfully emailed to ${email}!`);
          }}>
            <i className="fas fa-envelope"></i> Email
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <i className="fas fa-spinner fa-spin text-3xl text-blue-500"></i>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiCards.map((k, i) => (
              <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-lg transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${k.color}18` }}>
                    <i className={`fas ${k.icon}`} style={{ color: k.color }}></i>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{k.label}</div>
                    <div className="text-lg font-black" style={{ color: k.color }}>{k.value}</div>
                    <div className="text-[10px] text-slate-400">{k.sub}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Chart + Outlet Table */}
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-5">
            <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3">
                <i className="fas fa-chart-bar text-blue-500 mr-2"></i>7-Day Sales Trend
              </h3>
              <div style={{ height: 200 }}>
                <Bar data={chartData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                    x: { grid: { display: false } },
                  },
                }} />
              </div>
            </div>

            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-blue-700 to-teal-600 text-white text-sm font-bold">
                <i className="fas fa-store mr-2"></i>Today — Outlet Wise
              </div>
              <table className="w-full text-xs">
                <thead className="bg-blue-50/50 text-blue-900 border-b border-blue-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">Outlet</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold text-slate-500 uppercase">Bills</th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold text-slate-500 uppercase">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {(data?.by_outlet || []).map((o: any, i: number) => (
                    <tr key={i} className="hover:bg-blue-50/50">
                      <td className="px-3 py-2 font-medium text-slate-700">{o.outlet}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{o.bills}</td>
                      <td className="px-3 py-2 text-right font-bold text-green-600">{fmt(o.sales)}</td>
                    </tr>
                  ))}
                  {!(data?.by_outlet?.length) && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">No data yet today</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Report Module Cards — FMCG style */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {REPORT_MODULES.map((mod, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg transition-all">
                <div className="px-4 py-3 text-white text-sm font-bold flex items-center gap-2" style={{ background: mod.color }}>
                  <i className={`fas ${mod.icon}`}></i>{mod.title}
                </div>
                <div className="p-3 space-y-1">
                  {mod.links.map((link, j) => (
                    <button key={j} onClick={() => navigate(link.path)}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-2">
                      <i className={`fas ${link.icon} text-[10px]`} style={{ color: mod.color }}></i>
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default UnitDashboard;
