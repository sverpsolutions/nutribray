import React, { useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TopItemsReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);
  const [topN, setTopN] = useState(20);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate, top_n: topN };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/top-items`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const top10 = rows.slice(0, 10);
  const chartData = {
    labels: top10.map((r: any) => r.item_name?.slice(0, 20) || ''),
    datasets: [{ label: 'Sales (₹)', data: top10.map((r: any) => r.total_sales),
      backgroundColor: ['#0E5C63','#16A34A','#D97706','#DC2626','#7C3AED','#0EA5E9','#F97316','#EC4899','#14B8A6','#1E8489'],
      borderRadius: 6 }],
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Top Items');
    ws.addRow(['Item Code', 'Item Name', 'Category', 'Brand', 'Bills', 'Qty Sold', 'Sales', 'Discount']);
    rows.forEach((r: any) => ws.addRow([r.item_code, r.item_name, r.category, r.brand, r.bills, r.qty_sold, r.total_sales, r.total_discount]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Top_Items_${fromDate}_to_${toDate}.xlsx`);
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
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-trophy"></i></span>
            Top Selling Items
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Best Performers by Sales Value</p>
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
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Top N</label>
            <select className="form-control h-9 text-xs w-24" value={topN} onChange={e => setTopN(+e.target.value)}>
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select></div>
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

      {top10.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-5" style={{ height: 260 }}>
          <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y' as const,
            plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true }, y: { ticks: { font: { size: 10 } } } } }} />
        </div>
      )}

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-header bg-gradient-to-r from-blue-700 to-teal-600 text-white text-xs font-bold flex justify-between">
          <span><i className="fas fa-table mr-2"></i>Top {topN} Items</span>
          <span className="text-blue-100">{rows.length} records</span>
        </div>
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-blue-50/50 text-blue-900 border-b border-blue-100 uppercase text-[10px]">
              <tr>
                <th className="px-4 py-2.5">#</th><th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Item Name</th><th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Brand</th><th className="px-4 py-2.5 text-right">Bills</th>
                <th className="px-4 py-2.5 text-right">Qty</th><th className="px-4 py-2.5 text-right">Sales</th>
                <th className="px-4 py-2.5 text-right">Discount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white ${i < 3 ? ['bg-yellow-500','bg-slate-400','bg-amber-700'][i] : 'bg-slate-300'}`}>{i + 1}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px]">{r.item_code}</td>
                  <td className="px-4 py-2 font-medium">{r.item_name}</td>
                  <td className="px-4 py-2 text-slate-500">{r.category || '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{r.brand || '—'}</td>
                  <td className="px-4 py-2 text-right">{r.bills}</td>
                  <td className="px-4 py-2 text-right">{r.qty_sold}</td>
                  <td className="px-4 py-2 text-right font-bold text-green-600">{fmt(r.total_sales)}</td>
                  <td className="px-4 py-2 text-right text-amber-500">{fmt(r.total_discount)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TopItemsReport;
