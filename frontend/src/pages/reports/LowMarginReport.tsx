import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const LowMarginReport = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/low-margin?threshold=10').then(res => {
      setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-rose-600">Low Margin Alert</h1>
          <p className="text-slate-500 text-sm">Critical items with margin below 10%</p>
        </div>
        <div className="flex gap-2">
            <span className="bg-rose-100 text-rose-600 px-3 py-1 rounded-full text-xs font-bold">{data.length} Alerts</span>
            <button onClick={() => window.print()} className="bg-slate-100 p-2 rounded-lg hover:bg-slate-200"><i className="fas fa-print"></i></button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-rose-100 dark:border-rose-900/30 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-rose-50/50 dark:bg-rose-900/10 border-b border-rose-100 dark:border-rose-900/30">
            <tr>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Channel / Item</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Cost</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Settlement</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Profit</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Current Margin</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
                <tr><td colSpan={6} className="p-10 text-center"><i className="fas fa-spinner fa-spin mr-2"></i>Analyzing margins...</td></tr>
            ) : data.length === 0 ? (
                <tr><td colSpan={6} className="p-20 text-center text-slate-400 italic">No low-margin items found. Great job!</td></tr>
            ) : data.map((row, i) => (
              <tr key={i} className="hover:bg-rose-50/20 transition-colors">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded font-black text-[10px]">{row.partner_code}</span>
                    <div>
                        <p className="font-bold text-sm">{row.product_name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{row.item_code}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4 text-right font-mono text-xs">₹{row.cost_price}</td>
                <td className="p-4 text-right font-mono text-xs">₹{row.settlement_rate}</td>
                <td className="p-4 text-right font-mono font-bold text-rose-600">₹{row.net_profit}</td>
                <td className="p-4 text-right">
                  <span className="px-2 py-1 bg-rose-600 text-white rounded text-[10px] font-black">
                    {row.margin_pct}%
                  </span>
                </td>
                <td className="p-4 text-right">
                    <button className="text-[10px] font-black uppercase text-blue-600 hover:underline">Revise Price</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LowMarginReport;
