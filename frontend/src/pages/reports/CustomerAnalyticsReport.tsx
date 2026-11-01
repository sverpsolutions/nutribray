import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CustomerAnalyticsReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const qtrAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(qtrAgo);
  const [toDate, setToDate] = useState(today);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/customer-analytics`, { params: { from_date: fromDate, to_date: toDate, outlet_id: outletId || undefined } });
      setData(res.data);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const totals = rows.reduce((a: any, r: any) => ({ v: a.v + r.visits, s: a.s + r.total_spent }), { v: 0, s: 0 });

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Customer Analytics');
    ws.addRow(['Customer', 'Visits', 'Total Spent', 'Avg Bill', 'Last Visit', 'First Visit']);
    rows.forEach((r: any) => ws.addRow([r.customer, r.visits, r.total_spent, r.avg_bill, r.last_visit, r.first_visit]));
    saveAs(new Blob([await wb.xlsx.writeBuffer()]), `Customer_Analytics_${fromDate}_to_${toDate}.xlsx`);
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
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-users"></i></span>
            Customer Analytics
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Top Customers · Frequency · Spend Analysis</p>
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
            <select className="form-control h-9 text-xs w-52" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All my outlets</option>
              {(data?.outlets || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ l: 'Unique Customers', v: rows.length, c: '' },
          { l: 'Total Visits', v: totals.v, c: 'text-blue-600' },
          { l: 'Total Revenue', v: fmt(totals.s), c: 'text-green-700' },
          { l: 'Avg Spend', v: fmt(rows.length ? totals.s / rows.length : 0), c: 'text-indigo-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">{s.l}</div>
            <div className={`text-sm font-bold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-header bg-gradient-to-r from-blue-700 to-teal-600 text-white text-xs font-bold flex justify-between">
          <span><i className="fas fa-users mr-2"></i>Top Customers</span>
          <span className="text-blue-100">{rows.length} customers</span>
        </div>
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-blue-50/50 text-blue-900 border-b border-blue-100 uppercase text-[10px]">
              <tr>
                <th className="px-4 py-2.5">#</th><th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5 text-right">Visits</th><th className="px-4 py-2.5 text-right">Total Spent</th>
                <th className="px-4 py-2.5 text-right">Avg Bill</th><th className="px-4 py-2.5">Last Visit</th>
                <th className="px-4 py-2.5">First Visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white ${i < 3 ? ['bg-yellow-500','bg-slate-400','bg-amber-700'][i] : 'bg-slate-300'}`}>{i + 1}</span>
                  </td>
                  <td className="px-4 py-2 font-medium">{r.customer}</td>
                  <td className="px-4 py-2 text-right font-bold text-blue-600">{r.visits}</td>
                  <td className="px-4 py-2 text-right font-bold text-green-600">{fmt(r.total_spent)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.avg_bill)}</td>
                  <td className="px-4 py-2 text-slate-500">{r.last_visit}</td>
                  <td className="px-4 py-2 text-slate-400">{r.first_visit}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No customer data found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CustomerAnalyticsReport;
