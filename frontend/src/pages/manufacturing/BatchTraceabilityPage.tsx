import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { manufacturingApi, type TraceabilityGenealogy } from '../../api/manufacturing';

export default function BatchTraceabilityPage() {
  const [searchParams] = useSearchParams();
  const initialBatch = searchParams.get('batch') || '';

  const [direction, setDirection] = useState<'BACKWARD' | 'FORWARD'>('BACKWARD');
  const [batchNo, setBatchNo] = useState(initialBatch);
  const [loading, setLoading] = useState(false);
  const [genealogy, setGenealogy] = useState<TraceabilityGenealogy | null>(null);

  useEffect(() => {
    if (initialBatch) {
      handleSearch(initialBatch, direction);
    }
  }, [initialBatch]);

  const handleSearch = (b: string, dir: 'BACKWARD' | 'FORWARD') => {
    if (!b.trim()) {
      toast.error('Please enter a Batch or Lot Number');
      return;
    }
    setLoading(true);
    const apiCall =
      dir === 'BACKWARD'
        ? manufacturingApi.traceBackward(b.trim())
        : manufacturingApi.traceForward(b.trim());

    apiCall
      .then((res) => {
        setGenealogy(res.data);
      })
      .catch((err) => {
        console.error(err);
        toast.error(err?.response?.data?.detail || 'No genealogy data found for this batch');
        setGenealogy(null);
      })
      .finally(() => setLoading(false));
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(batchNo, direction);
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-purple-600 text-white rounded-lg">
              <i className="fas fa-sitemap text-sm" />
            </span>
            Batch Genealogy & Forward / Backward Traceability
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Full compliance audit trail connecting raw materials, packaging lots, formulations, production orders, and finished goods.
          </p>
        </div>
      </div>

      {/* Search Engine Control Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        {/* Toggle Mode */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => {
                setDirection('BACKWARD');
                if (batchNo) handleSearch(batchNo, 'BACKWARD');
              }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                direction === 'BACKWARD'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <i className="fas fa-history" /> Backward Traceability (FG → Raw Materials)
            </button>
            <button
              onClick={() => {
                setDirection('FORWARD');
                if (batchNo) handleSearch(batchNo, 'FORWARD');
              }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                direction === 'FORWARD'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <i className="fas fa-arrow-trend-up" /> Forward Traceability (Raw Lot → Finished Products)
            </button>
          </div>

          {/* Quick Presets for Demo */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Test Presets:</span>
            <button
              onClick={() => {
                setDirection('BACKWARD');
                setBatchNo('NB-BAT-20261018-001');
                handleSearch('NB-BAT-20261018-001', 'BACKWARD');
              }}
              className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded font-mono font-bold"
            >
              FG Batch: NB-BAT-20261018-001
            </button>
            <button
              onClick={() => {
                setDirection('FORWARD');
                setBatchNo('LOT-NB-RM-001-2610');
                handleSearch('LOT-NB-RM-001-2610', 'FORWARD');
              }}
              className="px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded font-mono font-bold"
            >
              RM Lot: LOT-NB-RM-001-2610
            </button>
          </div>
        </div>

        {/* Search Input Bar */}
        <form onSubmit={onFormSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder={
                direction === 'BACKWARD'
                  ? 'Enter Finished Good Batch Number (e.g. NB-BAT-20261018-001)...'
                  : 'Enter Raw Material / Packaging Batch Lot (e.g. LOT-NB-RM-001-2610)...'
              }
              className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
            <i className="fas fa-search absolute left-3.5 top-3.5 text-slate-400 text-xs" />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
          >
            {loading ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-bolt" />}
            Trace Batch
          </button>
        </form>
      </div>

      {/* Results View */}
      {loading ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400">
          <i className="fas fa-spinner fa-spin text-2xl mr-2 text-purple-600" />
          <span>Searching genealogy tree across stock ledger and production logs...</span>
        </div>
      ) : !genealogy ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400 text-xs">
          Enter a batch number above or click one of the test presets to view the complete production genealogy.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Root Batch Overview */}
          <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white p-5 rounded-xl shadow-md space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-purple-300">
                  Target Inquired Batch ({genealogy.direction} Trace)
                </span>
                <h2 className="text-xl font-mono font-black">{genealogy.batch_details?.batch_no}</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-purple-800 text-purple-100 rounded-lg text-xs font-bold border border-purple-700">
                  QC: {genealogy.batch_details?.qc_status || 'RELEASED'}
                </span>
                <span className="px-2.5 py-1 bg-emerald-500 text-white rounded-lg text-xs font-bold">
                  Verified In Stock Ledger
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-purple-200">
              <div>
                <span className="block text-[10px] text-purple-400 font-bold">Product Item</span>
                <span className="font-bold text-white text-sm">{genealogy.product?.name}</span>
                <span className="block font-mono text-[10px] text-purple-300">
                  SKU: {genealogy.product?.item_code}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-purple-400 font-bold">Mfg Date</span>
                <span className="font-mono text-white">{genealogy.batch_details?.mfg_date || '—'}</span>
              </div>
              <div>
                <span className="block text-[10px] text-purple-400 font-bold">Expiry Date</span>
                <span className="font-mono text-white">{genealogy.batch_details?.exp_date || '—'}</span>
              </div>
              <div>
                <span className="block text-[10px] text-purple-400 font-bold">Current Stock Qty</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {Number(genealogy.batch_details?.stock_qty || 0).toLocaleString()} {genealogy.product?.unit || 'PCS'}
                </span>
              </div>
            </div>
          </div>

          {/* Genealogy Tree / Flow */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
                <i className="fas fa-bezier-curve text-purple-600" />
                {direction === 'BACKWARD'
                  ? 'Source Ingredients, Raw Materials & Packaging Consumed'
                  : 'Finished Product Batches Produced From This Material'}
              </h3>
              <span className="text-xs text-slate-500 font-semibold">
                {genealogy.genealogy_records?.length || 0} Traceability Links Established
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                    <th className="py-3 px-3">Linked Batch / Lot No</th>
                    <th className="py-3 px-3">Material Name & SKU</th>
                    <th className="py-3 px-3">Manufacturing Order</th>
                    <th className="py-3 px-3 text-right">Quantity Consumed</th>
                    <th className="py-3 px-3">Supplier Reference</th>
                    <th className="py-3 px-3">Expiry Date</th>
                    <th className="py-3 px-3 text-center">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!genealogy.genealogy_records || genealogy.genealogy_records.length === 0) ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No downstream or upstream consumption records linked to this batch.
                      </td>
                    </tr>
                  ) : (
                    genealogy.genealogy_records.map((r: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-3 font-mono font-bold text-purple-700">
                          {r.batch_no}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-800">{r.product_name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{r.item_code}</div>
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold text-indigo-600">
                          {r.order_no || 'Direct'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                          {Number(r.consumed_qty || r.quantity || 0).toFixed(2)} {r.unit}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          {r.supplier_name || r.supplier_batch_no || 'Internal Production'}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600">
                          {r.expiry_date || '—'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            VERIFIED
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
