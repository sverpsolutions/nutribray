import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { manufacturingApi } from '../../api/manufacturing';

export default function ManufacturingReportsPage() {
  const [reportType, setReportType] = useState<'consumption' | 'yield' | 'packaging'>('consumption');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReport = (type: 'consumption' | 'yield' | 'packaging') => {
    setLoading(true);
    let call;
    if (type === 'consumption') call = manufacturingApi.getConsumptionReport();
    else if (type === 'yield') call = manufacturingApi.getYieldReport();
    else call = manufacturingApi.getPackagingUtilizationReport();

    call
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load manufacturing report');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReport(reportType);
  }, [reportType]);

  const exportCsv = () => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map((row) =>
      Object.values(row)
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `manufacturing_${reportType}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-indigo-600 text-white rounded-lg">
              <i className="fas fa-chart-line text-sm" />
            </span>
            Nutribray Production & Yield Reports
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Material variances, batch yield efficiency, scrap analysis, and packaging utilization analytics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={data.length === 0}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-2 disabled:opacity-50"
          >
            <i className="fas fa-file-csv text-emerald-600" /> Export CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 text-xs font-bold">
        {[
          { id: 'consumption', label: 'Material Consumption Variance', icon: 'fas fa-scale-balanced' },
          { id: 'yield', label: 'Production Yield & Scrap Analysis', icon: 'fas fa-chart-pie' },
          { id: 'packaging', label: 'Packaging Utilization Report', icon: 'fas fa-box' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setReportType(t.id as any)}
            className={`px-4 py-2.5 flex items-center gap-2 border-b-2 transition ${
              reportType === t.id
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <i className={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Report Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {reportType === 'consumption' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-3 px-3">Order No</th>
                  <th className="py-3 px-3">Product Name</th>
                  <th className="py-3 px-3">Material / Ingredient</th>
                  <th className="py-3 px-3 text-right">Required (BOM)</th>
                  <th className="py-3 px-3 text-right">Actually Consumed</th>
                  <th className="py-3 px-3 text-right">Returned Unused</th>
                  <th className="py-3 px-3 text-right">Variance Qty</th>
                  <th className="py-3 px-3 text-right">Variance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <i className="fas fa-spinner fa-spin mr-2" /> Loading Variance Report...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No consumption variance records found.
                    </td>
                  </tr>
                ) : (
                  data.map((r, idx) => {
                    const req = Number(r.required_qty || 0);
                    const cons = Number(r.consumed_qty || 0);
                    const diff = cons - req;
                    const diffPct = req > 0 ? (diff / req) * 100 : 0;
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-mono font-bold text-indigo-700">{r.order_no}</td>
                        <td className="py-3 px-3 font-bold text-slate-800">{r.product_name}</td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-slate-700">{r.material_name}</span>
                          <span className="text-[10px] text-slate-400 font-mono block">{r.material_code}</span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-700">
                          {req.toFixed(2)} {r.unit}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-purple-700">
                          {cons.toFixed(2)} {r.unit}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-amber-600 font-bold">
                          {Number(r.returned_qty || 0).toFixed(2)} {r.unit}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold">
                          <span className={diff > 0 ? 'text-rose-600' : diff < 0 ? 'text-blue-600' : 'text-slate-600'}>
                            {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} {r.unit}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold">
                          <span className={diffPct > 2 ? 'text-rose-600' : diffPct < -2 ? 'text-blue-600' : 'text-emerald-600'}>
                            {diffPct > 0 ? `+${diffPct.toFixed(1)}%` : `${diffPct.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {reportType === 'yield' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-3 px-3">Order No</th>
                  <th className="py-3 px-3">Finished Product</th>
                  <th className="py-3 px-3">Batch No</th>
                  <th className="py-3 px-3 text-right">Planned Qty</th>
                  <th className="py-3 px-3 text-right">Good Output</th>
                  <th className="py-3 px-3 text-right">Rejected</th>
                  <th className="py-3 px-3 text-right">Scrap</th>
                  <th className="py-3 px-3 text-right">Actual Yield %</th>
                  <th className="py-3 px-3">QC Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <i className="fas fa-spinner fa-spin mr-2" /> Loading Yield Report...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No production yield records found.
                    </td>
                  </tr>
                ) : (
                  data.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-mono font-bold text-indigo-700">{r.order_no}</td>
                      <td className="py-3 px-3 font-bold text-slate-800">{r.product_name}</td>
                      <td className="py-3 px-3 font-mono font-bold text-purple-700">{r.batch_no}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-700">
                        {Number(r.planned_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                        {Number(r.good_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-rose-600 font-bold">
                        {Number(r.rejected_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        {Number(r.scrap_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-700">
                        {r.yield_pct == null ? '—' : `${Number(r.yield_pct).toFixed(1)}%`}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {r.qc_status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {reportType === 'packaging' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-3 px-3">Order No</th>
                  <th className="py-3 px-3">Packaging Material SKU</th>
                  <th className="py-3 px-3 text-right">Standard Required</th>
                  <th className="py-3 px-3 text-right">Issued Quantity</th>
                  <th className="py-3 px-3 text-right">Consumed Quantity</th>
                  <th className="py-3 px-3 text-right">Wastage / Scrap</th>
                  <th className="py-3 px-3 text-right">Efficiency %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <i className="fas fa-spinner fa-spin mr-2" /> Loading Packaging Report...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No packaging utilization records found.
                    </td>
                  </tr>
                ) : (
                  data.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-mono font-bold text-indigo-700">{r.order_no}</td>
                      <td className="py-3 px-3 font-bold text-slate-800">{r.material_name}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-700">
                        {Number(r.required_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-purple-700">
                        {Number(r.issued_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-indigo-700">
                        {Number(r.consumed_qty).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-rose-600 font-bold">
                        {Number(r.wastage_qty || 0).toLocaleString()} {r.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-700">
                        {r.efficiency_pct == null ? '—' : `${Number(r.efficiency_pct).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
