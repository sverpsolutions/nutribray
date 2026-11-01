import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { manufacturingApi, type MfgOrder } from '../../api/manufacturing';
import CreateOrderModal from './CreateOrderModal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
  MATERIALS_RESERVED: 'bg-amber-100 text-amber-800 border-amber-300',
  MATERIALS_ISSUED: 'bg-purple-100 text-purple-800 border-purple-300',
  IN_PRODUCTION: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  QC_PENDING: 'bg-orange-100 text-orange-800 border-orange-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  CANCELLED: 'bg-rose-100 text-rose-700 border-rose-300',
};

const QC_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  RELEASED: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-300',
  QUARANTINED: 'bg-purple-50 text-purple-700 border-purple-300',
};

export default function ManufacturingOrdersList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') || '';

  const [orders, setOrders] = useState<MfgOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const fetchOrders = () => {
    setLoading(true);
    manufacturingApi
      .getOrders({
        status: statusParam || undefined,
        search: searchTerm || undefined,
      })
      .then((res) => setOrders(res.data))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load Manufacturing Orders');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [statusParam]);

  const handleStatusFilter = (st: string) => {
    if (st) setSearchParams({ status: st });
    else setSearchParams({});
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-indigo-600 text-white rounded-lg">
              <i className="fas fa-clipboard-list text-sm" />
            </span>
            Manufacturing Orders (MO)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            End-to-end production runs, material reservation, floor issuance, output batches, and QC release gate.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-sm transition"
          >
            <i className="fas fa-plus" /> New Manufacturing Order
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
          {[
            { id: '', label: 'All Orders' },
            { id: 'DRAFT', label: 'Draft' },
            { id: 'APPROVED', label: 'Approved' },
            { id: 'MATERIALS_RESERVED', label: 'Reserved' },
            { id: 'MATERIALS_ISSUED', label: 'Issued' },
            { id: 'IN_PRODUCTION', label: 'In Production' },
            { id: 'QC_PENDING', label: 'QC Pending' },
            { id: 'COMPLETED', label: 'Completed' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => handleStatusFilter(st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                statusParam === st.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <input
            type="text"
            placeholder="Search Order No or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchOrders()}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
          />
          <i className="fas fa-search absolute left-2.5 top-2.5 text-slate-400 text-xs" />
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                <th className="py-3 px-3">Order Number</th>
                <th className="py-3 px-3">Target Product SKU</th>
                <th className="py-3 px-3">Formulation BOM</th>
                <th className="py-3 px-3 text-right">Planned Qty</th>
                <th className="py-3 px-3 text-right">Finished Qty</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">QC Gate</th>
                <th className="py-3 px-3">Start Date</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin mr-2" /> Loading Orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No manufacturing orders found for this criteria.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/manufacturing/orders/${o.id}`)}
                    className="hover:bg-indigo-50/40 cursor-pointer transition"
                  >
                    <td className="py-3 px-3 font-mono font-bold text-indigo-700">
                      {o.order_no}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-800">{o.product_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{o.item_code}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      <span className="font-mono text-[11px]">{o.bom_no}</span>
                      <span className="text-[10px] text-slate-400 block">Rev v{o.bom_revision}.0</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                      {Number(o.planned_qty).toLocaleString()} {o.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                      {Number(o.completed_qty).toLocaleString()} {o.unit}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          STATUS_BADGE[o.status] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {o.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          QC_BADGE[o.qc_status] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {o.qc_status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {o.planned_start_date || '—'}
                    </td>
                    <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`/manufacturing/orders/${o.id}`)}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 rounded text-[11px] font-bold transition"
                      >
                        Workbench →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateOrderModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={fetchOrders}
      />
    </div>
  );
}
