import React, { useState, useEffect } from 'react';
import api from '../../api/axios';


const HsnMappingReport = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/hsn-mapping`);
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-blue-600 text-white p-1 rounded"><i className="fas fa-link"></i></span>
            Subcategory HSN Mapping Master
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Master list of subcategories and their default HSN/GST configurations</p>
        </div>
        <div className="flex space-x-2">
          <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total Subcategories</p>
          <p className="text-2xl font-black text-blue-600">{data?.summary?.total_mappings || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Missing Mappings</p>
          <p className="text-2xl font-black text-rose-500">{data?.summary?.missing_mappings || 0}</p>
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
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Subcategory</th>
                  <th className="px-4 py-3">Default HSN</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-center">GST %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 uppercase font-bold text-[9px]">{r.category_name}</td>
                    <td className="px-4 py-3 font-bold text-slate-800">{r.subcategory_name}</td>
                    <td className="px-4 py-3">
                      {r.hsn_code ? (
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded font-mono font-bold">{r.hsn_code}</span>
                      ) : (
                        <span className="text-rose-500 font-bold italic tracking-tighter uppercase text-[9px]">⚠ No Mapping</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-md truncate">{r.description || '—'}</td>
                    <td className="px-4 py-3 text-center font-black text-slate-700">{r.gst_percent ? `${r.gst_percent}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default HsnMappingReport;
