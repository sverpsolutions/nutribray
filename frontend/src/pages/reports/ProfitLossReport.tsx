import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const PLRow = ({ label, value, indent = 0, bold = false, color = '' }: any) => (
  <tr className={bold ? 'bg-slate-50 font-black' : ''}>
    <td className={`px-6 py-2.5 text-xs ${bold ? 'font-black text-slate-800' : 'text-slate-600'}`} style={{ paddingLeft: `${(indent * 20) + 24}px` }}>
      {indent > 0 && <span className="text-slate-300 mr-2">└</span>}{label}
    </td>
    <td className={`px-6 py-2.5 text-right text-xs font-mono ${color || (bold ? 'text-slate-800' : 'text-slate-700')}`}>{fmt(value)}</td>
  </tr>
);

const ProfitLossReport = () => {
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/pl`, { params });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);
  const s = data?.summary || {};
  const isProfit = (s.gross_profit || 0) >= 0;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-indigo-600 text-white p-1 rounded"><i className="fas fa-balance-scale"></i></span>
            Profit &amp; Loss Statement
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Revenue · COGS · Gross Margin</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From Date</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To Date</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : null}Apply
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-3xl"></i></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* P&L Statement */}
          <div className="lg:col-span-2">
            <div className="card shadow-sm border-0 bg-white overflow-hidden">
              <div className="bg-[#1a1a2e] text-white px-6 py-3">
                <span className="text-xs font-bold uppercase tracking-widest">Income Statement</span>
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  <PLRow label="REVENUE" value={0} bold />
                  <PLRow label="Gross Sales" value={s.gross_sales} indent={1} />
                  <PLRow label="Sales Returns" value={s.sales_returns} indent={1} color="text-red-600" />
                  <PLRow label="Total Discount" value={s.total_discount} indent={1} color="text-amber-600" />
                  <PLRow label="Net Sales (incl. GST)" value={s.net_sales} bold color="text-blue-700" />
                  <PLRow label="Output GST" value={s.total_gst_out} indent={1} color="text-blue-500" />
                  <PLRow label="Net Sales (excl. GST)" value={s.net_excl_gst} bold color="text-green-700" />

                  <tr><td colSpan={2} className="px-6 pt-4 pb-1 text-[10px] font-black uppercase text-slate-400 tracking-widest bg-slate-50">Cost of Goods Sold</td></tr>
                  <PLRow label="Purchases / COGS" value={s.cost_of_goods} indent={1} color="text-red-600" />

                  <tr className="bg-slate-900">
                    <td className="px-6 py-4 text-sm font-black text-white uppercase tracking-wide">
                      {isProfit ? '✓ GROSS PROFIT' : '✗ GROSS LOSS'}
                    </td>
                    <td className={`px-6 py-4 text-right text-sm font-black font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                      {fmt(s.gross_profit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* KPI Panel */}
          <div className="space-y-4">
            <div className={`rounded-2xl p-6 text-white text-center ${isProfit ? 'bg-gradient-to-br from-green-600 to-emerald-700' : 'bg-gradient-to-br from-red-600 to-rose-700'}`}>
              <div className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">Gross Profit Margin</div>
              <div className="text-5xl font-black">{s.gp_percent || 0}<span className="text-2xl">%</span></div>
              <div className="text-xs opacity-70 mt-2">{fromDate} → {toDate}</div>
            </div>
            {[
              { label: 'Net Sales', value: s.net_excl_gst, color: 'text-green-700' },
              { label: 'Total COGS', value: s.cost_of_goods, color: 'text-red-600' },
              { label: 'Output GST', value: s.total_gst_out, color: 'text-blue-600' },
              { label: 'Total Discount', value: s.total_discount, color: 'text-amber-600' },
            ].map((k, i) => (
              <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase text-slate-500">{k.label}</span>
                <span className={`text-sm font-black font-mono ${k.color}`}>{fmt(k.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {!loading && data?.monthly?.length > 0 && (
        <div className="card shadow-sm border-0 bg-white overflow-hidden">
          <div className="bg-[#1a1a2e] text-white px-6 py-3">
            <span className="text-xs font-bold uppercase tracking-widest">Monthly Sales Trend</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Month</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Sales</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">GST</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Discount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.monthly.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-6 py-2.5 font-bold">{r.month}</td>
                  <td className="px-6 py-2.5 text-right font-mono text-green-700">{fmt(r.sales)}</td>
                  <td className="px-6 py-2.5 text-right font-mono text-blue-600">{fmt(r.gst)}</td>
                  <td className="px-6 py-2.5 text-right font-mono text-amber-600">{fmt(r.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProfitLossReport;
