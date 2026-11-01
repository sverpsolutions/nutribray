import React, { useState, useEffect } from 'react';
import api from '../../api/axios';


const HsnMismatchReport = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/hsn-mismatch`);
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-amber-500 text-white p-1 rounded"><i className="fas fa-exclamation-circle"></i></span>
            HSN Mismatch Compliance Report
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Audit of items where Entered HSN differs from Category Suggestion</p>
        </div>
        <div className="flex space-x-2">
          <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total Mismatches</p>
          <p className="text-2xl font-black text-rose-500">{data?.summary?.total_mismatches || 0}</p>
        </div>
      </div>

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          {loading ? (
            <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-3">Item Code</th>
                  <th className="px-4 py-3">Item Name</th>
                  <th className="px-4 py-3">Subcategory</th>
                  <th className="px-4 py-3">Suggested HSN</th>
                  <th className="px-4 py-3">Entered HSN</th>
                  <th className="px-4 py-3 text-center">Current GST %</th>
                  <th className="px-4 py-3 text-center">HSN Master GST %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">{r.item_code}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.item_name}</td>
                    <td className="px-4 py-3 text-slate-500 uppercase font-bold text-[10px]">{r.subcategory_name}</td>
                    <td className="px-4 py-3"><span className="px-2 py-1 bg-green-50 text-green-700 rounded font-mono font-bold">{r.suggested_hsn}</span></td>
                    <td className="px-4 py-3"><span className="px-2 py-1 bg-rose-50 text-rose-700 rounded font-mono font-bold">{r.entered_hsn}</span></td>
                    <td className="px-4 py-3 text-center font-bold text-slate-600">{r.gst_percent}%</td>
                    <td className="px-4 py-3 text-center font-bold text-blue-600">{r.hsn_gst_percent}%</td>
                  </tr>
                ))}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Perfect compliance! No HSN mismatches found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default HsnMismatchReport;
