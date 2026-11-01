import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, FileText } from 'lucide-react';
import api from '../../api/axios';

const TaxBreakupReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [viewMode, setViewMode] = useState<'details' | 'summary'>('details');

  useEffect(() => {
    fetchOutlets();
    fetchData();
  }, []);

  const fetchOutlets = async () => {
    try {
      const res = await api.get('/outlets?is_active=true');
      setOutlets(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = {
        from_date: fromDate,
        to_date: toDate,
        view_mode: viewMode,
      };
      if (selectedOutlet) params.outlet_id = selectedOutlet;

      const res = await api.get('/reports/tax-breakup', { params });
      setData(res.data?.rows || []);
    } catch (err) {
      console.error("Failed to fetch tax breakup data", err);
    } finally {
      setLoading(false);
    }
  };

  const cur = (val: number) => `₹${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totals = data.reduce((acc, row) => ({
    sales_value: acc.sales_value + (Number(row.sales_value) || 0),
    gst_0: acc.gst_0 + (Number(row.gst_0) || 0),
    taxable_5: acc.taxable_5 + (Number(row.taxable_5) || 0),
    gst_5: acc.gst_5 + (Number(row.gst_5) || 0),
    taxable_12: acc.taxable_12 + (Number(row.taxable_12) || 0),
    gst_12: acc.gst_12 + (Number(row.gst_12) || 0),
    taxable_18: acc.taxable_18 + (Number(row.taxable_18) || 0),
    gst_18: acc.gst_18 + (Number(row.gst_18) || 0),
    taxable_28: acc.taxable_28 + (Number(row.taxable_28) || 0),
    gst_28: acc.gst_28 + (Number(row.gst_28) || 0),
    taxable_40: acc.taxable_40 + (Number(row.taxable_40) || 0),
    gst_40: acc.gst_40 + (Number(row.gst_40) || 0),
    cess: acc.cess + (Number(row.cess) || 0),
    basic_value: acc.basic_value + (Number(row.basic_value) || 0),
  }), {
    sales_value: 0, gst_0: 0, taxable_5: 0, gst_5: 0,
    taxable_12: 0, gst_12: 0, taxable_18: 0, gst_18: 0,
    taxable_28: 0, gst_28: 0, taxable_40: 0, gst_40: 0, cess: 0, basic_value: 0
  });

  const showGst0 = totals.gst_0 > 0;
  const showGst5 = totals.taxable_5 > 0 || totals.gst_5 > 0;
  const showGst12 = totals.taxable_12 > 0 || totals.gst_12 > 0;
  const showGst18 = totals.taxable_18 > 0 || totals.gst_18 > 0;
  const showGst28 = totals.taxable_28 > 0 || totals.gst_28 > 0;
  const showGst40 = totals.taxable_40 > 0 || totals.gst_40 > 0;
  const showCess = totals.cess > 0;

  const colCount = 4 + (showGst0 ? 1 : 0) + (showGst5 ? 2 : 0) + (showGst12 ? 2 : 0) + (showGst18 ? 2 : 0) + (showGst28 ? 2 : 0) + (showGst40 ? 2 : 0) + (showCess ? 1 : 0) + 1;

  const exportToExcel = () => {
    if (!data.length) return;
    
    // Headers
    const headers = ['State', 'Unit', 'Date', 'Sales Value'];
    if (showGst0) headers.push('GST 0%');
    if (showGst5) headers.push('Taxable 5%', 'GST 5%');
    if (showGst12) headers.push('Taxable 12%', 'GST 12%');
    if (showGst18) headers.push('Taxable 18%', 'GST 18%');
    if (showGst28) headers.push('Taxable 28%', 'GST 28%');
    if (showGst40) headers.push('Taxable 40%', 'GST 40%');
    if (showCess) headers.push('Cess');
    headers.push('Basic Value');

    // Rows
    const rows = data.map(r => {
      const row = [r.state, r.unit, r.date, r.sales_value];
      if (showGst0) row.push(r.gst_0);
      if (showGst5) row.push(r.taxable_5, r.gst_5);
      if (showGst12) row.push(r.taxable_12, r.gst_12);
      if (showGst18) row.push(r.taxable_18, r.gst_18);
      if (showGst28) row.push(r.taxable_28, r.gst_28);
      if (showGst40) row.push(r.taxable_40, r.gst_40);
      if (showCess) row.push(r.cess);
      row.push(r.basic_value);
      return row;
    });

    // Totals
    const totalRow = ['-', 'Grand Total', '-'];
    totalRow.push(totals.sales_value);
    if (showGst0) totalRow.push(totals.gst_0);
    if (showGst5) totalRow.push(totals.taxable_5, totals.gst_5);
    if (showGst12) totalRow.push(totals.taxable_12, totals.gst_12);
    if (showGst18) totalRow.push(totals.taxable_18, totals.gst_18);
    if (showGst28) totalRow.push(totals.taxable_28, totals.gst_28);
    if (showGst40) totalRow.push(totals.taxable_40, totals.gst_40);
    if (showCess) totalRow.push(totals.cess);
    totalRow.push(totals.basic_value);
    rows.push(totalRow);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Tax_Breakup_${fromDate}_to_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-indigo-600 text-white p-1.5 rounded-lg"><FileText size={20} /></span>
            Tax Breakup Report
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">Detailed GST breakdown analysis by outlet</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase">From</span>
            <input type="date" className="bg-transparent border-none outline-none text-xs text-slate-700 font-bold" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <span className="text-[10px] font-bold text-slate-500 uppercase ml-2">To</span>
            <input type="date" className="bg-transparent border-none outline-none text-xs text-slate-700 font-bold" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          
          <select 
            value={selectedOutlet} 
            onChange={(e) => setSelectedOutlet(e.target.value)}
            className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-slate-50 outline-none focus:border-indigo-500"
          >
            <option value="">All Units</option>
            {outlets.map((o: any) => (
              <option key={o.id} value={o.id}>{o.outlet_name}</option>
            ))}
          </select>

          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button onClick={() => setViewMode('details')} className={`px-3 py-1.5 text-xs font-bold rounded-md ${viewMode === 'details' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Details</button>
            <button onClick={() => setViewMode('summary')} className={`px-3 py-1.5 text-xs font-bold rounded-md ${viewMode === 'summary' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Summary</button>
          </div>

          <button onClick={fetchData} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-200">
            <RefreshCw size={16} /> REFRESH
          </button>
          <button onClick={exportToExcel} className="bg-white border-2 border-slate-200 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm hover:border-slate-300 hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Download size={16} /> EXCEL
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-220px)] relative">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-[#1f4e78] text-white sticky top-0 z-10 text-[11px] uppercase">
              <tr>
                <th className="px-3 py-3 text-left border-r border-white/20">State</th>
                <th className="px-3 py-3 text-left border-r border-white/20">Unit</th>
                <th className="px-3 py-3 text-center border-r border-white/20">Date</th>
                <th className="px-3 py-3 text-right bg-[#1b4366] border-r border-white/20">Sales Value</th>
                {showGst0 && <th className="px-3 py-3 text-right border-r border-white/20">GST 0%</th>}
                {showGst5 && (
                  <>
                    <th className="px-3 py-3 text-right border-r border-white/20">Taxable 5%</th>
                    <th className="px-3 py-3 text-right bg-[#265d91] border-r border-white/20">GST 5%</th>
                  </>
                )}
                {showGst12 && (
                  <>
                    <th className="px-3 py-3 text-right border-r border-white/20">Taxable 12%</th>
                    <th className="px-3 py-3 text-right bg-[#265d91] border-r border-white/20">GST 12%</th>
                  </>
                )}
                {showGst18 && (
                  <>
                    <th className="px-3 py-3 text-right border-r border-white/20">Taxable 18%</th>
                    <th className="px-3 py-3 text-right bg-[#265d91] border-r border-white/20">GST 18%</th>
                  </>
                )}
                {showGst28 && (
                  <>
                    <th className="px-3 py-3 text-right border-r border-white/20">Taxable 28%</th>
                    <th className="px-3 py-3 text-right bg-[#265d91] border-r border-white/20">GST 28%</th>
                  </>
                )}
                {showGst40 && (
                  <>
                    <th className="px-3 py-3 text-right border-r border-white/20">Taxable 40%</th>
                    <th className="px-3 py-3 text-right bg-[#265d91] border-r border-white/20">GST 40%</th>
                  </>
                )}
                {showCess && <th className="px-3 py-3 text-right border-r border-white/20">CESS</th>}
                <th className="px-3 py-3 text-right bg-[#1b4366]">Basic Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={colCount} className="py-20 text-center text-slate-400 font-bold"><RefreshCw className="animate-spin inline-block mr-2 mb-1" size={18}/>Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={colCount} className="py-20 text-center text-slate-400 font-bold">No records found</td></tr>
              ) : (
                data.map((r, i) => (
                  <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-3 py-2 font-bold text-slate-600 border-r border-slate-100">{r.state}</td>
                    <td className="px-3 py-2 font-bold text-slate-700 border-r border-slate-100">{r.unit}</td>
                    <td className="px-3 py-2 text-center text-slate-500 border-r border-slate-100">{r.date}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-800 bg-slate-50 border-r border-slate-100">{cur(r.sales_value)}</td>
                    {showGst0 && <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.gst_0)}</td>}
                    {showGst5 && (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.taxable_5)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">{cur(r.gst_5)}</td>
                      </>
                    )}
                    {showGst12 && (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.taxable_12)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">{cur(r.gst_12)}</td>
                      </>
                    )}
                    {showGst18 && (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.taxable_18)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">{cur(r.gst_18)}</td>
                      </>
                    )}
                    {showGst28 && (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.taxable_28)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">{cur(r.gst_28)}</td>
                      </>
                    )}
                    {showGst40 && (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.taxable_40)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">{cur(r.gst_40)}</td>
                      </>
                    )}
                    {showCess && <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-100">{cur(r.cess)}</td>}
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 bg-slate-50">{cur(r.basic_value)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {data.length > 0 && !loading && (
              <tfoot className="bg-[#fff9e6] sticky bottom-0 border-t-2 border-yellow-200">
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-center font-black text-slate-800 border-r border-yellow-200">Grand Total</td>
                  <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.sales_value)}</td>
                  {showGst0 && <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_0)}</td>}
                  {showGst5 && (
                    <>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.taxable_5)}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_5)}</td>
                    </>
                  )}
                  {showGst12 && (
                    <>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.taxable_12)}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_12)}</td>
                    </>
                  )}
                  {showGst18 && (
                    <>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.taxable_18)}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_18)}</td>
                    </>
                  )}
                  {showGst28 && (
                    <>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.taxable_28)}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_28)}</td>
                    </>
                  )}
                  {showGst40 && (
                    <>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.taxable_40)}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.gst_40)}</td>
                    </>
                  )}
                  {showCess && <td className="px-3 py-3 text-right font-black text-slate-800 border-r border-yellow-200">{cur(totals.cess)}</td>}
                  <td className="px-3 py-3 text-right font-black text-slate-800">{cur(totals.basic_value)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default TaxBreakupReport;
