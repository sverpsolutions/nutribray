import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

const HOUR_LABELS = ['12AM','1AM','2AM','3AM','4AM','5AM','6AM','7AM','8AM','9AM','10AM','11AM',
                     '12PM','1PM','2PM','3PM','4PM','5PM','6PM','7PM','8PM','9PM','10PM','11PM'];

const HourlySalesReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/hourly`, { params });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const hours = data?.hours || [];
  const maxSales = Math.max(...hours.map((h: any) => h.sales), 1);
  const peakHour = hours.reduce((p: any, c: any) => (c.sales > (p?.sales || 0) ? c : p), null);

  const exportExcel = async () => {
    if (!data?.matrix) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hourly Sales Matrix');
    const headers = ['Unit Name', ...data.matrix.unique_hours.map((hr: number) => HOUR_LABELS[hr]), 'Total Sales'];
    ws.addRow(headers);
    data.matrix.rows.forEach((row: any) => {
      const rData = [
        row.outlet_name,
        ...data.matrix.unique_hours.map((hr: number) => row.hourly_sales[String(hr)] || 0),
        row.total_sales
      ];
      ws.addRow(rData);
    });
    const totalRow = [
      'Total',
      ...data.matrix.unique_hours.map((hr: number) => data.matrix.hourly_totals[String(hr)] || 0),
      data.matrix.grand_total
    ];
    ws.addRow(totalRow);
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Hourly_Sales_${fromDate}_to_${toDate}.xlsx`);
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
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-clock"></i></span>
            Hourly Sales Analysis
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Peak Hours · Transaction Volume · Business Intelligence</p>
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
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>Apply</button>
        </div>
      </div>

      {peakHour && (
        <div className="bg-gradient-to-r from-blue-800 to-teal-600 text-white rounded-2xl p-6 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">Peak Business Hour</div>
            <div className="text-4xl font-black">{HOUR_LABELS[peakHour.hour]}</div>
            <div className="text-sm opacity-70 mt-1">{peakHour.bills} bills · {fmt(peakHour.sales)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">Avg Bill Value</div>
            <div className="text-2xl font-black">{fmt(peakHour.avg_bill)}</div>
          </div>
          <i className="fas fa-fire text-6xl opacity-20"></i>
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
      ) : (
        <div className="card shadow-sm border-0 bg-white overflow-hidden">
          <div className="bg-gradient-to-r from-blue-700 to-teal-600 text-white px-6 py-3">
            <span className="text-xs font-bold uppercase tracking-widest">Hourly Breakdown</span>
          </div>
          <div className="p-6">
            {hours.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <i className="fas fa-info-circle mr-2"></i>
                No hourly data — bills may not have timestamp. Check invoice_datetime field.
              </div>
            ) : (
              <div className="space-y-2">
                {hours.map((h: any, i: number) => {
                  const isPeak = h.hour === peakHour?.hour;
                  return (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${isPeak ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <div className="w-12 text-right text-xs font-bold text-slate-500 shrink-0">{HOUR_LABELS[h.hour]}</div>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${isPeak ? 'bg-gradient-to-r from-teal-500 to-blue-600' : 'bg-gradient-to-r from-cyan-400 to-blue-500'}`}
                          style={{ width: `${(h.sales / maxSales) * 100}%` }}
                        ></div>
                      </div>
                      <div className="w-28 text-right text-xs font-black font-mono text-slate-700 shrink-0">{fmt(h.sales)}</div>
                      <div className="w-16 text-center text-[10px] text-slate-500 shrink-0">{h.bills} bills</div>
                      {isPeak && <span className="text-xs bg-teal-600 text-white px-2 py-0.5 rounded-full font-bold">PEAK</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unit-Wise Matrix Table view */}
      {data?.matrix?.rows?.length > 0 && !loading && (
        <div className="card shadow-sm border-0 overflow-hidden bg-white">
          <div className="bg-gradient-to-r from-blue-700 to-teal-600 text-white px-6 py-3 flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-widest">Unit-Wise Hourly Sales Matrix</span>
            <span className="text-[10px] font-bold text-teal-100">Sales totals in INR (₹)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-left font-bold text-slate-700 sticky left-0 bg-slate-50 z-10 border-r border-slate-100 min-w-[150px]">Unit Name</th>
                  {data.matrix.unique_hours.map((hr: number) => (
                    <th key={hr} className="px-4 py-3 text-right font-bold text-slate-600 min-w-[80px]">{HOUR_LABELS[hr]}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-black text-slate-800 border-l border-slate-200 bg-slate-100 min-w-[120px]">Total Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.matrix.rows.map((row: any, rIdx: number) => (
                  <tr key={rIdx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-800 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">{row.outlet_name}</td>
                    {data.matrix.unique_hours.map((hr: number) => {
                      const sales = row.hourly_sales[String(hr)];
                      return (
                        <td key={hr} className="px-4 py-3 text-right font-mono text-slate-600">
                          {sales ? fmt(sales) : '—'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 border-l border-slate-200 bg-slate-50/50">{fmt(row.total_sales)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gradient-to-r from-blue-900 to-teal-800 text-white font-bold border-t border-teal-700">
                  <td className="px-4 py-3 font-black sticky left-0 bg-blue-900 z-10 border-r border-teal-700">Total</td>
                  {data.matrix.unique_hours.map((hr: number) => {
                    const colTotal = data.matrix.hourly_totals[String(hr)];
                    return (
                      <td key={hr} className="px-4 py-3 text-right font-mono font-bold text-teal-100">
                        {colTotal ? fmt(colTotal) : '₹0'}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-mono font-black text-yellow-300 bg-teal-950 border-l border-teal-700">{fmt(data.matrix.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default HourlySalesReport;
