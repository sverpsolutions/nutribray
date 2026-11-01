import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { batches_api, ProductBatch } from '../../api/batches';

export default function BatchMaster() {
  const navigate = useNavigate();

  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected batch for detailed inspect drawer
  const [selectedBatch, setSelectedBatch] = useState<ProductBatch | null>(null);

  // Status Change Modal
  const [statusModal, setStatusModal] = useState<{
    open: boolean;
    batch: ProductBatch | null;
    newStatus: string;
    reason: string;
  }>({
    open: false,
    batch: null,
    newStatus: 'Active',
    reason: '',
  });

  const loadData = () => {
    setLoading(true);
    batches_api.list({
      page,
      per_page: perPage,
      status: statusFilter || undefined,
      search: searchQuery || undefined,
    })
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : ((res.data as any)?.data || []);
        setBatches(list);
        setTotal(list.length);
      })
      .catch(err => {
        console.error('Failed to load batch register', err);
        toast.error('Failed to load batch register');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [page, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  const handleUpdateStatus = async () => {
    if (!statusModal.batch) return;
    try {
      await batches_api.update_status(statusModal.batch.id, statusModal.newStatus, statusModal.reason);
      toast.success(`Batch ${statusModal.batch.batch_no} marked as ${statusModal.newStatus}`);
      setStatusModal({ open: false, batch: null, newStatus: 'Active', reason: '' });
      loadData();
      if (selectedBatch && selectedBatch.id === statusModal.batch.id) {
        setSelectedBatch({ ...selectedBatch, status: statusModal.newStatus as any });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update batch status');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600 flex items-center justify-center text-xl shadow-sm">
            <i className="fas fa-cubes"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">
              Central Batch Master
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Global registry of unique item batches, supplier lot numbers, and location balances.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/inventory/expiry-dashboard')}
            className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-all flex items-center gap-2"
          >
            <i className="fas fa-chart-line text-amber-500"></i> Expiry Dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate('/purchases/grn/new')}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-md shadow-blue-500/20 flex items-center gap-2"
          >
            <i className="fas fa-plus"></i> Inward New Batch (GRN)
          </button>
        </div>
      </div>

      {/* ── FILTER & SEARCH BAR ── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 w-full">
          <div className="relative flex-1">
            <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input
              type="text"
              placeholder="Search by Product Name, Item Code, Batch No, Supplier Lot..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700"
          >
            Filter
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setPage(1); loadData(); }}
              className="px-3 py-2 text-slate-400 hover:text-slate-600 text-xs"
            >
              Clear
            </button>
          )}
        </form>

        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[11px] font-bold text-slate-400 uppercase">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 outline-none"
          >
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Near Expiry">Near Expiry</option>
            <option value="Expired">Expired</option>
            <option value="Quarantined">Quarantined</option>
            <option value="Recalled">Recalled</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {/* ── BATCH REGISTER TABLE ── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Registered Batches ({total})
          </span>
          <button
            type="button"
            onClick={loadData}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-bold"
          >
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400">
            <i className="fas fa-spinner fa-spin text-3xl mb-3 text-blue-500/40"></i>
            <p className="text-xs font-medium">Loading central batch registry...</p>
          </div>
        ) : batches.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <i className="fas fa-cubes text-4xl mb-3 opacity-20"></i>
            <p className="text-sm font-bold uppercase tracking-wider">No batches found</p>
            <p className="text-xs text-slate-400 mt-1">Batches will appear here once goods are received via GRN.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 uppercase text-[10px] font-black text-slate-400 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Internal Batch ID</th>
                  <th className="px-4 py-3">Supplier Batch / Lot</th>
                  <th className="px-4 py-3">Item Details</th>
                  <th className="px-4 py-3">Dates (Mfg / Exp)</th>
                  <th className="px-4 py-3 text-right">Available Qty</th>
                  <th className="px-4 py-3 text-right">Purchase Rate</th>
                  <th className="px-4 py-3 text-right">MRP / Selling</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {batches.map((b) => {
                  const days = b.days_to_expiry;
                  const isExpired = b.status === 'Expired' || (days !== null && days !== undefined && days <= 0);
                  const isNearExpiry = b.status === 'Near Expiry' || (days !== null && days !== undefined && days > 0 && days <= 60);

                  return (
                    <tr
                      key={b.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedBatch(b)}
                    >
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-black text-blue-600 dark:text-blue-400 text-xs">
                          {b.batch_no}
                        </div>
                        <span className="text-[10px] text-slate-400">ID: #{b.id}</span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {b.supplier_batch_no || '—'}
                        </span>
                        {b.supplier_name && (
                          <div className="mt-0.5">
                            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100 block truncate max-w-[150px]">
                              {b.supplier_name}
                            </span>
                            {b.supplier_phone && (
                              <a
                                href={`tel:${b.supplier_phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline font-mono"
                              >
                                <i className="fas fa-phone-alt text-[8px]"></i>
                                {b.supplier_phone}
                              </a>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 max-w-[220px]">
                        <span className="font-bold text-slate-800 dark:text-slate-100 block truncate" title={b.product_name}>
                          {b.product_name || `Product #${b.product_id}`}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {b.item_code || `#${b.product_id}`}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="text-[11px]">
                          <span className="text-slate-400 uppercase text-[9px] mr-1">Exp:</span>
                          <span className={isExpired ? 'text-rose-600 font-bold' : isNearExpiry ? 'text-amber-600 font-bold' : 'font-medium'}>
                            {b.exp_date || '—'}
                          </span>
                        </div>
                        {b.mfg_date && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            <span className="uppercase text-[9px] mr-1">Mfg:</span>
                            {b.mfg_date}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right font-black font-mono text-sm text-slate-800 dark:text-white">
                        {b.total_current_qty ?? 0}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-300">
                        ₹{Number(b.purchase_rate || b.cost_price || 0).toFixed(2)}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="font-bold text-slate-800 dark:text-white font-mono">
                          ₹{Number(b.mrp || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          SP: ₹{Number(b.selling_price || 0).toFixed(2)}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          b.status === 'Active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                          b.status === 'Near Expiry' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                          b.status === 'Expired' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' :
                          b.status === 'Quarantined' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {b.status}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setStatusModal({ open: true, batch: b, newStatus: b.status, reason: '' })}
                            className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[10px] font-bold transition-all border border-slate-200 dark:border-slate-700"
                          >
                            Status
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/products/edit/${b.product_id}`)}
                            className="p-1 rounded text-slate-400 hover:text-blue-600 transition-colors"
                            title="Item Master"
                          >
                            <i className="fas fa-external-link-alt"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PAGINATION ── */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-medium">
            Showing {batches.length} of {total} batches
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Previous
            </button>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 px-2 font-mono">
              Page {page} of {Math.max(1, Math.ceil(total / perPage))}
            </span>
            <button
              type="button"
              disabled={page * perPage >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── BATCH DETAIL INSPECTION MODAL ── */}
      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 tracking-widest block">
                  Batch Master Record
                </span>
                <h3 className="text-lg font-black text-slate-800 dark:text-white font-mono mt-0.5">
                  {selectedBatch.batch_no}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Product</span>
                  <span className="font-bold text-slate-800 dark:text-white block mt-0.5">{selectedBatch.product_name}</span>
                  <span className="text-slate-400 font-mono text-[11px]">Code: {selectedBatch.item_code}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Supplier Lot & Vendor</span>
                  <span className="font-bold text-slate-800 dark:text-white block mt-0.5">{selectedBatch.supplier_batch_no || '—'}</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300 text-[11px] block mt-0.5">{selectedBatch.supplier_name || '—'}</span>
                  {selectedBatch.supplier_phone && (
                    <a
                      href={`tel:${selectedBatch.supplier_phone}`}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline mt-0.5 font-mono"
                    >
                      <i className="fas fa-phone-alt text-[9px]"></i>
                      {selectedBatch.supplier_phone}
                    </a>
                  )}
                  {selectedBatch.supplier_contact_name && (
                    <span className="text-[10px] text-slate-400 block">Attn: {selectedBatch.supplier_contact_name}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Mfg Date</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{selectedBatch.mfg_date || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Exp Date</span>
                  <span className="font-bold text-rose-600">{selectedBatch.exp_date || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">First Receipt</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{selectedBatch.first_receipt_date || '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 p-3 bg-blue-50/40 dark:bg-blue-950/20 rounded-2xl border border-blue-200/50 dark:border-blue-900/40 text-center">
                <div>
                  <span className="text-slate-400 block text-[9px] font-bold uppercase">Available Qty</span>
                  <span className="text-base font-black text-blue-600 dark:text-blue-400 font-mono">{selectedBatch.total_current_qty ?? 0}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-bold uppercase">Purchase Rate</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">₹{selectedBatch.purchase_rate}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-bold uppercase">MRP</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">₹{selectedBatch.mrp}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-bold uppercase">Selling Price</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">₹{selectedBatch.selling_price}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Status</span>
                  <span className="font-bold text-emerald-600 uppercase text-xs">{selectedBatch.status}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const b = selectedBatch;
                    setSelectedBatch(null);
                    setStatusModal({ open: true, batch: b, newStatus: b.status, reason: '' });
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all"
                >
                  Change Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STATUS CHANGE AUDIT MODAL ── */}
      {statusModal.open && statusModal.batch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-black uppercase tracking-tight text-slate-800 dark:text-white flex items-center gap-2">
                <i className="fas fa-shield-alt text-amber-500"></i> Update Batch Status
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Changing status will impact sale eligibility across POS billing and warehouse dispatch.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Target Batch</label>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 font-mono text-xs">
                  <div className="font-bold text-blue-600 dark:text-blue-400">{statusModal.batch.batch_no}</div>
                  <div className="text-slate-500 text-[11px] font-sans mt-0.5">{statusModal.batch.product_name}</div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">New Status</label>
                <select
                  value={statusModal.newStatus}
                  onChange={(e) => setStatusModal(prev => ({ ...prev, newStatus: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold outline-none"
                >
                  <option value="Active">Active (Normal Operations)</option>
                  <option value="Quarantined">Quarantined (Quality Hold / Inspection)</option>
                  <option value="Recalled">Recalled (Manufacturer Recall)</option>
                  <option value="Expired">Expired (Damaged / Date Elapsed)</option>
                  <option value="Closed">Closed (Zero balance / Discontinued)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Audit Reason / Notes</label>
                <textarea
                  rows={3}
                  value={statusModal.reason}
                  onChange={(e) => setStatusModal(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="State reason for compliance / audit log (e.g. Broken seal, supplier recall notice)..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
                ></textarea>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setStatusModal({ open: false, batch: null, newStatus: 'Active', reason: '' })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/60 dark:text-slate-400 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateStatus}
                className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all"
              >
                Confirm Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
