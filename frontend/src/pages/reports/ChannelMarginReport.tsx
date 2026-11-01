import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const ChannelMarginReport = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/channel-margin').then(res => {
      setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Channel Margin Analysis</h1>
          <p className="text-slate-500 text-sm">Profitability metrics across all online channels</p>
        </div>
        <button onClick={() => window.print()} className="bg-slate-100 p-2 rounded-lg hover:bg-slate-200"><i className="fas fa-print"></i></button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Partner</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Item</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">MRP</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Selling Price</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Settlement</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Margin %</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
                <tr><td colSpan={7} className="p-10 text-center"><i className="fas fa-spinner fa-spin mr-2"></i>Loading report...</td></tr>
            ) : data.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                <td className="p-4">
                  <span className="font-bold text-sm">{row.partner_name}</span>
                </td>
                <td className="p-4">
                  <p className="font-bold text-sm">{row.product_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{row.item_code}</p>
                </td>
                <td className="p-4 text-right font-mono">₹{row.mrp}</td>
                <td className="p-4 text-right font-mono font-bold">₹{row.selling_price}</td>
                <td className="p-4 text-right font-mono text-primary font-bold">₹{row.settlement_rate}</td>
                <td className="p-4 text-right">
                  <span className={`px-2 py-1 rounded text-[10px] font-black ${row.margin_pct > 15 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {row.margin_pct}%
                  </span>
                </td>
                <td className="p-4 text-right">
                  <span className={`w-2 h-2 rounded-full inline-block ${row.is_active ? 'bg-green-500' : 'bg-slate-300'}`}></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChannelMarginReport;
