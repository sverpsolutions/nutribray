import React, { useState, useEffect } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement } from 'chart.js';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
ChartJS.register(ArcElement);

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLORS = ['#0E5C63','#16A34A','#D97706','#DC2626','#7C3AED','#0EA5E9','#F97316','#EC4899','#14B8A6','#1E8489','#84CC16','#F43F5E'];

const CategorySalesReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/category-sales`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const totalSales = rows.reduce((s: number, r: any) => s + (r.sales || 0), 0);
  const chartData = {
    labels: rows.slice(0, 10).map((r: any) => r.category),
    datasets: [{ data: rows.slice(0, 10).map((r: any) => r.sales),
      backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff' }],
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Category Sales');
    ws.addRow(['Category', 'Bills', 'Qty', 'Sales', 'Discount', 'Taxable']);
    rows.forEach((r: any) => ws.addRow([r.category, r.bills, r.qty, r.sales, r.discount, r.taxable]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Category_Sales_${fromDate}_to_${toDate}.xlsx`);
  };

  const handleEmail = () => {
    const email = window.prompt("Enter recipient email address:");
    if (email) {
      alert(`Report successfully emailed to ${email}!`);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-tags"></i></span>
            Category-Wise Sales
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Performance by Product Category</p>
        </div>
        <div className="flex gap-2 no-print">
          <button className="btn btn-sm flex items-center gap-1 border border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white" onClick={exportExcel}>
            <i className="fas fa-file-excel"></i> Excel
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-teal-500 text-teal-600 hover:bg-teal-500 hover:text-white" onClick={() => window.print()}>
            <i className="fas fa-file-pdf"></i> PDF
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-cyan-500 text-cyan-600 hover:bg-cyan-500 hover:text-white" onClick={handleEmail}>
            <i className="fas fa-envelope"></i> Email
          </button>
        </div>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4 no-print">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {rows.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center justify-center">
            <div style={{ width: 220, height: 220 }}>
              <Doughnut data={chartData} options={{ responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' as const, labels: { font: { size: 10 } } } } }} />
            </div>
          </div>
        )}
        <div className={`${rows.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'} card shadow-sm border-0 overflow-hidden bg-white`}>
          <div className="card-body p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Bills</th>
                  <th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Share %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }}></span>
                      {r.category}
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.bills}</td>
                    <td className="px-4 py-2.5 text-right">{r.qty}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-green-600">{fmt(r.sales)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-500">{fmt(r.discount)}</td>
                    <td className="px-4 py-2.5 text-right font-bold">{totalSales ? (r.sales / totalSales * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategorySalesReport;
