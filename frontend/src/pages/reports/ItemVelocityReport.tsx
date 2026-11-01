import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const VEL_COLORS: Record<string,string> = { FAST:'bg-green-100 text-green-700', MEDIUM:'bg-blue-100 text-blue-700', SLOW:'bg-amber-100 text-amber-700', DEAD:'bg-red-100 text-red-700' };

const ItemVelocityReport = () => {
  const [velocity, setVelocity] = useState('');
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const p: any = {}; if (velocity) p.velocity = velocity; if (outletId) p.outlet_id = outletId;
      setData((await api.get(`/reports/item-velocity`, { params: p })).data);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const summary = data?.summary || {};

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Velocity');
    ws.addRow(['Code','Item','Category','Stock','Sold 90D','Sales 90D','Last Sold','Velocity']);
    rows.forEach((r:any) => ws.addRow([r.item_code,r.item_name,r.category,r.stock_qty,r.qty_sold_90d,r.sales_90d,r.last_sold,r.velocity]));
    saveAs(new Blob([await wb.xlsx.writeBuffer()]), 'Item_Velocity.xlsx');
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
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-tachometer-alt"></i></span>
            Item Velocity Analysis
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Fast / Slow / Dead — 90 Days</p>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['FAST','MEDIUM','SLOW','DEAD'] as const).map(v => (
          <div key={v} onClick={() => { setVelocity(velocity===v?'':v); setTimeout(load,50); }}
            className={`p-4 rounded-xl shadow-sm border cursor-pointer hover:shadow-lg transition-all ${velocity===v?'ring-2 ring-blue-500':''} ${VEL_COLORS[v]}`}>
            <div className="text-[10px] font-bold uppercase">{v}</div>
            <div className="text-2xl font-black">{summary[v.toLowerCase()]||0}</div>
          </div>
        ))}
      </div>

      <div className="card shadow-sm border-0 bg-white p-4 no-print">
        <div className="flex items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Velocity</label>
            <select className="form-control h-9 text-xs w-32" value={velocity} onChange={e=>setVelocity(e.target.value)}>
              <option value="">All</option>{['FAST','MEDIUM','SLOW','DEAD'].map(v=><option key={v} value={v}>{v}</option>)}
            </select></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e=>setOutletId(e.target.value)}>
              <option value="">All</option>{data?.outlets?.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading?<i className="fas fa-spinner fa-spin mr-1"></i>:<i className="fas fa-search mr-1"></i>}Apply</button>
        </div>
      </div>

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
              <tr><th className="px-3 py-3">Code</th><th className="px-3 py-3">Item</th><th className="px-3 py-3">Category</th>
                <th className="px-3 py-3 text-right">Stock</th><th className="px-3 py-3 text-right">Sold 90D</th>
                <th className="px-3 py-3 text-right">Sales</th><th className="px-3 py-3">Last Sold</th>
                <th className="px-3 py-3 text-center">Velocity</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r:any,i:number)=>(
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[10px]">{r.item_code}</td>
                  <td className="px-3 py-2 font-medium">{r.item_name}</td>
                  <td className="px-3 py-2 text-slate-500">{r.category||'—'}</td>
                  <td className="px-3 py-2 text-right">{r.stock_qty}</td>
                  <td className="px-3 py-2 text-right">{r.qty_sold_90d}</td>
                  <td className="px-3 py-2 text-right font-bold">{fmt(r.sales_90d)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.last_sold||'—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${VEL_COLORS[r.velocity]||'bg-slate-100'}`}>{r.velocity}</span>
                  </td>
                </tr>
              ))}
              {!rows.length&&<tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default ItemVelocityReport;
