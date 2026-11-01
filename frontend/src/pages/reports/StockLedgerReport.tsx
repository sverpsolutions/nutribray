import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const StockLedgerReport = () => {
  const [outletId, setOutletId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (outletId) params.outlet_id = outletId;
      if (search) params.search = search;
      const res = await api.get(`/reports/ledger`, { params });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);
  const s = data?.summary || {};

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-rose-600 text-white p-1 rounded"><i className="fas fa-book"></i></span>
            Stock Ledger
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Item-wise Inventory Balance · Current QOH · Valuation</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Search Item</label>
            <input type="text" className="form-control h-9 text-xs w-64" placeholder="Item code or name..."
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetch()} /></div>
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Search
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total SKUs',    value: s.total_skus,   fmt: false, color: 'text-slate-800' },
          { label: 'Total Qty',     value: s.total_qty,    fmt: false, color: 'text-blue-700' },
          { label: 'Stock Value',   value: s.total_value,  fmt: true,  color: 'text-rose-700 font-black' },
        ].map((c, i) => (
          <div key={i} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2">{c.label}</div>
            <div className={`text-2xl font-black ${c.color}`}>{c.fmt ? fmt(c.value || 0) : (c.value || 0)}</div>
          </div>
        ))}
      </div>

      {s.total_skus === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <i className="fas fa-info-circle text-amber-500 text-2xl mb-2"></i>
          <p className="text-amber-700 font-bold text-sm">Stock data not yet available</p>
          <p className="text-amber-600 text-xs mt-1">Run <strong>Refresh Store Stock (QOH)</strong> sync and ensure products are imported.</p>
        </div>
      )}

      {/* Ledger Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="bg-[#1a1a2e] text-white px-6 py-3 flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-widest">Stock Ledger</span>
          <span className="text-xs opacity-60">{s.total_skus || 0} items</span>
        </div>
        <div className="overflow-x-auto">
          {loading ? <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div> : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Outlet</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Item Code</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Item Name</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Category</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Brand</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Bal Qty</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">MRP</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Stock Value</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className={`hover:bg-slate-50 ${+r.current_stock <= 0 ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 text-slate-500 text-[10px]">{r.outlet_name || '—'}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-blue-600">{r.item_code || '—'}</td>
                    <td className="px-4 py-2.5 font-medium">{r.item_name || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.category || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.brand || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold">{(+r.current_stock || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.sale_price ? fmt(+r.sale_price) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold font-mono text-rose-700">{fmt(+r.stock_value)}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-[10px]">{r.last_sync?.split('T')[0] || '—'}</td>
                  </tr>
                ))}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={9} className="px-6 py-10 text-center text-slate-400">
                    No stock records found. Run QOH sync and product import first.
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockLedgerReport;
