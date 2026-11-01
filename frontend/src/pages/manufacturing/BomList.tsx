import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { manufacturingApi, type MfgBom } from '../../api/manufacturing';
import BomEditorModal from './BomEditorModal';
import BomImport from './BomImport';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-300',
  OBSOLETE: 'bg-amber-100 text-amber-800 border-amber-300',
};

export default function BomList() {
  const [boms, setBoms] = useState<MfgBom[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBom, setSelectedBom] = useState<MfgBom | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const openBom = async (b: any) => {
    try { setSelectedBom((await manufacturingApi.getBom(b.id)).data); setIsEditorOpen(true); }
    catch (e: any) { toast.error(e?.response?.data?.detail || 'Could not open the BOM'); }
  };
  const [rejectingBomId, setRejectingBomId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchBoms = () => {
    setLoading(true);
    manufacturingApi
      .getBoms({
        status: statusFilter || undefined,
        search: searchTerm || undefined,
      })
      .then((res) => setBoms(res.data))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load Bill of Materials');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBoms();
  }, [statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchBoms();
  };

  const handleApprove = async (id: number) => {
    if (!window.confirm('Are you sure you want to approve this BOM version for production?')) return;
    try {
      await manufacturingApi.approveBom(id);
      toast.success('BOM approved successfully');
      fetchBoms();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to approve BOM');
    }
  };

  const handleReject = async () => {
    if (!rejectingBomId) return;
    if (!rejectionReason.trim()) {
      toast.error('Please specify a rejection reason');
      return;
    }
    try {
      await manufacturingApi.rejectBom(rejectingBomId, rejectionReason.trim());
      toast.success('BOM rejected');
      setRejectingBomId(null);
      setRejectionReason('');
      fetchBoms();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to reject BOM');
    }
  };

  const handleCloneRevision = async (id: number) => {
    try {
      const res = await manufacturingApi.cloneBomRevision(id);
      toast.success(`New revision ${res.data.version_label} created in Draft`);
      fetchBoms();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to clone revision');
    }
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-indigo-600 text-white rounded-lg">
              <i className="fas fa-layer-group text-sm" />
            </span>
            Bill of Materials & Product Formulations
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Maintain multi-level recipe formulations, standard batch yields, and ingredient revisions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BomImport onDone={fetchBoms} />
          <button
            onClick={() => {
              setSelectedBom(null);
              setIsEditorOpen(true);
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-sm transition"
          >
            <i className="fas fa-plus" /> New BOM Formulation
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
          {['', 'APPROVED', 'DRAFT', 'REJECTED', 'OBSOLETE'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {st === '' ? 'All Status' : st}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <input
              type="text"
              placeholder="Search BOM or item name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
            />
            <i className="fas fa-search absolute left-2.5 top-2.5 text-slate-400 text-xs" />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
          >
            Search
          </button>
        </form>
      </div>

      {/* BOM Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                <th className="py-3 px-3">BOM Number</th>
                <th className="py-3 px-3">Formula / Product</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-3">Rev</th>
                <th className="py-3 px-3 text-right">Batch Size</th>
                <th className="py-3 px-3 text-right">Yield %</th>
                <th className="py-3 px-3 text-right">Est. Batch Cost</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin mr-2" /> Loading Formulations...
                  </td>
                </tr>
              ) : boms.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No Bill of Materials found.
                  </td>
                </tr>
              ) : (
                boms.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-3 font-mono font-bold text-indigo-700 cursor-pointer hover:underline" onClick={() => openBom(b)}>
                      {b.bom_no}
                    </td>
                    <td className="py-3 px-3 cursor-pointer" onClick={() => openBom(b)}>
                      <div className="font-bold text-slate-800">{b.bom_name}</div>
                      <div className="text-[10px] text-slate-500">
                        {b.product_name} <span className="font-mono text-slate-400">({b.item_code})</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-[12px] font-semibold text-slate-700">{(b as any).customer_name || <span className="text-slate-400 font-normal">—</span>}</td>
                    <td className="py-3 px-3">
                      <span className="px-1.5 py-0.5 bg-slate-100 font-mono font-bold text-slate-700 rounded text-[10px]">
                        {b.version_label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700">
                      {Number(b.batch_size).toLocaleString()} {b.batch_unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-700">
                      {b.expected_yield_pct}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                      ₹{Number(b.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          STATUS_BADGE[b.status] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openBom(b)}
                          title="View / Edit Formula"
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded transition"
                        >
                          <i className="fas fa-edit" />
                        </button>

                        {b.status === 'DRAFT' && (
                          <button
                            onClick={() => handleApprove(b.id)}
                            title="Approve BOM"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                          >
                            <i className="fas fa-check-circle" />
                          </button>
                        )}

                        {b.status === 'DRAFT' && (
                          <button
                            onClick={() => setRejectingBomId(b.id)}
                            title="Reject BOM"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition"
                          >
                            <i className="fas fa-times-circle" />
                          </button>
                        )}

                        {b.status === 'APPROVED' && (
                          <button
                            onClick={() => handleCloneRevision(b.id)}
                            title="Clone to New Revision"
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition text-[11px] font-semibold flex items-center gap-1"
                          >
                            <i className="fas fa-code-branch" />
                            <span>Revise</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BOM Editor Modal */}
      <BomEditorModal
        open={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSuccess={fetchBoms}
        editingBom={selectedBom}
      />

      {/* Rejection Prompt Modal */}
      {rejectingBomId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i className="fas fa-times-circle text-rose-600" /> Reject Bill of Materials
            </h3>
            <p className="text-xs text-slate-500">
              Provide a clear reason for rejecting this formulation revision.
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Yield tolerance out of standard specifications..."
              className="w-full p-2 border border-slate-300 rounded-lg text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejectingBomId(null);
                  setRejectionReason('');
                }}
                className="px-3 py-1.5 border border-slate-300 rounded text-xs text-slate-600 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
