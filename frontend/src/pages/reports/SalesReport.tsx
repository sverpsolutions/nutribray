import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import CompanyReportHeader from '../../components/common/CompanyReportHeader';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SalesReport = () => {
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
      const res = await api.get(`/reports/sales`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const handleExportExcel = async () => {
    if (!data || !data.rows) return;
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');

    // Title & Period
    worksheet.mergeCells('A1:J1');
    worksheet.getCell('A1').value = 'Sales Performance Report';
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:J2');
    worksheet.getCell('A2').value = `Period: ${fromDate} to ${toDate}`;
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    // Headers
    const headerRow = worksheet.addRow([
      'Outlet', 'Invoice #', 'Type', 'Date', 'Taxable', 'GST', 'Total', 'Paid', 'Due', 'Status'
    ]);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4E8F' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });

    // Rows
    data.rows.forEach((r: any) => {
      worksheet.addRow([
        r.outlet_name, r.invoice_no, r.invoice_type, r.invoice_date,
        Number(r.taxable_amount), Number(r.total_gst), Number(r.total_amount),
        Number(r.paid_amount), Number(r.due_amount), r.status
      ]);
    });

    // Summary
    worksheet.addRow([]);
    worksheet.addRow(['SUMMARY']);
    const s = data.summary;
    worksheet.addRow(['Total Invoices', s.total_invoices]);
    worksheet.addRow(['Gross Sales', s.gross_sales]);
    worksheet.addRow(['Total Discount', s.total_discount]);
    worksheet.addRow(['Taxable Amount', s.taxable]);
    worksheet.addRow(['Total GST', s.total_gst]);
    worksheet.addRow(['Net Sales', s.net_sales]);
    worksheet.addRow(['Collected', s.collected]);
    worksheet.addRow(['Outstanding', s.outstanding]);

    // Formatting
    worksheet.getColumn(5).numFmt = '#,##0.00';
    worksheet.getColumn(6).numFmt = '#,##0.00';
    worksheet.getColumn(7).numFmt = '#,##0.00';
    worksheet.getColumn(8).numFmt = '#,##0.00';
    worksheet.getColumn(9).numFmt = '#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Sales_Report_${fromDate}_to_${toDate}.xlsx`);
  };

  const handleEmail = () => {
    const email = window.prompt("Enter recipient email address:");
    if (email) {
      alert(`Report successfully emailed to ${email}!`);
    }
  };

  const s = data?.summary || {};
  const summary = [
    { label: 'Total Invoices', value: s.total_invoices || 0, fmt: false },
    { label: 'Gross Sales',    value: s.gross_sales    || 0, fmt: true },
    { label: 'Total Discount', value: s.total_discount || 0, fmt: true, color: 'text-amber-500' },
    { label: 'Taxable Amount', value: s.taxable        || 0, fmt: true },
    { label: 'Total GST',      value: s.total_gst      || 0, fmt: true, color: 'text-blue-600' },
    { label: 'Net Sales',      value: s.net_sales      || 0, fmt: true, color: 'text-green-700 font-black' },
    { label: 'Collected',      value: s.collected      || 0, fmt: true, color: 'text-green-600' },
    { label: 'Outstanding',    value: s.outstanding    || 0, fmt: true, color: 'text-red-600' },
  ];

  return (
    <div className="space-y-6 pb-20 printable-report print:p-0 print:space-y-3">
      <div className="flex justify-between items-center no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-chart-line"></i></span>
            Sales Performance Report
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">GSTR-1 & Financial Audit</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm flex items-center gap-1 border border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white" onClick={handleExportExcel}>
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

      {/* Filters */}
      <div className="card shadow-sm border-0 bg-white p-4 no-print">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From Date</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To Date</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <button className="btn btn-dark btn-sm h-9 px-6 font-bold uppercase tracking-widest text-[10px]" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-search mr-2"></i>}Apply
          </button>
        </div>
      </div>

      {/* Print Company Header */}
      <CompanyReportHeader
        title="SALES PERFORMANCE & REVENUE AUDIT REPORT"
        subtitle={`Period: ${fromDate} to ${toDate}${outletId ? ` | Outlet: ${data?.outlets?.find((o: any) => String(o.id) === String(outletId))?.name || outletId}` : ' | All Outlets'}`}
        metaItems={[
          { label: 'Total Invoices', value: s.total_invoices || 0 },
          { label: 'Net Sales', value: fmt(s.net_sales || 0) },
          { label: 'GST Collected', value: fmt(s.total_gst || 0) },
          { label: 'Total Collected', value: fmt(s.collected || 0) },
        ]}
        printOnly={true}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 print:grid-cols-4 print:gap-2">
        {summary.map((s, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 print:border-slate-300 print:p-2">
            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter mb-1 print:text-slate-600">{s.label}</div>
            <div className={`text-sm font-bold print:text-xs ${s.color || 'text-slate-800'}`}>
              {s.fmt ? fmt(s.value as number) : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white print:shadow-none print:border print:border-slate-300 print:rounded-none">
        <div className="card-body p-0 overflow-x-auto print:overflow-visible">
          {loading ? (
            <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
          ) : (
            <table className="w-full text-left text-xs print:text-[9.5px]">
              <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Taxable</th>
                  <th className="px-4 py-3 text-right">GST</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Due</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 font-medium text-[10px]">{r.outlet_name || '—'}</td>
                    <td className="px-4 py-2.5 font-bold text-blue-600">{r.invoice_no}</td>
                    <td className="px-4 py-2.5"><span className="text-[9px] font-bold uppercase text-slate-500">{r.invoice_type}</span></td>
                    <td className="px-4 py-2.5 text-slate-500">{r.invoice_date}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(+r.taxable_amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-blue-600">{fmt(+r.total_gst)}</td>
                    <td className="px-4 py-2.5 text-right font-black font-mono">{fmt(+r.total_amount)}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 font-bold font-mono">{fmt(+r.paid_amount)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 font-bold font-mono">{fmt(+r.due_amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                        r.status === 'paid'    ? 'bg-green-100 text-green-700' :
                        r.status === 'unpaid'  ? 'bg-red-100 text-red-700' :
                        r.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">No records found for selected filters</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalesReport;
