import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const MarkdownItemReport = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/markdown-items').then(res => {
      setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-amber-600">Markdown Pricing Audit</h1>
          <p className="text-slate-500 text-sm">Tracking items using MRP-based markdown calculation</p>
        </div>
        <button onClick={() => window.print()} className="bg-slate-100 p-2 rounded-lg hover:bg-slate-200"><i className="fas fa-print"></i></button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400">Item Details</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">MRP</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">MD Margin %</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Calc CP</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">Calc Basic</th>
              <th className="p-4 text-[10px] font-black uppercase text-slate-400 text-right">GST %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
                <tr><td colSpan={6} className="p-10 text-center"><i className="fas fa-spinner fa-spin mr-2"></i>Auditing markdown items...</td></tr>
            ) : data.length === 0 ? (
                <tr><td colSpan={6} className="p-20 text-center text-slate-400 italic">No markdown items found in the system.</td></tr>
            ) : data.map((row, i) => (
              <tr key={i} className="hover:bg-amber-50/10 transition-colors">
                <td className="p-4">
                    <p className="font-bold text-sm">{row.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{row.item_code}</p>
                    <span className="text-[8px] bg-slate-100 dark:bg-slate-900 px-1 rounded uppercase font-black">{row.category}</span>
                </td>
                <td className="p-4 text-right font-mono font-bold">₹{row.mrp}</td>
                <td className="p-4 text-right">
                  <span className="px-2 py-1 bg-amber-500 text-white rounded text-[10px] font-black">
                    {row.mrp_margin}%
                  </span>
                </td>
                <td className="p-4 text-right font-mono text-sm text-amber-700 dark:text-amber-400">₹{row.cost_price}</td>
                <td className="p-4 text-right font-mono text-xs">₹{row.basic_cost}</td>
                <td className="p-4 text-right font-bold text-xs">{row.gst_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MarkdownItemReport;
